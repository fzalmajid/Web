import test from "node:test";
import assert from "node:assert/strict";
import {
  ChatStreamError, createChatStreamResponse, createSseParser, readChatStream,
} from "../lib/chatStream";
import { geminiGenerateDetailed } from "../lib/gemini";
import { openaiGenerateDetailed, anthropicGenerateDetailed } from "../lib/externalAi";
import { routePrimary } from "../lib/primaryRouter";

const encode = new TextEncoder();
function fragmentedResponse(events: any[], fragment = 3) {
  const bytes = encode.encode(events.map(event => "data: " + JSON.stringify(event) + "\r\n\r\n").join(""));
  return new Response(new ReadableStream({ start(controller) {
    for (let index = 0; index < bytes.length; index += fragment) controller.enqueue(bytes.slice(index, index + fragment));
    controller.close();
  } }), { headers: { "Content-Type": "text/event-stream" } });
}

test("SSE framing tolerates CRLF split at every boundary, comments, and multiline data", () => {
  const parser = createSseParser();
  const raw = ": heartbeat\r\n\r\nevent: custom\r\ndata: first\r\ndata: second\r\n\r\ndata: last\n\n";
  const events = [...raw].flatMap(character => parser.push(character));
  events.push(...parser.finish());
  assert.deepEqual(events, [{ event: "custom", data: "first\nsecond" }, { event: "message", data: "last" }]);
});

test("chat reader handles fragmented Unicode and keeps final repaired text and source metadata authoritative", async () => {
  const deltas: string[] = [];
  const final = { answer: "Jawaban diperiksa π 📚", model: "model-test", sources: [{ id: "source-1" }], citationWarnings: ["review"] };
  const data = await readChatStream(fragmentedResponse([
    { type: "delta", text: "Draf π " }, { type: "delta", text: "📚" }, { type: "result", data: final },
  ], 1), text => deltas.push(text));
  assert.equal(deltas.join(""), "Draf π 📚");
  assert.deepEqual(data, final);
});

test("structured stream errors preserve model recovery choices and JSON callers remain compatible", async () => {
  const failure = { type: "error", status: 503, code: "MODEL_SELECTION_REQUIRED", error: "Pilih model", alternativeModels: [{ id: "other" }] };
  await assert.rejects(readChatStream(fragmentedResponse([failure]), () => {}), (error: any) => {
    assert.ok(error instanceof ChatStreamError);
    assert.equal(error.status, 503);
    assert.deepEqual(error.data.alternativeModels, failure.alternativeModels);
    return true;
  });
  assert.deepEqual(await readChatStream(Response.json({ answer: "Legacy JSON" }), () => {}), { answer: "Legacy JSON" });
  await assert.rejects(readChatStream(Response.json({ error: "Belum login" }, { status: 401 }), () => {}), (error: any) => error.status === 401);
});

test("a disconnected chat stream cannot be treated as a completed assistant message", async () => {
  await assert.rejects(readChatStream(fragmentedResponse([{ type: "delta", text: "Belum selesai" }]), () => {}),
    (error: any) => error.data.code === "CHAT_STREAM_INCOMPLETE");
});

test("server wrapper emits live deltas before the existing JSON handler completes", async () => {
  let complete!: () => void;
  const gate = new Promise<void>(resolve => { complete = resolve; });
  let firstDelta!: () => void;
  const deltaReady = new Promise<void>(resolve => { firstDelta = resolve; });
  const response = createChatStreamResponse(async onDelta => {
    onDelta("Live ");
    await gate;
    return Response.json({ answer: "Final", semanticStatus: "ready", aiUsage: { used: 1 } });
  });
  const deltas: string[] = [];
  const result = readChatStream(response, text => { deltas.push(text); firstDelta(); });
  await deltaReady;
  assert.deepEqual(deltas, ["Live "]);
  complete();
  assert.deepEqual(await result, { answer: "Final", semanticStatus: "ready", aiUsage: { used: 1 } });
  const failed = createChatStreamResponse(async () => Response.json({ error: "Limit", code: "AI_QUOTA", remaining: 0 }, { status: 429 }));
  await assert.rejects(readChatStream(failed, () => {}), (error: any) => error.status === 429 && error.data.remaining === 0);
});

test("cancelling the response body aborts upstream work instead of waiting for provider timeout", async () => {
  let upstreamSignal!: AbortSignal;
  let cancelled!: () => void;
  const upstreamCancelled = new Promise<void>(resolve => { cancelled = resolve; });
  const response = createChatStreamResponse(async (_onDelta, signal) => {
    upstreamSignal = signal;
    await new Promise<void>(resolve => signal.addEventListener("abort", () => { cancelled(); resolve(); }, { once: true }));
    signal.throwIfAborted();
    return Response.json({});
  });
  await response.body!.cancel();
  await upstreamCancelled;
  assert.equal(upstreamSignal.aborted, true);
});

test("OpenAI streams output text only and retains terminal citations, usage, and finish reason", async () => {
  const original = globalThis.fetch;
  const deltas: string[] = [];
  try {
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.stream, true);
      assert.equal(body.store, false);
      return fragmentedResponse([
        { type: "response.reasoning_summary_text.delta", delta: "internal" },
        { type: "response.output_text.delta", delta: "Halo " },
        { type: "response.output_text.delta", delta: "π" },
        { type: "response.completed", response: { status: "completed", output: [{ type: "message", content: [
          { type: "output_text", text: "Halo π", annotations: [{ type: "url_citation", url: "https://example.org/paper", title: "Paper" }] },
        ] }], usage: { input_tokens: 12, output_tokens: 8, total_tokens: 20, output_tokens_details: { reasoning_tokens: 2 } } } },
      ]);
    };
    const result = await openaiGenerateDetailed({ apiKey: "test-only", model: "gpt-4.1-mini", prompt: "Halo", onDelta: text => deltas.push(text) });
    assert.equal(deltas.join(""), "Halo π");
    assert.equal(result.text, "Halo π");
    assert.deepEqual(result.webSources, [{ title: "Paper", uri: "https://example.org/paper" }]);
    assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 8, thoughtsTokens: 2, totalTokens: 20 });
    assert.equal(result.finishReason, "completed");
  } finally { globalThis.fetch = original; }
});

test("Claude assembles text/citation deltas with cumulative usage and hides thinking", async () => {
  const original = globalThis.fetch;
  const deltas: string[] = [];
  try {
    globalThis.fetch = async (_url, init) => {
      assert.equal(JSON.parse(String(init?.body)).stream, true);
      return fragmentedResponse([
        { type: "message_start", message: { content: [], usage: { input_tokens: 15, output_tokens: 1 } } },
        { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "internal" } },
        { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Bukti " } },
        { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "tersedia." } },
        { type: "content_block_delta", index: 1, delta: { type: "citations_delta", citation: { url: "https://example.org/claude", title: "Evidence" } } },
        { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 9 } },
        { type: "message_stop" },
      ]);
    };
    const result = await anthropicGenerateDetailed({ apiKey: "test-only", model: "claude-test", prompt: "Halo", onDelta: text => deltas.push(text) });
    assert.equal(deltas.join(""), "Bukti tersedia.");
    assert.equal(result.text, "Bukti tersedia.");
    assert.deepEqual(result.webSources, [{ title: "Evidence", uri: "https://example.org/claude" }]);
    assert.equal(result.usage.totalTokens, 24);
    assert.equal(result.finishReason, "end_turn");
  } finally { globalThis.fetch = original; }
});

test("Gemini uses streamGenerateContent and keeps whitespace, grounding sources, and final token usage", async () => {
  const original = globalThis.fetch;
  const deltas: string[] = [];
  try {
    globalThis.fetch = async (url, init) => {
      if (!init?.body) return Response.json({ models: [{ name: "models/gemini-test", supportedGenerationMethods: ["generateContent"] }] });
      assert.match(String(url), /:streamGenerateContent\?alt=sse$/);
      return fragmentedResponse([
        { candidates: [{ content: { parts: [{ text: "internal", thought: true }, { text: "Halo " }] } }] },
        { candidates: [{ content: { parts: [{ text: "dunia 📚" }] }, finishReason: "STOP", groundingMetadata: { groundingChunks: [
          { web: { uri: "https://example.org/gemini", title: "Grounded" } },
        ] } }], usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 7, thoughtsTokenCount: 3, totalTokenCount: 21 } },
      ], 1);
    };
    const result = await geminiGenerateDetailed([{ text: "Halo" }], "", { apiKey: "test-only", models: ["gemini-test"], onDelta: text => deltas.push(text) });
    assert.equal(deltas.join(""), "Halo dunia 📚");
    assert.equal(result.text, "Halo dunia 📚");
    assert.deepEqual(result.webSources, [{ title: "Grounded", uri: "https://example.org/gemini" }]);
    assert.equal(result.usage.totalTokens, 21);
    assert.equal(result.finishReason, "STOP");
  } finally { globalThis.fetch = original; }
});

test("provider streams reject interrupted terminal events instead of saving partial output", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => fragmentedResponse([{ type: "response.output_text.delta", delta: "partial" }]);
    await assert.rejects(openaiGenerateDetailed({ apiKey: "test-only", model: "gpt-test", prompt: "Halo", onDelta: () => {} }),
      (error: any) => error.code === "OPENAI_STREAM_INCOMPLETE");
    globalThis.fetch = async () => fragmentedResponse([{ type: "message_start", message: { content: [], usage: {} } }]);
    await assert.rejects(anthropicGenerateDetailed({ apiKey: "test-only", model: "claude-test", prompt: "Halo", onDelta: () => {} }),
      (error: any) => error.code === "CLAUDE_STREAM_INCOMPLETE");
  } finally { globalThis.fetch = original; }
});

test("provider cancellation closes the body and cannot trigger another primary generation", async () => {
  const original = globalThis.fetch;
  const abort = new AbortController();
  let bodyCancelled = false;
  let upstreamSignal: AbortSignal | undefined;
  let gotDelta!: () => void;
  const deltaReady = new Promise<void>(resolve => { gotDelta = resolve; });
  let fallbackCalls = 0;
  try {
    globalThis.fetch = async (_url, init) => {
      upstreamSignal = init?.signal || undefined;
      return new Response(new ReadableStream({
        start(controller) { controller.enqueue(encode.encode('data: {"type":"response.output_text.delta","delta":"live"}\n\n')); },
        cancel() { bodyCancelled = true; },
      }), { headers: { "Content-Type": "text/event-stream" } });
    };
    const pending = routePrimary({ signal: abort.signal,
      gemini: () => openaiGenerateDetailed({ apiKey: "test-only", model: "gpt-test", prompt: "Halo", signal: abort.signal, onDelta: () => gotDelta() }),
      openai: async () => { fallbackCalls++; throw new Error("Must not call"); },
    });
    await deltaReady;
    abort.abort();
    await assert.rejects(pending, (error: any) => error.name === "AbortError");
    assert.equal(upstreamSignal?.aborted, true);
    assert.equal(bodyCancelled, true);
    assert.equal(fallbackCalls, 0);
  } finally { globalThis.fetch = original; }
});


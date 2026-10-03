import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { geminiGenerateDetailed, WHATSAPP_FORMAT_INSTRUCTION } from "../lib/gemini";
import { planAnswerLength } from "../lib/answerLength";

const document = "Buatkan PPT lengkap berisi dasar teori, usulan formulasi, perhitungan bahan, monografi, alat bahan, diagram alir, cara kerja, evaluasi mutu, studi kasus, daftar pustaka.";
const usage = { promptTokenCount: 20, candidatesTokenCount: 10, thoughtsTokenCount: 30, totalTokenCount: 60 };

test("High documents reserve thoughts separately from visible document capacity", () => {
  const high = planAnswerLength(document, "high");
  assert.ok(high.maxOutputTokens >= 28672);
  assert.ok(high.maxOutputTokens <= 32768);
  assert.equal(high.targetCharacters, planAnswerLength(document, "none").targetCharacters);
});

test("a truncated document receives one complete rewrite with summed usage and preserved sources", async () => {
  const original = globalThis.fetch;
  const requests: any[] = [];
  try {
    globalThis.fetch = async (url, options) => {
      if (!String(url).includes(":generateContent")) return new Response(JSON.stringify({ models: [{ name: "models/gemini-3.5-flash", supportedGenerationMethods: ["generateContent"] }] }));
      requests.push(JSON.parse(String(options?.body)));
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: requests.length === 1 ? "partial table | Ko-k" : "Complete document\nReferences:\nReal source" }] }, finishReason: requests.length === 1 ? "MAX_TOKENS" : "STOP", groundingMetadata: { groundingChunks: [{ web: { title: "Actual source", uri: "https://example.org/source" } }] } }], usageMetadata: usage }));
    };
    const result = await geminiGenerateDetailed([{ text: document }], "Tutor", { apiKey: "test-document-rewrite", models: ["gemini-3.5-flash"], strictModel: true, effort: "high", maxOutputTokens: planAnswerLength(document, "high").maxOutputTokens, outputBudgetMultiplier: 1, retryTruncatedDocument: true });
    assert.equal(requests.length, 2);
    assert.equal(requests[0].generationConfig.thinkingConfig.thinkingLevel, "high");
    assert.equal(requests[1].generationConfig.thinkingConfig.thinkingLevel, "low");
    assert.match(requests[1].contents[0].parts.at(-1).text, /Tulis ulang dokumen utuh/);
    assert.doesNotMatch(result.text, /partial table/);
    assert.equal(result.finishReason, "STOP");
    assert.equal(result.repairedTruncation, true);
    assert.deepEqual(result.usage, { inputTokens: 40, outputTokens: 20, thoughtsTokens: 60, totalTokens: 120 });
    assert.equal(result.webSources.length, 1);
  } finally { globalThis.fetch = original; }
});

test("2.5 document thoughts are bounded, and a second truncation never loops", async () => {
  const original = globalThis.fetch;
  const requests: any[] = [];
  try {
    globalThis.fetch = async (url, options) => {
      if (!String(url).includes(":generateContent")) return new Response(JSON.stringify({ models: [{ name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] }] }));
      requests.push(JSON.parse(String(options?.body)));
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "still partial" }] }, finishReason: "MAX_TOKENS" }], usageMetadata: usage }));
    };
    const result = await geminiGenerateDetailed([{ text: document }], "Tutor", { apiKey: "test-document-bounded", models: ["gemini-2.5-flash"], strictModel: true, effort: "high", maxOutputTokens: 30000, maxThinkingTokens: 8192, outputBudgetMultiplier: 1, retryTruncatedDocument: true });
    assert.equal(requests[0].generationConfig.thinkingConfig.thinkingBudget, 8192);
    assert.equal(requests[1].generationConfig.thinkingConfig.thinkingBudget, 1024);
    assert.equal(requests.length, 2);
    assert.equal(result.finishReason, "MAX_TOKENS");
    assert.equal(result.repairedTruncation, false);
  } finally { globalThis.fetch = original; }
});

test("retry unavailability preserves a partial draft and successful answers do not retry", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  let complete = false;
  try {
    globalThis.fetch = async (url) => {
      if (!String(url).includes(":generateContent")) return new Response(JSON.stringify({ models: [{ name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] }] }));
      calls++;
      if (calls === 2 && !complete) return new Response(JSON.stringify({ error: { message: "quota exceeded" } }), { status: 429 });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: complete ? "complete" : "initial draft" }] }, finishReason: complete ? "STOP" : "MAX_TOKENS" }], usageMetadata: usage }));
    };
    const options = { apiKey: "test-document-unavailable", models: ["gemini-2.5-flash"], strictModel: true, maxAttempts: 1, maxOutputTokens: 16000, retryTruncatedDocument: true };
    const partial = await geminiGenerateDetailed([{ text: document }], "Tutor", options);
    assert.equal(partial.text, "initial draft");
    assert.equal(partial.finishReason, "MAX_TOKENS");
    complete = true; calls = 0;
    assert.equal((await geminiGenerateDetailed([{ text: document }], "Tutor", options)).text, "complete");
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test("empty MAX_TOKENS documents can be repaired, without exposing thoughts as output", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async (url) => {
      if (!String(url).includes(":generateContent")) return new Response(JSON.stringify({ models: [{ name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] }] }));
      calls++;
      return new Response(JSON.stringify({ candidates: [{ content: { parts: calls === 1 ? [] : [{ text: "complete final" }] }, finishReason: calls === 1 ? "MAX_TOKENS" : "STOP" }], usageMetadata: usage }));
    };
    const result = await geminiGenerateDetailed([{ text: document }], "Tutor", { apiKey: "test-empty-document", models: ["gemini-2.5-flash"], strictModel: true, maxOutputTokens: 16000, retryTruncatedDocument: true });
    assert.equal(result.text, "complete final");
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});

test("all ask paths enable bounded document repair, math and ingredient identities have consistent guidance", () => {
  const route = readFileSync("app/api/ask/route.ts", "utf8");
  assert.match(route, /retryTruncatedDocument: lengthPlan.kind === "document"/);
  assert.match(route, /identitas koformer kokristal/);
  assert.match(WHATSAPP_FORMAT_INSTRUCTION, /KaTeX/);
  assert.doesNotMatch(WHATSAPP_FORMAT_INSTRUCTION, /Untuk rumus, JANGAN bungkus/);
});

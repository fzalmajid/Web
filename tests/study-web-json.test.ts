import test from "node:test";
import assert from "node:assert/strict";
import { generateTextAi } from "../lib/requestTextAi";
import { geminiGenerateDetailed } from "../lib/gemini";

const info = {
  selection: { model: "gemini-2.5-flash" as const, effort: "none" as const, length: "medium" as const },
  provider: "gemini" as const, providerModel: "gemini-2.5-flash",
  geminiAuth: { apiKey: "test-key-not-a-secret", accessToken: "", projectId: "", ownGemini: true, provider: "user-api-key" as const },
  openAIKey: "", anthropicKey: "", sharedGemini: false, sharedOpenAI: false,
};

test("Study Web researches with tools then creates JSON without tools, retaining evidence and usage", async () => {
  const original = globalThis.fetch;
  const calls: any[] = [];
  globalThis.fetch = async (_url, init) => {
    if (!init?.body) return Response.json({ models: [{ name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] }] });
    const body = JSON.parse(String(init.body)); calls.push(body);
    return Response.json({ candidates: [{ content: { parts: [{ text: body.tools ? "Fakta berbasis sumber yang ditelusuri." : '{"units":[{"title":"Bab user"}]}' }] },
      ...(body.tools ? { groundingMetadata: { groundingChunks: [{ web: { title: "Publication", uri: "https://example.org/paper" } }] } } : {}) }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 30 } });
  };
  try {
    const result = await generateTextAi(info, "high", "Buat Study JSON untuk Bab user", "Sumber aktif Web", { web: true, json: true });
    assert.equal(calls.length, 2);
    assert.ok(calls[0].tools);
    assert.equal(calls[0].generationConfig.responseMimeType, undefined);
    assert.equal(calls[1].tools, undefined);
    assert.equal(calls[1].generationConfig.responseMimeType, "application/json");
    assert.match(calls[1].contents[0].parts[0].text, /https:\/\/example.org\/paper/);
    assert.match(calls[1].contents[0].parts[0].text, /Bab user/);
    assert.equal(result.webSources.length, 1);
    assert.equal(result.usage.totalTokens, 60);
  } finally { globalThis.fetch = original; }
});

test("Web with no grounding evidence does not silently become an internal-knowledge Study", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => init?.body ? Response.json({ candidates: [{ content: { parts: [{ text: "No sources" }] } }] }) : Response.json({ error: { message: "Discovery unavailable" } }, { status: 503 });
  try {
    await assert.rejects(() => generateTextAi(info, "instant", "Study", "Web", { web: true, json: true }), (error: any) => error.code === "WEB_EVIDENCE_MISSING");
  } finally { globalThis.fetch = original; }
});

test("JSON without Web needs one generation, and configuration errors do not masquerade as missing models", async () => {
  const original = globalThis.fetch;
  let generations = 0;
  globalThis.fetch = async (_url, init) => {
    if (!init?.body) return Response.json({ error: { message: "Discovery unavailable" } }, { status: 503 });
    generations++;
    return Response.json({ candidates: [{ content: { parts: [{ text: '{"units":[]}' }] } }] });
  };
  try {
    await generateTextAi(info, "instant", "Study", "Database", { json: true });
    assert.equal(generations, 1);
    globalThis.fetch = async (_url, init) => init?.body ? Response.json({ error: { message: "Invalid argument: unsupported generation config" } }, { status: 400 }) : Response.json({ error: { message: "Discovery unavailable" } }, { status: 503 });
    await assert.rejects(() => geminiGenerateDetailed([{ text: "Test" }], "", { apiKey: "test-only", models: ["gemini-2.5-flash"] }), (error: any) => error.code === "GEMINI_CONFIG_INCOMPATIBLE" && error.statusCode === 400);
  } finally { globalThis.fetch = original; }
});

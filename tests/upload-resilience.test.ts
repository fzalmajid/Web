import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { generateUploadText, UPLOAD_MODELS } from "../lib/uploadAi";

test("Upload routes past busy Flash models to working fallback, not chat preview models", async () => {
  const original = globalThis.fetch;
  const attempts: string[] = [];
  try {
    globalThis.fetch = async (url, init) => {
      if (!init?.body) return Response.json({ models: UPLOAD_MODELS.map(name => ({ name: "models/" + name, supportedGenerationMethods: ["generateContent"] })) });
      attempts.push(String(url));
      const body = JSON.parse(String(init.body));
      assert.equal(body.generationConfig.maxOutputTokens, 12288);
      assert.ok(init.signal);
      return attempts.length < 3 ? Response.json({ error: { message: "Service unavailable", status: "UNAVAILABLE" } }, { status: 503 })
        : Response.json({ candidates: [{ content: { parts: [{ text: "Actual extracted text" }] }, finishReason: "STOP" }] });
    };
    const result = await generateUploadText([{ text: "Read source" }], undefined, { apiKey: "test-upload-key" });
    assert.equal(result.text, "Actual extracted text"); assert.equal(result.model, "gemini-2.5-flash");
    assert.equal(attempts.length, 3); assert.ok(attempts.every(url => !/3\.[678]|pro/.test(url)));
  } finally { globalThis.fetch = original; }
});
test("Expired Office extraction budget stops before making additional provider calls", async () => {
  await assert.rejects(generateUploadText([{ text: "source" }], undefined, { deadlineAt: Date.now() - 1 }), /File asli tetap tersimpan/);
});
test("Server OCR packaging preserves Node worker and bounded PDF batches", () => {
  const config = fs.readFileSync("next.config.ts", "utf8"), local = fs.readFileSync("lib/localOcrServer.ts", "utf8"), visual = fs.readFileSync("lib/visualOcr.ts", "utf8");
  assert.match(config, /serverExternalPackages:.*tesseract.js/);
  assert.match(config, /outputFileTracingIncludes/);
  assert.ok(fs.existsSync("node_modules/tesseract.js/src/worker-script/node/index.js"));
  assert.match(local, /access\(workerPath\)/); assert.match(local, /bounded\(creation, 20000\)/);
  assert.match(visual, /PDF_PAGES_PER_BATCH = 2/);
  assert.doesNotMatch(visual, /models: modelPlanForSelection/);
});

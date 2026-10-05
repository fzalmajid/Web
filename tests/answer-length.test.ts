import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planAnswerLength, answerLengthInstruction, answerLengthStatus } from "../lib/answerLength";
import { openaiGenerateDetailed, anthropicGenerateDetailed } from "../lib/externalAi";
import { geminiGenerateDetailed } from "../lib/gemini";

const fullReport = "Buatkan laporan utuh berisi dasar teori, monografi, alat dan bahan, cara kerja, hasil pengamatan, pembahasan, kesimpulan.";

test("greetings and factual questions reserve less output than explanations and complete reports", () => {
  const greeting = planAnswerLength("Halo");
  const brief = planAnswerLength("Apa itu absorbansi?");
  const explanation = planAnswerLength("Jelaskan prinsip absorbansi");
  const report = planAnswerLength(fullReport);
  assert.ok(greeting.targetCharacters < brief.targetCharacters);
  assert.ok(brief.targetCharacters < explanation.targetCharacters);
  assert.ok(explanation.targetCharacters < report.targetCharacters);
  assert.equal(report.kind, "document");
  assert.equal(report.sections.length, 7);
  assert.ok(report.targetCharacters >= 10000);
  assert.ok(report.maxOutputTokens > 8192);
});

test("depth reserves reasoning capacity without forcing longer visible text", () => {
  const instant = planAnswerLength("Apa itu absorbansi?", "none");
  const high = planAnswerLength("Apa itu absorbansi?", "high");
  assert.equal(high.targetCharacters, instant.targetCharacters);
  assert.ok(high.maxOutputTokens > instant.maxOutputTokens);
});

test("concise multi-section reports retain the section checklist", () => {
  const brief = planAnswerLength(fullReport + " Jawab ringkas.");
  assert.equal(brief.sections.length, 7);
  assert.ok(brief.targetCharacters < planAnswerLength(fullReport).targetCharacters);
  assert.ok(brief.targetCharacters >= 1500);
});

test("explicit Indonesian character, word and sentence limits take precedence", () => {
  const chars = planAnswerLength(fullReport + " Maksimal 2.000 karakter.");
  assert.deepEqual(chars.explicit, { unit: "characters", amount: 2000, maximum: true });
  assert.equal(chars.maxCharacters, 2000);
  const words = planAnswerLength("Jelaskan rinci dalam 1,000 kata.");
  assert.equal(words.explicit?.amount, 1000);
  assert.equal(words.targetCharacters, 6000);
  assert.match(answerLengthInstruction(words), /1000 kata/);
  assert.equal(planAnswerLength("Jelaskan dalam 2 kalimat").explicit?.unit, "sentences");
  assert.equal(planAnswerLength("Jelaskan maksimal 1 karakter").maxCharacters, 1);
});

test("drug quantities and wavelength are not output length requests", () => {
  assert.equal(planAnswerLength("Jelaskan tablet 500 mg tahun 2024").explicit, null);
  assert.equal(planAnswerLength("Apa itu panjang gelombang?").kind, "brief");
  assert.equal(planAnswerLength("Apa itu laporan praktikum lengkap?").kind, "brief");
});

test("complete report defaults and long list requests get enough capacity", () => {
  assert.equal(planAnswerLength("Buatkan laporan praktikum lengkap").sections.length, 7);
  assert.ok(planAnswerLength("Berikan 12 contoh penerapan hukum Beer-Lambert").targetCharacters >= 4200);
  assert.ok(planAnswerLength("Tulis laporan dalam 999999 kata").maxOutputTokens <= 32768);
});

test("AI sizing instructions prioritize semantic completeness and honest missing data", () => {
  const instruction = answerLengthInstruction(planAnswerLength(fullReport));
  assert.match(instruction, /prediksi kebutuhan panjang/);
  assert.match(instruction, /BUKAN kuota/);
  assert.match(instruction, /AI boleh menyesuaikan/);
  assert.match(instruction, /bukan panjang catatan agen/);
  assert.match(instruction, /Jangan mengarang angka hasil pengamatan/);
  assert.match(instruction, /Instant boleh panjang/);
});

test("completion status counts Unicode characters and flags provider truncation only", () => {
  const plan = planAnswerLength("Halo");
  assert.equal(answerLengthStatus(plan, "A😊B", "STOP").actualCharacters, 3);
  for (const reason of ["MAX_TOKENS", "max_tokens", "length", "max_output_tokens"]) {
    assert.equal(answerLengthStatus(plan, "partial", reason).truncated, true);
  }
  assert.equal(answerLengthStatus(plan, "done", "end_turn").truncated, false);
});

test("all ask generation paths share adaptive budgets and avoid fixed medium instructions", () => {
  const route = readFileSync("app/api/ask/route.ts", "utf8");
  assert.equal((route.match(/\.\.\.generationLength/g) || []).length, 8);
  assert.equal(route.includes("responseLength: aiSelection.length"), false);
  assert.match(route, /adaptiveLengthPrompt \+ "\\n\\n" \+ buildPrompt/);
  assert.match(route, /answerLengthStatus\(lengthPlan,fallbackResult/);
});

test("external providers receive the report budget and preserve truncation metadata", async () => {
  const original = globalThis.fetch;
  const requests: any[] = [];
  try {
    globalThis.fetch = async (url, options) => {
      requests.push(JSON.parse(String(options?.body)));
      return new Response(JSON.stringify(String(url).includes("anthropic")
        ? { content: [{ type: "text", text: "partial report" }], stop_reason: "max_tokens", usage: {} }
        : { output_text: "partial report", status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, usage: {} }), { status: 200 });
    };
    const plan = planAnswerLength(fullReport);
    const openai = await openaiGenerateDetailed({ apiKey: "test-not-a-real-key", model: "test-model", prompt: fullReport, maxOutputTokens: plan.maxOutputTokens });
    const anthropic = await anthropicGenerateDetailed({ apiKey: "test-not-a-real-key", model: "test-model", prompt: fullReport, maxOutputTokens: plan.maxOutputTokens });
    assert.equal(requests[0].max_output_tokens, plan.maxOutputTokens);
    assert.ok(requests[1].max_tokens >= plan.maxOutputTokens);
    assert.equal(answerLengthStatus(plan, openai.text, openai.finishReason).truncated, true);
    assert.equal(answerLengthStatus(plan, anthropic.text, anthropic.finishReason).truncated, true);
  } finally { globalThis.fetch = original; }
});

test("Gemini receives adaptive capacity, not a fixed medium word limit", async () => {
  const original = globalThis.fetch;
  let request: any;
  try {
    globalThis.fetch = async (url, options) => {
      if (String(url).includes(":generateContent")) {
        request = JSON.parse(String(options?.body));
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "report text" }] }, finishReason: "MAX_TOKENS" }], usageMetadata: {} }), { status: 200 });
      }
      return new Response(JSON.stringify({ models: [{ name: "models/test-model", supportedGenerationMethods: ["generateContent"] }] }), { status: 200 });
    };
    const plan = planAnswerLength(fullReport);
    const result = await geminiGenerateDetailed([{ text: answerLengthInstruction(plan) + fullReport }], "Tutor", {
      apiKey: "test-not-a-real-key-adaptive", models: ["test-model"], strictModel: true,
      maxOutputTokens: plan.maxOutputTokens, outputBudgetMultiplier: 1,
    });
    assert.equal(request.generationConfig.maxOutputTokens, plan.maxOutputTokens);
    assert.equal(request.systemInstruction.parts[0].text, "Tutor");
    assert.equal(result.finishReason, "MAX_TOKENS");
  } finally { globalThis.fetch = original; }
});

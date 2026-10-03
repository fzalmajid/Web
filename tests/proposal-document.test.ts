import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planAnswerLength, answerLengthInstruction } from "../lib/answerLength";
import { userFormulaProposal, userFormulaPrompt, userFormulaNotice, requiresQuantitativePaperEvidence, guardAnswerBibliography } from "../lib/answerEvidence";

const request = "buatkan untuk ppt formulasi tablet konvensional dipiridamol untuk 500mg tab, untuk 500pcs per batch, dasar teori, usulan formulasi (tabel bahan fungsi rentang lazim alasan), perhitungan bahan (g perbatch), monografi bahan hanya FI FHI HOPE, alat bahan, diagram alir kotak dan panah, cara kerja, evaluasi mutu sediaan tablet, studi kasus permasahan yang mungkin terjadi, daftar pustaka. usulan untuk saat ini adalah DPMH cocystal 52mg (50mg dipiridamol) 10,4%, ocimum basilicum 50mg 10%, MCC 150mg 30%, mg stearat 10mg 2%, mannitol 238mg 47,6%. jurnal terbaru 10 tahun terakhir minimal 5 jurnal 3 buku.";

test("multi-section PPT budgets include formula, batch, diagram, quality tests and cases", () => {
  const plan = planAnswerLength(request, "high");
  assert.equal(plan.kind, "document");
  assert.equal(plan.explicit, null);
  for (const section of ["Dasar teori", "Monografi", "Alat dan bahan", "Cara kerja", "Usulan formulasi", "Perhitungan bahan", "Diagram alir", "Evaluasi mutu", "Studi kasus", "Daftar pustaka"]) assert.ok(plan.sections.includes(section), section);
  assert.ok(plan.targetCharacters >= 17000);
  assert.ok(plan.maxOutputTokens > 12000);
  assert.match(answerLengthInstruction(plan), /bukan sekadar outline|Bagi panjang secara proporsional/);
  assert.equal(planAnswerLength("Buatkan PPT ringkas tentang absorbansi").kind, "document");
});

test("provided ingredients allow a proposal but do not validate a journal recipe", () => {
  assert.equal(requiresQuantitativePaperEvidence(request), true);
  assert.equal(userFormulaProposal(request), true);
  assert.equal(userFormulaProposal("Carikan 2 formulasi dari jurnal dengan eksipien dan mg"), false);
  assert.equal(userFormulaProposal("Buatkan usulan formulasi dari jurnal untuk tablet 500 mg dan dosis 50 mg"), false);
  assert.equal(userFormulaProposal("Buatkan usulan formulasi MCC 150 mg, mannitol 238 mg dari jurnal"), true);
  assert.equal(userFormulaProposal("Carikan usulan formula MCC 150 mg, mannitol 238 mg dari jurnal"), false);
});

test("proposal prompt preserves arithmetic, missing monographs and honest source counts", () => {
  assert.equal(userFormulaPrompt(false), "");
  const prompt = userFormulaPrompt(true);
  for (const phrase of [/g\/batch/, /usulan user/, /total massa dan persentase/, /asumsi belum diverifikasi/, /FI\/FHI\/HOPE/, /tanpa mengarang isi buku/, /kuota minimal jurnal\/buku/, /paling akhir/]) assert.match(prompt, phrase);
  assert.match(userFormulaNotice, /bukan formula jurnal tervalidasi/);
  assert.match(userFormulaNotice, /bukan petunjuk produksi/);
});

test("proposal retains supported calculations while removing unknown bibliography, strict recipes remain blocked", () => {
  const answer = "Usulan user: MCC 150 mg × 500 / 1000 = 75 g.\nReferences:\nInvented reference (2024). Not found.";
  const proposal = guardAnswerBibliography(answer, [], "apa", false);
  assert.equal(proposal.blocked, false);
  assert.match(proposal.text, /75 g/);
  assert.doesNotMatch(proposal.text, /Invented reference/);
  assert.equal(guardAnswerBibliography(answer, [], "apa", true).blocked, true);
  assert.equal(guardAnswerBibliography("Pustaka Internal Farmasi", [], "apa", false).blocked, true);
});

test("all final-generation paths share proposal scope without bypassing the old strict gate", () => {
  const route = readFileSync("app/api/ask/route.ts", "utf8");
  assert.match(route, /suppliedFormula=quantitativePaper&&userFormulaProposal\(question\)/);
  assert.match(route, /if\(quantitativePaper&&!suppliedFormula&&!paperEvidence/);
  assert.match(route, /citationStyle,quantitativePaper&&!suppliedFormula,blockedCitations/);
  assert.match(route, /userFormulaNotice\+"\\n\\n"\+guarded.text/);
  assert.equal((route.match(/\+proposalPrompt\+/g) || []).length, 2);
  assert.match(route, /Jangan gunakan garis bawah Markdown/);
});

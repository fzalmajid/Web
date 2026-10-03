import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { guardAnswerBibliography } from "../lib/answerEvidence";
import { recoverDocumentBibliography, monographInstruction } from "../lib/documentEvidence";
import { scientificQueryPlan } from "../lib/researchQuery";

const article={title:"Actual retrieved pharmaceutical publication",doi:"10.1234/real",uri:"https://doi.org/10.1234/real",formatted:"Author (2024). Actual retrieved pharmaceutical publication. https://doi.org/10.1234/real",catalogOnly:true};
test("live generic Indonesian request does not recover unrelated DOI works",()=>{
  const question="Jelaskan singkat apa itu kokristal dipiridamol dan sertakan daftar pustaka publikasi nyata dengan DOI atau tautan penerbit.";
  const plan=scientificQueryPlan(question);
  assert.equal(plan.requiredTerm,"dipyridamole");
  assert.doesNotMatch(plan.query,/jelaskan|singkat|apa|itu/);
  const real={...article,title:"Dipyridamole cocrystal tablets with enhanced dissolution",formatted:"Author (2024). Dipyridamole cocrystal tablets with enhanced dissolution."};
  const irrelevant={...article,title:"Apa itu internet? Ilmuwan komputer menjawabnya",doi:"10.1234/unrelated"};
  const result=recoverDocumentBibliography("Body.",[real,irrelevant],[],question);
  assert.match(result.text,/Dipyridamole/);assert.doesNotMatch(result.text,/internet|unrelated/);
});
test("missing model references recover real catalog identities with explicit claim limitations",()=>{
  const guarded=guardAnswerBibliography("Usulan user.\nReferences:\nInvented reference.",[article],"apa");
  const result=recoverDocumentBibliography(guarded.text,[article,article]);
  assert.match(result.text,/References — bacaan pendukung/);
  assert.match(result.text,/10.1234\/real/);
  assert.match(result.text,/belum dihubungkan dengan setiap klaim/);
  assert.doesNotMatch(result.text,/Invented|Tidak ada referensi formal/);
  assert.equal(result.text.split("Author (2024)").length,2);
});
test("slide bibliography headings are canonicalized, not silently left as fabricated entries",()=>{
  const result=guardAnswerBibliography("Body.\n### Slide 13 — Daftar Pustaka\nWrong Author. Actual retrieved pharmaceutical publication.\nFake work.",[article],"apa");
  assert.match(result.text,/Author \(2024\)/);assert.doesNotMatch(result.text,/Wrong Author|Fake work/);
  assert.equal(recoverDocumentBibliography(result.text,[article]).text,result.text);
});
test("recovery rejects generic web pages, unsafe links and publication conflicts",()=>{
  const result=recoverDocumentBibliography("Body.",[
    {title:"Some page",uri:"https://example.org",formatted:"[Some page](https://example.org)"},
    {title:"Book without a safe source",uri:"javascript:alert(1)",formatted:"An official book"},article
  ],[article]);
  assert.equal(result.text,"Body.");assert.equal(result.warnings.length,0);
});
test("book references need no DOI; numeric labels are not reassigned to claims",()=>{
  const book={title:"Official retrieved book",uri:"https://publisher.example/book",formatted:"[1] Official retrieved book. Publisher."};
  const result=recoverDocumentBibliography("Body [9].",[book]);
  assert.match(result.text,/publisher.example\/book/);assert.match(result.text,/Body \[9\]/);
  assert.doesNotMatch(result.text,/\[1\]/);
});
test("DOI in body alone is not mistaken for a bibliography entry",()=>{
  assert.match(recoverDocumentBibliography("See https://doi.org/10.1234/real",[article]).text,/References —/);
});
test("monographs request source structure, all ingredients, locators and reproduction limits",()=>{
  const prompt=monographInstruction("monografi semua bahan FI FHI HOPE");
  for(const term of ["SETIAP bahan","kemurnian","penetapan kadar","halaman","monografi parsial","parafrasa","izin","coformer"])assert.ok(prompt.includes(term));
  assert.equal(monographInstruction("Apa itu absorbansi?"),"");
  const route=readFileSync("app/api/ask/route.ts","utf8");
  assert.ok(route.indexOf("proposalPrompt+documentEvidencePrompt+visualLearningInstruction+publicCitationPrompt")>=0);
  assert.match(route,/!guarded.blocked&&!skipFormatWarnings&&citationStyle!=="none"/);
});

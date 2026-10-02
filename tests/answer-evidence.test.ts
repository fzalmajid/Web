import {test} from "node:test";
import assert from "node:assert/strict";
import {scientificQueryPlan,matchesRequiredTopic} from "../lib/researchQuery";
import {guardAnswerBibliography,requiresQuantitativePaperEvidence} from "../lib/answerEvidence";
import {publisherPdfLinks,paperTitleMatches,selectEvidencePages} from "../lib/scholarlyFullText";

test("Indonesian recipe search retains the exact drug, not a sentence or DAP ambiguity",()=>{
  const question="carikan resep formulasi tablet konvensional dipyridamole dari jurnal tervalidai, baik modifikasi cocrystal maupun bukan, minimal 2 model resep formula, dari bahan aktif, eksipien, jumlah(mg) juga disebutkan";
  // 'juga' is a connector, not part of the scientific target.
  const plan=scientificQueryPlan(question);
  assert.equal(plan.requiredTerm,"dipyridamole");assert.equal(plan.query,"dipyridamole tablet cocrystal");
  assert.equal(matchesRequiredTopic("Dapagliflozin DAP cocrystals",plan.requiredTerm),false);
  assert.equal(requiresQuantitativePaperEvidence(question),true);
});
test("a fake internal library blocks the entire formula, not just its link",()=>{
  const result=guardAnswerBibliography("Drug 25 mg\nReferences:\nFormulasi tablet dipyridamole konvensional. (n.d.). Pustaka Internal Farmasi.",[],"apa",true);
  assert.equal(result.blocked,true);assert.doesNotMatch(result.text,/25 mg/);
});
test("unknown journal identities cannot become validated recipes",()=>{
  const result=guardAnswerBibliography("Invented 75 mg\nReferences:\nSomeone (2020). Fake trial.",[{title:"Actual tablet formulation",doi:"10.1/real"}],"apa",true);
  assert.equal(result.blocked,true);assert.doesNotMatch(result.text,/75 mg/);
});
test("known bibliography uses canonical retrieved metadata",()=>{
  const result=guardAnswerBibliography("Study result.\nReferences:\nWrong Author (2020). Real article title. https://doi.org/10.1/real",[{title:"Real article title",doi:"10.1/real",formatted:"Actual Author (2024). Real article title. https://doi.org/10.1/real"}],"apa",true);
  assert.equal(result.blocked,false);assert.match(result.text,/Actual Author \(2024\)/);assert.doesNotMatch(result.text,/Wrong Author/);
});
test("publisher PDF discovery does not invent mirrors or follow bibliography links",()=>{
  assert.deepEqual(publisherPdfLinks('<meta name="citation_pdf_url" content="/article.pdf"><a href="https://doi.org/10.1/reference">Reference</a><a href="javascript:alert(1)">PDF</a>',"https://example.org/paper"),["https://example.org/article.pdf"]);
  assert.equal(paperTitleMatches("Dipyridamole cocrystal tablets with enhanced solubility","Dipyridamole cocrystal tablets with enhanced solubility"),true);
  assert.equal(paperTitleMatches("Dipyridamole cocrystal tablets with enhanced solubility","Dapagliflozin drug product"),false);
  assert.ok(selectEvidencePages([{page:1,text:"Introduction".repeat(1000)},{page:2,text:"Table 1: composition mg 26 4 64 102 4"}],900).some(page=>page.page===2&&page.text.includes("26 4 64 102 4")));
});

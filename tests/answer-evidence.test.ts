import {test} from "node:test";
import assert from "node:assert/strict";
import {scientificQueryPlan,matchesRequiredTopic} from "../lib/researchQuery";
import {guardAnswerBibliography,requiresQuantitativePaperEvidence} from "../lib/answerEvidence";
import {publisherPdfLinks,paperTitleMatches,selectEvidencePages,publisherArticleMetadata} from "../lib/scholarlyFullText";
import {answerCitationInventory} from "../lib/answerCitationServer";

test("Indonesian recipe search retains the exact drug, not a sentence or DAP ambiguity",()=>{
  const question="carikan resep formulasi tablet konvensional dipyridamole dari jurnal tervalidai, baik modifikasi cocrystal maupun bukan, minimal 2 model resep formula, dari bahan aktif, eksipien, jumlah(mg) juga disebutkan";
  // 'juga' is a connector, not part of the scientific target.
  const plan=scientificQueryPlan(question);
  assert.equal(plan.requiredTerm,"dipyridamole");assert.equal(plan.query,"dipyridamole tablet cocrystal");
  assert.equal(matchesRequiredTopic("Dapagliflozin DAP cocrystals",plan.requiredTerm),false);
  assert.equal(requiresQuantitativePaperEvidence(question),true);
});
test("publisher date is a publication date, not Crossref acceptance or DOI registration year",()=>{
  const hit:any={title:"Dipyridamole cocrystal tablets with enhanced solubility",doi:"10.55262/example",year:2023,journal:"Repository host",authors:[]};
  const meta='<meta name="citation_title" content="Dipyridamole cocrystal tablets with enhanced solubility"><meta name="citation_doi" content="10.55262/example"><meta name="citation_publication_date" content="2024-03-26"><meta name="citation_journal_title" content="Actual journal"><meta name="citation_volume" content="49"><meta name="citation_issue" content="1"><meta name="citation_firstpage" content="37"><meta name="citation_lastpage" content="50">';
  const result=publisherArticleMetadata(meta,hit);assert.equal(result.year,2024);assert.equal(result.pages,"37-50");assert.equal(result.journal,"Actual journal");assert.match(result.metadataNotice!,/differs/);
  assert.equal(publisherArticleMetadata(meta.replace("10.55262/example","10.55262/wrong"),hit),hit);
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
test("public full-text links are attached only to matched references actually read",()=>{
  const inventory=[{title:"Actual article about learning",doi:"10.1000/read",formatted:"Author (2024). Actual article about learning. https://doi.org/10.1000/read",readSource:{uri:"https://example.org/article.pdf",format:"full-text-pdf",pages:[3,5]}},{title:"Other article metadata only",doi:"10.1000/catalog",formatted:"Other (2020). Other article metadata only.",catalogOnly:true}];
  const answer="Summary.\nReferences:\nActual article about learning. https://doi.org/10.1000/read\nOther article metadata only. https://doi.org/10.1000/catalog";
  const result=guardAnswerBibliography(answer,inventory,"apa");
  assert.equal(result.blocked,false);assert.match(result.text,/Teks lengkap publik — PDF dibaca; halaman PDF 3, 5/);assert.match(result.text,/https:\/\/example.org\/article.pdf/);assert.match(result.text,/metadata\/abstrak; teks lengkap belum dibaca/);
  const unused=guardAnswerBibliography("References:\nOther article metadata only.",inventory,"apa");assert.doesNotMatch(unused.text,/article.pdf/);
  const unsafe=guardAnswerBibliography("References:\nActual article about learning.",[{...inventory[0],readSource:{uri:"javascript:alert(1)",format:"full-text-pdf",pages:[3]}}],"apa");assert.doesNotMatch(unsafe.text,/javascript:|Teks lengkap publik/);
});
test("repository alternatives require a real catalog PMCID and never become read or OA claims",()=>{
  const hit:any={title:"Actual public repository article",provider:"europepmc",doi:"10.1000/article",authors:[],pmcid:"PMC4808484",uri:"https://doi.org/10.1000/article",openAccess:false};
  const inventory=answerCitationInventory([hit],[],"none");
  assert.deepEqual(inventory[0].repositoryLinks?.map(item=>item.uri),["https://pmc.ncbi.nlm.nih.gov/articles/PMC4808484/","https://europepmc.org/articles/PMC4808484"]);
  const result=guardAnswerBibliography("Summary.\nReferences:\nActual public repository article.",inventory,"apa");
  assert.match(result.text,/Artikel di PMC/);assert.match(result.text,/teks lengkap belum dibaca/);assert.doesNotMatch(result.text,/PDF dibaca|open.access=yes/);
  assert.deepEqual(answerCitationInventory([{...hit,pmcid:"PMC4808484/../../wrong"}],[],"none")[0].repositoryLinks,[]);
});

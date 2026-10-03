import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {scientificQueryPlan,matchesRequiredTopic} from "../lib/researchQuery";
import {guardAnswerBibliography,requiresQuantitativePaperEvidence,publicEvidenceFallbackNotice,readableEvidenceLabels} from "../lib/answerEvidence";
import {publisherPdfLinks,paperTitleMatches,selectEvidencePages,publisherArticleMetadata} from "../lib/scholarlyFullText";
import {answerCitationInventory} from "../lib/answerCitationServer";
import {scholarlyPromptContext,scholarlyWebSources} from "../lib/scholarlySources";

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
  const result=guardAnswerBibliography("Study result (Actual Author, 2024).\nReferences:\nWrong Author (2020). Real article title. https://doi.org/10.1/real",[{title:"Real article title",doi:"10.1/real",formatted:"Actual Author (2024). Real article title. https://doi.org/10.1/real",authorYearKeys:["Actual Author 2024"]}],"apa",true);
  assert.equal(result.blocked,false);assert.match(result.text,/Actual Author \(2024\)/);assert.doesNotMatch(result.text,/Wrong Author/);
});
test("publisher PDF discovery does not invent mirrors or follow bibliography links",()=>{
  assert.deepEqual(publisherPdfLinks('<meta name="citation_pdf_url" content="/article.pdf"><a href="https://doi.org/10.1/reference">Reference</a><a href="javascript:alert(1)">PDF</a>',"https://example.org/paper"),["https://example.org/article.pdf"]);
  assert.equal(paperTitleMatches("Dipyridamole cocrystal tablets with enhanced solubility","Dipyridamole cocrystal tablets with enhanced solubility"),true);
  assert.equal(paperTitleMatches("Dipyridamole cocrystal tablets with enhanced solubility","Dapagliflozin drug product"),false);
  assert.ok(selectEvidencePages([{page:1,text:"Introduction".repeat(1000)},{page:2,text:"Table 1: composition mg 26 4 64 102 4"}],900).some(page=>page.page===2&&page.text.includes("26 4 64 102 4")));
});
test("public full-text links are attached only to matched references actually read",()=>{
  const inventory=[{title:"Actual article about learning",doi:"10.1000/read",formatted:"Author (2024). Actual article about learning. https://doi.org/10.1000/read",authorYearKeys:["Author 2024"],readSource:{uri:"https://example.org/article.pdf",format:"full-text-pdf",pages:[3,5]}},{title:"Other article metadata only",doi:"10.1000/catalog",formatted:"Other (2020). Other article metadata only.",authorYearKeys:["Other 2020"],catalogOnly:true}];
  const answer="Summary (Author, 2024; Other, 2020).\nReferences:\nActual article about learning. https://doi.org/10.1000/read\nOther article metadata only. https://doi.org/10.1000/catalog";
  const result=guardAnswerBibliography(answer,inventory,"apa");
  assert.equal(result.blocked,false);assert.match(result.text,/Teks lengkap publik — PDF dibaca; halaman PDF 3, 5/);assert.match(result.text,/https:\/\/example.org\/article.pdf/);assert.match(result.text,/metadata\/abstrak; teks lengkap belum dibaca/);
  const unused=guardAnswerBibliography("References:\nOther article metadata only.",inventory,"apa");assert.doesNotMatch(unused.text,/article.pdf/);
  const unsafe=guardAnswerBibliography("References:\nActual article about learning.",[{...inventory[0],readSource:{uri:"javascript:alert(1)",format:"full-text-pdf",pages:[3]}}],"apa");assert.doesNotMatch(unsafe.text,/javascript:|Teks lengkap publik/);
});
test("repository alternatives require a real catalog PMCID and never become read or OA claims",()=>{
  const hit:any={title:"Actual public repository article",provider:"europepmc",doi:"10.1000/article",authors:["Author Example"],year:2024,pmcid:"PMC4808484",uri:"https://doi.org/10.1000/article",openAccess:false};
  const inventory=answerCitationInventory([hit],[],"none");
  assert.deepEqual(inventory[0].repositoryLinks?.map(item=>item.uri),["https://pmc.ncbi.nlm.nih.gov/articles/PMC4808484/","https://europepmc.org/articles/PMC4808484"]);
  const result=guardAnswerBibliography("Summary (Example, 2024).\nReferences:\nActual public repository article.",inventory,"apa");
  assert.match(result.text,/Artikel di PMC/);assert.match(result.text,/teks lengkap belum dibaca/);assert.doesNotMatch(result.text,/PDF dibaca|open.access=yes/);
  assert.deepEqual(answerCitationInventory([{...hit,pmcid:"PMC4808484/../../wrong"}],[],"none")[0].repositoryLinks,[]);
});

test("cited catalog works in limitations are included without adding unused or ambiguous works",()=>{
  const main={title:"Public tablet research article",doi:"10.1000/formula",formatted:"First (2024). Public tablet research article.",authorYearKeys:["First 2024"]};
  const additional={title:"Other matrix research article",doi:"10.1000/matrix",formatted:"Other (2023). Other matrix research article. https://doi.org/10.1000/matrix",authorYearKeys:["Other et al 2023"],catalogOnly:true};
  const unused={title:"Uncited research article",doi:"10.1000/unused",authorYearKeys:["Unused 2022"]};
  const result=guardAnswerBibliography("Formula (First, 2024). Metadata only for Other et al. (2023).\nReferences:\nPublic tablet research article.",[main,additional,unused],"apa",true);
  assert.equal(result.blocked,false);assert.match(result.text,/https:\/\/doi.org\/10.1000\/matrix/);assert.match(result.text,/metadata\/abstrak; teks lengkap belum dibaca/);assert.doesNotMatch(result.text,/Uncited research/);
  assert.ok(result.text.indexOf("First (2024)")<result.text.indexOf("Other (2023)"));
  const ambiguous=guardAnswerBibliography("Other et al. (2023).\nReferences:\nPublic tablet research article.",[main,additional,{...additional,title:"Different work with same author and year",doi:"10.1000/ambiguous"}],"apa");
  assert.doesNotMatch(ambiguous.text,/10.1000\/matrix|10.1000\/ambiguous/);
  const numeric=guardAnswerBibliography("Other et al. (2023). Main [1].\nReferences:\n[1] Public tablet research article.",[main,additional],"ieee");
  assert.doesNotMatch(numeric.text,/10.1000\/matrix/);assert.match(numeric.text,/\[1\] First/);
});

test("author-year matching uses verified CSL names and the exact year, never surname mentions alone",()=>{
  const hit:any={title:"Public two author study",provider:"europepmc",doi:"10.1000/study",authors:["Wikarsa S","Mauilida L"],year:2011,uri:"https://doi.org/10.1000/study"};
  const item=answerCitationInventory([hit],[],"apa")[0];
  assert.ok(item.authorYearKeys?.includes("Wikarsa dan Mauilida 2011"));
  const main={title:"Main publication title",formatted:"Main bibliography."};
  const positive=guardAnswerBibliography("Wikarsa dan Mauilida (2011).\nReferences:\nMain publication title.",[main,item],"apa");
  assert.match(positive.text,/10.1000\/study/);
  for(const text of ["Wikarsa dan Mauilida (2010)","Wikarsa discussed this in 2011", "NotWikarsa dan Mauilida (2011)"]){
    assert.doesNotMatch(guardAnswerBibliography(text+"\nReferences:\nMain publication title.",[main,item],"apa").text,/10.1000\/study/);
  }
});

test("public evidence notices report the actual read level, not a false Web failure",()=>{
  const full=publicEvidenceFallbackNotice({fullTextRead:true,pagesRead:false,metadataAvailable:true});
  assert.match(full,/teks penuh publik berhasil dibaca/);assert.doesNotMatch(full,/belum|tidak tersedia|Grounding/);
  const page=publicEvidenceFallbackNotice({fullTextRead:false,pagesRead:true,metadataAvailable:true});
  assert.match(page,/Halaman publik berhasil dibaca/);assert.doesNotMatch(page,/teks penuh.*berhasil dibaca/);
  const catalog=publicEvidenceFallbackNotice({fullTextRead:false,pagesRead:false,metadataAvailable:true});
  assert.match(catalog,/hanya metadata/);assert.match(catalog,/Teks penuh belum/);
  assert.match(publicEvidenceFallbackNotice({fullTextRead:false,pagesRead:false,metadataAvailable:false}),/Belum ada halaman Web/);
});

test("plain-provider fallback retains the actual full-text evidence state in its instructions",()=>{
  const route=readFileSync("app/api/ask/route.ts","utf8");
  const fallback=route.slice(route.indexOf("const fallbackPrompt"));
  assert.match(fallback,/evidenceRules\(Boolean\(paperEvidence\.length\|\|databaseFormulaEvidence\)\)/);
  assert.doesNotMatch(fallback,/evidenceRules\(false\)/);
  assert.match(fallback,/publicEvidenceFallbackNotice/);
});

test("known unresolved publication editions remain research links, not formal citations",()=>{
  const hit:any={title:"Versioned public article",provider:"crossref",authors:["Author A"],year:2025,doi:"10.1000/versioned",uri:"https://example.org/article",publicationVersionConflict:true,metadataNotice:"Printed edition differs from catalog year."};
  assert.deepEqual(answerCitationInventory([hit],[],"apa"),[]);
  assert.equal(scholarlyWebSources([hit])[0].uri,hit.uri);
  const prompt=scholarlyPromptContext([hit]);
  assert.match(prompt,/catalog_year_disputed=2025/);assert.match(prompt,/formal_citation=blocked/);assert.doesNotMatch(prompt,/(?:^|\| )year=2025/);
});

test("provider URL identities cannot bypass a known publication edition conflict",()=>{
  const conflict={title:"Versioned public research article",doi:"10.1000/version",uri:"https://example.org/versioned"};
  const provider={title:conflict.title,uri:conflict.uri,formatted:"[Versioned public research article](https://example.org/versioned)",authorYearKeys:["Author 2025"]};
  const result=guardAnswerBibliography("25 mg (Author, 2025).\nReferences:\nVersioned public research article. https://example.org/versioned",[provider],"apa",true,[conflict]);
  assert.equal(result.blocked,true);assert.doesNotMatch(result.text,/25 mg/);
  const main={title:"Matched main research article",formatted:"Main (2024). Matched main research article."};
  const repaired=guardAnswerBibliography("Main result; Author (2025).\nReferences:\nMatched main research article.",[main,provider],"apa",false,[conflict]);
  assert.doesNotMatch(repaired.text,/https:\/\/example.org\/versioned/);
});

test("internal excerpt labels become readable prose only when that excerpt was actually read",()=>{
  const answer="Berdasarkan bukti dalam **EVIDENCE 1**, total 200 mg (Author, 2024). EVIDENCE 2 belum dibaca.\nReferences:\nAuthor (2024). EVIDENCE 1: Actual article title.";
  const readable=readableEvidenceLabels(answer,1);
  assert.match(readable,/dalam \*\*sumber publik yang dibaca\*\*, total 200 mg \(Author, 2024\)/);
  assert.match(readable,/EVIDENCE 2 belum dibaca/);assert.match(readable,/References:\nAuthor \(2024\). EVIDENCE 1: Actual article title/);
  assert.equal(readableEvidenceLabels(answer,0),answer);
  const route=readFileSync("app/api/ask/route.ts","utf8");
  assert.match(route,/guardAnswerBibliography\(readableEvidenceLabels\(text,paperEvidence\.length\)/);
});

test("readable excerpt labels leave literal code and external link identities unchanged",()=>{
  const literals='`EVIDENCE 1`\n```text\nEVIDENCE 1\n```\n~~~text\nEVIDENCE 1\n~~~\n[EVIDENCE 1](https://example.org/EVIDENCE%201)\nhttps://example.org/EVIDENCE1';
  assert.equal(readableEvidenceLabels(literals,1),literals);
});

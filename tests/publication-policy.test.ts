import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {scientificQueryPlan,withinResearchScope,rankResearchHits} from "../lib/researchQuery";
import {documentWritingPolicy,isFormalPublication,monographAliases} from "../lib/documentPolicy";
import {guardAnswerBibliography} from "../lib/answerEvidence";
import {recoverDocumentBibliography} from "../lib/documentEvidence";
import {answerCitationInventory} from "../lib/answerCitationServer";
import {prioritizeQuestionRelevantSources} from "../lib/knowledge";

const request="buatkan untuk ppt formulasi tablet konvensional dipiridamol untuk 500mg tab, untuk 500pcs per batch, dasar teori, monografi bahan, alat bahan, daftar pustaka; jurnal terbaru 10 tahun terakhir";
test("live beta query separates topic from recency and DOI instructions",()=>{
  const question="Jelaskan konteks formulasi tablet konvensional dipiridamol dalam paragraf singkat. Sertakan daftar pustaka jurnal tentang dipiridamol yang relevan dari 10 tahun terakhir, DOI atau tautan penerbit. Jangan memakai floating atau sustained-release sebagai formula konvensional; bedakan metadata dari teks penuh yang dibaca.";
  assert.equal(scientificQueryPlan(question).requiredTerm,"dipyridamole");
  assert.equal(withinResearchScope({title:"Tren Riset Kesadaran Karier dalam 10 Tahun Terakhir",year:2025},question,2026),false);
  assert.equal(withinResearchScope({title:"Dipyridamole cocrystal tablet formulation",year:2024},question,2026),true);
});
test("long PPT request retains the named drug rather than general tablet vocabulary",()=>{
  const plan=scientificQueryPlan(request);assert.equal(plan.requiredTerm,"dipyridamole");
  assert.equal(withinResearchScope({title:"Atenolol tablet formulation",year:2024},request,2026),false);
  assert.equal(withinResearchScope({title:"Dipyridamole cocrystal tablet formulation",year:2024},request,2026),true);
  for(const title of ["Dipyridamole floating tablets","Dipyridamole sustained-release tablets"])assert.equal(withinResearchScope({title,year:2024},request,2026),false);
  assert.equal(withinResearchScope({title:"Dipyridamole tablets",year:2011},request,2026),false);
  assert.equal(withinResearchScope({title:"Dipyridamole tablets",year:null},request,2026),false);
});
test("ordinary materials are context, publication type is not a file extension",()=>{
  for(const type of ["lecture_slides","other","manual",undefined])assert.equal(isFormalPublication(type),false);
  for(const type of ["book","journal_article","chapter","report","thesis"])assert.equal(isFormalPublication(type),true);
  const policy=documentWritingPolicy();for(const term of ["HALAMAN CETAK","bukan nomor urutan PDF","paragraf","langkah bernomor","PPT"])assert.ok(policy.includes(term));
});
test("a short single-topic query cannot accept completely off-topic catalog titles",()=>{
  const hits=[{title:"Diabetes treatment trial"},{title:"Internet architecture"}];
  assert.deepEqual(rankResearchHits(hits,"diabetes"),[hits[0]]);
});
function metadata(type="book"){return {title:"Actual retrieved official book",type,authors:["Author Example"],year:2020,publisher:"Official Publisher",edition:"6",audit:{engineVersion:"public-library-v1",status:"manual",basis:"manual",checkedAt:"",matches:[],issues:[],missing:[],history:[]}} as any;}
test("book inventory aggregates printed pages, never substitutes PDF offsets, excludes slides",()=>{
  const rows=[{bibliographic_work_id:"book",bibliographic_metadata:metadata(),printed_page_start:"145",source_page_start:164},{bibliographic_work_id:"book",bibliographic_metadata:metadata(),printed_page_start:"146",source_page_start:165},{bibliographic_metadata:metadata("lecture_slides")}];
  const items=answerCitationInventory([],rows,"apa");assert.equal(items.length,1);assert.deepEqual(items[0].printedPages,["145","146"]);
  const result=guardAnswerBibliography("Content (Example, 2020).\nReferences:\nActual retrieved official book.",items,"apa");
  assert.doesNotMatch(result.text,/Halaman cetak sumber terambil|164|165|doi.org\/undefined/);assert.deepEqual(items[0].printedPages,["145","146"]);
  const missing=answerCitationInventory([],[{bibliographic_metadata:metadata(),source_page_start:164}],"apa");
  assert.deepEqual(missing[0].printedPages,[]);
  assert.match(guardAnswerBibliography("Content (Example, 2020).\nReferences:\nActual retrieved official book.",missing,"apa").warnings.join(" "),/nomor PDF tidak/);
});
test("real Library books without public URLs can still be listed without fabricated DOI",()=>{
  const items=answerCitationInventory([],[{bibliographic_metadata:metadata()}],"apa");
  const result=recoverDocumentBibliography("Fact (Example, 2020).",items);
  assert.match(result.text,/Official Publisher/);assert.doesNotMatch(result.text,/doi.org\/undefined/);
  assert.doesNotMatch(result.text,/https?:\/\//);assert.equal(recoverDocumentBibliography("No cited works.",items).text,"No cited works.");
});
test("existing cited bibliography does not get filled with unused DOI neighbors",()=>{
  const text="Claim.\n*References:*\nA genuine cited work.";
  assert.doesNotMatch(recoverDocumentBibliography(text,[{title:"Unused related publication",doi:"10.1234/unrelated"}]).text,/genuine cited work|Unused related publication/);
});
test("MCC aliases rank matching monograph contents above unrelated book pages",()=>{
  assert.ok(monographAliases("Monografi selulosa mikrokristal MCC").includes("microcrystalline cellulose"));
  const wrong={id:"wrong",title:"HOPE",content:"Iron oxide red specifications",score:5000} as any;
  const right={id:"right",title:"HOPE",content:"Microcrystalline cellulose: description and storage",score:1000} as any;
  assert.equal(prioritizeQuestionRelevantSources([wrong,right],"Monografi selulosa mikrokristal MCC")[0].id,"right");
});
test("High chat citation discovery reuses bounded OpenCitations and resolves DOI identities",()=>{
  const source=readFileSync("lib/scholarlySources.ts","utf8");
  assert.match(source,/paperConnections\(ranked\[0\]\.doi\)/);assert.match(source,/slice\(0,4\)/);
  assert.match(source,/searchCrossref\(edge.doi,1\)/);assert.match(source,/withinResearchScope\(hit,query\)/);
});

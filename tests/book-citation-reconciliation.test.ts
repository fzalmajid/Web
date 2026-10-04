import test from "node:test";
import assert from "node:assert/strict";
import {answerCitationInventory} from "../lib/answerCitationServer";
import {guardAnswerBibliography} from "../lib/answerEvidence";
import {withinResearchScope} from "../lib/researchQuery";
import {formatVerifiedReference,referenceToCsl,citationPreviews} from "../lib/citationFormatterServer";
import {citationInstruction,normalizeCitationOptions} from "../lib/citations";
import {readFileSync} from "node:fs";

function book(title="Farmakope Indonesia",year=2020,edition="VI",corporate_author="Kementerian Kesehatan Republik Indonesia"){
  return answerCitationInventory([],[{bibliographic_work_id:`${title}|${year}|${edition}`,printed_page_start:"145",bibliographic_metadata:{title,year,edition,corporate_author,type:"book",publisher:"Official Publisher",audit:{engineVersion:"public-library-v1",status:"manual",basis:"manual",checkedAt:"",matches:[],issues:[],missing:[],history:[]}}}],"apa")[0];
}
const paper={title:"Actual recent research article",doi:"10.1234/actual",formatted:"Researcher (2024). Actual recent research article.",authorYearKeys:["Researcher 2024"]};
test("book aliases cited in text restore canonical books beside existing journal references",()=>{
  for(const marker of ["FI, 2020","FI VI, 2020","Kemenkes RI, 2020","Kementerian Kesehatan RI, 2020"]){
    const result=guardAnswerBibliography(`Book fact (${marker}, hlm. 145). Paper (Researcher, 2024).\nReferences:\nActual recent research article.`,[book(),paper],"apa");
    assert.match(result.text,/Farmakope Indonesia/);assert.match(result.text,/Official Publisher/);assert.doesNotMatch(result.text,/Halaman cetak sumber terambil/);assert.doesNotMatch(result.warnings.join(" "),/belum dapat dipasangkan/);
  }
});
test("missing bibliography heading is restored only from uniquely cited available works",()=>{
  const result=guardAnswerBibliography("Book fact (FI, 2020, hlm. 145).",[book(),paper],"apa");
  assert.match(result.text,/References/);assert.match(result.text,/Farmakope Indonesia/);assert.doesNotMatch(result.text,/Actual recent research article/);
});
test("book year and edition collisions do not silently choose one source",()=>{
  const a=book(),b=book("Farmakope Indonesia",2020,"V");
  const ambiguous=guardAnswerBibliography("Book fact (FI, 2020).\nReferences:\nActual recent research article.",[a,b,paper],"apa");
  assert.doesNotMatch(ambiguous.text,/Official Publisher/);assert.match(ambiguous.warnings.join(" "),/belum dapat dipasangkan/);
  const exact=guardAnswerBibliography("Book fact (FI VI, 2020).",[a,b],"apa");assert.match(exact.text,/Official Publisher/);
  const wrongYear=guardAnswerBibliography("Book fact (FI, 2019).",[a],"apa");assert.doesNotMatch(wrongYear.text,/Official Publisher/);assert.match(wrongYear.warnings.join(" "),/belum dapat dipasangkan/);
});
test("HOPE and FHI aliases use only available book identities, not invented API books",()=>{
  const hope=book("Handbook of Pharmaceutical Excipients",2009,"6",""),fhi=book("Farmakope Herbal Indonesia",2017,"II","");
  const result=guardAnswerBibliography("Excipients (HOPE, 2009); herb (FHI, 2017).",[hope,fhi],"apa");
  assert.match(result.text,/Handbook of Pharmaceutical Excipients/);assert.match(result.text,/Farmakope Herbal Indonesia/);
  const missing=guardAnswerBibliography("Excipients (HOPE, 2009).",[],"apa");assert.doesNotMatch(missing.text,/References:/);assert.match(missing.warnings.join(" "),/entri tidak dikarang/);
});
test("journal age constraints leave older books eligible but retain explicit book age rules",()=>{
  const question="Jelaskan eksipien dengan jurnal 10 tahun terakhir dan buku resmi";
  const source={title:"Excipients",year:2009};
  assert.equal(withinResearchScope({...source,workType:"book"},question,2026),true);
  assert.equal(withinResearchScope({...source,workType:"chapter"},question,2026),true);
  assert.equal(withinResearchScope({...source,workType:"journal_article"},question,2026),false);
  assert.equal(withinResearchScope({...source,workType:"book"},"buku terbitan 10 tahun terakhir",2026),false);
});
test("blocked identities and numeric styles do not acquire invented or renumbered references",()=>{
  const fi=book();
  const blocked=guardAnswerBibliography("Fact (FI, 2020).",[fi],"apa",false,[fi]);assert.doesNotMatch(blocked.text,/Official Publisher/);
  const numeric=guardAnswerBibliography("Fact (FI, 2020). Paper [1].\nReferences:\n[1] Actual recent research article.",[fi,paper],"ieee");assert.doesNotMatch(numeric.text,/Farmakope Indonesia/);assert.match(numeric.text,/\[1\] \[Researcher/);
});
test("APA 6 is an explicit local CSL choice, different from APA 7 for eight authors",()=>{
  const metadata:any={title:"Actual author formatting fixture",authors:Array.from({length:8},(_,i)=>`Surname${i}, Person`),year:2020,type:"journal_article",container_title:"Actual Journal",audit:{engineVersion:"public-library-v1",status:"manual",basis:"manual"}};
  const six=formatVerifiedReference(metadata,"apa6")!,seven=formatVerifiedReference(metadata,"apa")!;
  assert.ok(six);assert.ok(seven);assert.notEqual(six,seven);assert.doesNotMatch(six,/Surname6/);assert.match(six,/Surname7/);assert.match(seven,/Surname6/);
  assert.equal(normalizeCitationOptions({citationStyle:"apa6"}).citationStyle,"apa6");assert.equal(normalizeCitationOptions({citationStyle:"apa"}).citationStyle,"apa");
  assert.match(citationInstruction("apa6",["in-text","bibliography"]),/APA 6th edition/);assert.match(citationInstruction("apa",["in-text"]),/APA 7th edition/);
  assert.ok(citationPreviews(metadata).apa6);
  const xml=JSON.parse(readFileSync("lib/cslApa6.json","utf8")).style;assert.match(xml,/<id>http:\/\/www.zotero.org\/styles\/apa-6th-edition<\/id>/);assert.match(xml,/creativecommons.org\/licenses\/by-sa\/3.0/);
  const ui=readFileSync("app/page.tsx","utf8");assert.match(ui,/value: "apa6", label: "APA 6"/);
});
test("APA 6 first full-author citation also reconciles its existing source",()=>{
  const m:any={title:"Three author source identity",authors:["Alpha, A","Beta, B","Gamma, C"],year:2020,type:"book",audit:{engineVersion:"public-library-v1",status:"manual",basis:"manual"}};
  const item=answerCitationInventory([],[{bibliographic_metadata:m}],"apa6")[0];
  const result=guardAnswerBibliography("Fact (Alpha, Beta, & Gamma, 2020).",[item],"apa6");assert.match(result.text,/Three author source identity/);
});

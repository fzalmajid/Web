import test from "node:test";
import assert from "node:assert/strict";
import {researchQuery,scientificQueryPlan,rankResearchHits,relevantResearchContext,withinResearchScope} from "../lib/researchQuery";
import {readFileSync} from "node:fs";

const question='buatkan dasar teori untuk "laporan praktikum pemurnian senyawa bahan alam: penyiapan sampel simplisia cabai keriting" dengan referensi lengkap, 5 jurnal terbaik.';
test("report instructions and course title do not replace the experiment topic",()=>{
  assert.equal(researchQuery(question),"penyiapan sampel simplisia cabai keriting");
  assert.equal(researchQuery(question.replaceAll('"','')),"penyiapan sampel simplisia cabai keriting");
  const plan=scientificQueryPlan(question);
  assert.match(plan.query,/Capsicum annuum/);
  assert.doesNotMatch(plan.query,/buatkan|laporan|terbaik|referensi|5/);
  assert.equal(plan.broadQuery,"Capsicum annuum drying");
});
test("education keyword collisions are rejected; relevant English drying papers survive",()=>{
  const hits=[
    {title:"Pengembangan Bahan Ajar Tematik Digital untuk Siswa Kelas V Sekolah Dasar"},
    {title:"Drying effects on Capsicum annuum fruit quality and capsaicin content"},
    {title:"Capsicum annuum field pest infestation",abstract:"Cultivation and infestation in red chili fields"},
    {title:"Convective drying of red chili",abstract:"Capsicum annuum drying temperature and quality"},
  ];
  const ranked=rankResearchHits(hits,scientificQueryPlan(question).query);
  assert.ok(ranked.includes(hits[1]));
  assert.ok(ranked.includes(hits[3]));
  assert.ok(!ranked.includes(hits[0]));
  assert.ok(!ranked.includes(hits[2]));
});
test("automatic theory context must support preparation, not generic weighing or education",()=>{
  assert.equal(relevantResearchContext("Pengembangan bahan ajar dasar teori untuk siswa sekolah dasar",question),false);
  assert.equal(relevantResearchContext("Gravimetric dosing: weigh samples accurately. Static electricity causes errors.",question),false);
  assert.equal(relevantResearchContext("Simplisia dikeringkan melalui pengeringan bahan tanaman untuk menjaga mutu.",question),true);
  assert.equal(relevantResearchContext("Drying Capsicum annuum changes moisture and capsaicin content.",question),true);
});
test("multi-concept topics cannot pass on a single common title word",()=>{
  assert.deepEqual(rankResearchHits([{title:"Memory of a computer network"},{title:"Retrieval practice improves memory"}],"retrieval practice memory").map(x=>x.title),["Retrieval practice improves memory"]);
  assert.equal(researchQuery("Buatkan dasar teori tentang efisiensi energi surya dengan referensi lengkap, 5 jurnal terbaik"),"efisiensi energi surya");
});
test("a journal quota cannot be filled with known preprints or theses; mixed books stay eligible",()=>{
  assert.equal(withinResearchScope({title:"Capsicum annuum drying",workType:"other"},question),false);
  assert.equal(withinResearchScope({title:"Capsicum annuum drying",workType:"thesis"},question),false);
  assert.equal(withinResearchScope({title:"Capsicum annuum drying",workType:"journal_article"},question),true);
  assert.equal(withinResearchScope({title:"Pharmacognosy",workType:"book",year:2000},"5 jurnal 10 tahun terakhir dan 3 buku"),true);
});
test("automatic context gate preserves explicit source lookup and filters citation data upstream",()=>{
  const route=readFileSync("app/api/ask/route.ts","utf8");
  assert.match(route,/researchWritingIntent && !hasExplicitDatabaseSources/);
  assert.ok(route.indexOf("data = data.filter((row:any)=>relevantResearchContext")<route.indexOf("answerCitationInventory(scholarlyHits,data"));
  assert.match(route,/Jangan sebut atau sitasikan jurnal tidak relevan/);
});

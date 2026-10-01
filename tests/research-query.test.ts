import { strict as assert } from "node:assert";
import { test } from "node:test";
import { researchQuery, indexedAbstract, rankResearchHits } from "../lib/researchQuery";
import { scholarlyPromptContext } from "../lib/scholarlySources";
test("search uses topic, not presentation and citation instructions", () => {
  assert.equal(researchQuery("Cari sumber primer tentang retrieval practice / testing effect untuk belajar. Buat tabel dan daftar pustaka APA. Jangan buat sumber palsu."), "retrieval practice testing effect");
  assert.equal(researchQuery("Carikan paper parasetamol disolusi"), "parasetamol disolusi");
  assert.equal(researchQuery("retrieval practice"), "retrieval practice");
  assert.equal(researchQuery("Baca https://example.org/paper lalu buat tabel"), "Baca https://example.org/paper lalu buat tabel");
  assert.equal(researchQuery("Verifikasi DOI 10.1126/science.1199327"), "Verifikasi DOI 10.1126/science.1199327");
});
test("scholarly results favor topic evidence over generic high-citation matches",()=>{
  const hits=[{title:"ImageNet classification",abstract:"Testing an image retrieval network"},{title:"The critical role of retrieval practice",abstract:"testing effect"}];
  assert.deepEqual(rankResearchHits(hits,"retrieval practice testing effect"),[hits[1]]);
});
test("OpenAlex abstract is reconstructed with bounded valid positions and surfaced as abstract evidence", () => {
  assert.equal(indexedAbstract({effect:[1],Testing:[0],invalid:[-1,9999999]}), "Testing effect");
  assert.equal(indexedAbstract(null), null);
  const context=scholarlyPromptContext([{provider:"openalex",id:"W1",title:"Testing effect",authors:[],year:2006,doi:null,pmid:null,pmcid:null,journal:null,uri:"https://example.org/paper",openAccess:false,abstract:"Recall improves delayed retention."}]);
  assert.match(context, /abstract=Recall improves delayed retention/);
});

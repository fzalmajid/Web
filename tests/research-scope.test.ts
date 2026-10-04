import test from "node:test";
import assert from "node:assert/strict";
import {researchScope,researchScopeInstruction} from "../lib/researchScope";
import {scientificQueryPlan,rankResearchHits} from "../lib/researchQuery";
test("explicit genus scope takes precedence over common names, without injecting a species",()=>{
  for(const genus of ["Capsicum sp.","Capsicum spp.","capsiccum sp"]){
    const q="penyiapan sampel simplisia cabai keriting "+genus;
    assert.equal(researchScope(q)?.species,null);
    const plan=scientificQueryPlan(q);
    assert.doesNotMatch(plan.query+plan.broadQuery,/annuum/);
    assert.match(plan.broadQuery,/Capsicum drying/);
  }
  assert.match(researchScopeInstruction("cabai keriting capsiccum sp"),/Koreksi ejaan pencarian sementara/);
});
test("changing species or genus changes the plan rather than reusing the last case",()=>{
  for(const name of ["Capsicum frutescens","Ocimum basilicum","Solanum lycopersicum","Curcuma longa","Zingiber officinale"]){
    const plan=scientificQueryPlan("penyiapan sampel simplisia "+name);
    assert.ok(plan.query.includes(name));
    assert.ok(plan.broadQuery.includes(name));
    assert.doesNotMatch(plan.query,/annuum/);
    assert.equal(researchScope("Buatkan dasar teori tentang tanaman "+name)?.label,name);
  }
});
test("genus search admits different species but species search rejects a different species",()=>{
  const hits=[{title:"Drying Capsicum annuum"},{title:"Drying Capsicum frutescens"},{title:"Drying Solanum lycopersicum"}];
  assert.deepEqual(rankResearchHits(hits,"Capsicum sp drying"),hits.slice(0,2));
  assert.deepEqual(rankResearchHits(hits,"Capsicum frutescens drying"),[hits[1]]);
});
test("nonbiological topics retain their concepts and do not become taxonomy",()=>{
  assert.equal(researchScope("solar energy efficiency"),null);
  assert.equal(researchScope("Photovoltaic efficiency"),null);
  assert.equal(researchScope("Image retrieval network"),null);
  assert.equal(researchScope("Buatkan dasar teori energi surya"),null);
  assert.doesNotMatch(scientificQueryPlan("jelaskan machine learning").query,/Capsicum/);
  assert.match(researchScopeInstruction("Capsicum sp"),/Spesies belum ditentukan/);
});

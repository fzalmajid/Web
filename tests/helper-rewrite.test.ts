import {test} from "node:test";
import assert from "node:assert/strict";
import {guardHelperRewrite} from "../lib/localAiHelper";
test("small local helper cannot turn source search into an explanation or invent identifiers",()=>{
  const q="Carikan referensi kurva kalibrasi spektrofotometri";
  assert.equal(guardHelperRewrite(q,"Could you explain the calibration curve of a spectrophotometer?"),q);
  assert.equal(guardHelperRewrite(q,q+" https://invented.example/paper"),q);
  assert.equal(guardHelperRewrite(q,"Cari referensi kurva kalibrasi spektrofotometri UV-Vis"),"Cari referensi kurva kalibrasi spektrofotometri UV-Vis");
});

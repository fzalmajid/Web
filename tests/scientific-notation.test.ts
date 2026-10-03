import { test } from "node:test";
import assert from "node:assert/strict";
import { scientificRichPattern, scientificScriptPattern } from "../lib/scientificNotation";

test("adjacent braced chemical subscripts are not swallowed as italic prose",()=>{
  assert.deepEqual("C_{8}H_{9}NO_{2} and CH_{3}".match(scientificRichPattern()),["_{8}","_{9}","_{2}","_{3}"]);
  assert.deepEqual("t_{1/2} and λ_{maks}".match(scientificRichPattern()),["_{1/2}","_{maks}"]);
});

test("numeric emphasis and uncertainty ranges never become partial subscripts",()=>{
  const text="waktu _54 ± 0.81_ detik; kekerasan _4 ± 0.81_ kg/cm²; _60 ± 0.81_ detik dan _3 ± 0.4_ kg/cm²";
  assert.deepEqual(text.match(scientificRichPattern()),["_54 ± 0.81_","_4 ± 0.81_","_60 ± 0.81_","_3 ± 0.4_"]);
  assert.deepEqual("_54_ _2024_ _3.14_ _-0.4_".match(scientificRichPattern()),["_54_","_2024_","_3.14_","_-0.4_"]);
  assert.equal(text.match(scientificScriptPattern()),null);
  assert.equal("C_54_".match(scientificScriptPattern()),null);
});

test("scripts remain intact inside emphasized scientific text",()=>{
  assert.deepEqual("C_12H_22O_11 t_1/2 λ_maks r^{2}".match(scientificScriptPattern()),["_12","_22","_11","_1/2","_maks","^{2}"]);
  const token="_C_{8}H_{9}NO_{2}_".match(scientificRichPattern())?.[0];
  assert.equal(token,"_C_{8}H_{9}NO_{2}_");
  assert.deepEqual(token!.slice(1,-1).match(scientificScriptPattern()),["_{8}","_{9}","_{2}"]);
});
test("scientific token precedence preserves complete emphasis and ordinary scripts",()=>{
  assert.deepEqual("_italic_ __double__ *bold* C_2H_6 r^{2} π^* λ_maks".match(scientificRichPattern()),["_italic_","__double__","*bold*","_2","_6","^{2}","^*","_maks"]);
  assert.deepEqual("_scientific prose_ and _symbol_".match(scientificRichPattern()),["_scientific prose_","_symbol_"]);
});

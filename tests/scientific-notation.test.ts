import { test } from "node:test";
import assert from "node:assert/strict";
import { scientificRichPattern } from "../lib/scientificNotation";

test("adjacent braced chemical subscripts are not swallowed as italic prose",()=>{
  assert.deepEqual("C_{8}H_{9}NO_{2} and CH_{3}".match(scientificRichPattern()),["_{8}","_{9}","_{2}","_{3}"]);
  assert.deepEqual("t_{1/2} and λ_{maks}".match(scientificRichPattern()),["_{1/2}","_{maks}"]);
});
test("scientific token precedence preserves complete emphasis and ordinary scripts",()=>{
  assert.deepEqual("_italic_ __double__ *bold* C_2H_6 r^{2} π^* λ_maks".match(scientificRichPattern()),["_italic_","__double__","*bold*","_2","_6","^{2}","^*","_maks"]);
  assert.deepEqual("_scientific prose_ and _symbol_".match(scientificRichPattern()),["_scientific prose_","_symbol_"]);
});

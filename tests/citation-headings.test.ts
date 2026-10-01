import { strict as assert } from "node:assert";
import { test } from "node:test";
import { citationStructuralWarnings } from "../lib/citations";
test("bibliography detection accepts the app's bold headings and colon placement",()=>{
  for(const heading of ["Daftar Pustaka:","*Daftar Pustaka:*","*Daftar Pustaka*:","**References**","## References","_References:_"]){
    assert.deepEqual(citationStructuralWarnings("Isi\n\n"+heading+"\nNama (2020). Judul.","apa",["bibliography"]),[]);
  }
  assert.notDeepEqual(citationStructuralWarnings("Daftar isi\n- Daftar Pustaka\nIsi belum bersumber.","apa",["bibliography"]),[]);
});
test("formatted numeric heading keeps the first entry and mismatch checks",()=>{
  assert.deepEqual(citationStructuralWarnings("Fakta [1].\n*References:*\n[1] Nama. Judul.","ieee",["in-text","bibliography"]),[]);
  assert.match(citationStructuralWarnings("Fakta [2].\n*References:*\n[1] Nama. Judul.","ieee",["in-text","bibliography"]).join(" "),/tanpa entri/);
});

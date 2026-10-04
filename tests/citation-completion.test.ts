import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { completeAnswerCitations, citationCompletionInstruction } from "../lib/citationCompletion";
import { citationPairingIssues } from "../lib/answerEvidence";

const book={title:"Actual official herbal reference book",formatted:"Ministry. (2017). Actual official herbal reference book.",authorYearKeys:["Ministry 2017"],workType:"book",printedPages:["7"]};
const journal={title:"Public study about sample preparation",doi:"10.1000/preparation",formatted:"Alpha, A., & Beta, B. (2022). Public study about sample preparation.",authorYearKeys:["Alpha & Beta 2022"]};
test("pasted author-year citations cannot survive without matching bibliography identities",async()=>{
  for(const style of ["apa","apa6","harvard","chicago"] as const){
    const result=await completeAnswerCitations({answer:"Definition (Ministry, 2017). Other claim (Missing et al., 2012). Preparation (Alpha & Beta, 2022).\nReferences:\nActual official herbal reference book.",inventory:[book,journal],style});
    assert.equal(result.blocked,true);assert.doesNotMatch(result.text,/Other claim|Missing et al/);
    assert.ok(result.warnings.some(x=>x.includes("Missing")));
  }
});
test("omitted known book and journal entries are restored; unused works stay out",async()=>{
  const unused={...journal,title:"Unused research article",doi:"10.1000/unused",authorYearKeys:["Unused 2024"]};
  const result=await completeAnswerCitations({answer:"Definition (Ministry, 2017, hlm. 7). Result (Alpha & Beta, 2022).",inventory:[book,journal,unused],style:"apa6"});
  assert.equal(result.blocked,false);assert.match(result.text,/References/);assert.match(result.text,/10\.1000\/preparation/);assert.doesNotMatch(result.text,/Unused research/);
  assert.deepEqual(citationPairingIssues(result.text,[book,journal,unused],"apa6"),[]);
});
test("one repair may resolve or qualify unsupported claims, but cannot just invent a bibliography",async()=>{
  let calls=0;
  const options={answer:"Unsupported claim (Missing, 2024).",inventory:[book],style:"apa6" as const};
  const repaired=await completeAnswerCitations({...options,repair:async()=>{
    calls++;return "Definition (Ministry, 2017, hlm. 7). Data untuk klaim tambahan belum tersedia.";
  }});
  assert.equal(calls,1);assert.equal(repaired.repairAttempted,true);assert.equal(repaired.blocked,false);
  calls=0;
  const invalid=await completeAnswerCitations({...options,repair:async()=>{
    calls++;return "Unsupported claim (Missing, 2024).\nReferences:\nMissing (2024). Fabricated publication.";
  }});
  assert.equal(calls,1);assert.equal(invalid.blocked,true);assert.doesNotMatch(invalid.text,/Unsupported claim/);
  const failed=await completeAnswerCitations({...options,repair:async()=>{throw new Error("provider unavailable");}});
  assert.equal(failed.blocked,true);
});
test("narrative and ambiguous same-author same-year citations cannot evade completeness",async()=>{
  for(const answer of ["Missing et al. (2024) reports this.", "Ministry (2017) reports this."]){
    const result=await completeAnswerCitations({answer,inventory:answer.startsWith("Ministry")?[book,{...book,title:"Different official book"}]:[book],style:"apa6"});
    assert.equal(result.blocked,true);
  }
});
test("numeric citations require their own matched entry without silent renumbering",async()=>{
  for(const style of ["ieee","vancouver"] as const){
    const invalid=await completeAnswerCitations({answer:"Claim [2].\nReferences:\n[1] Public study about sample preparation.",inventory:[journal],style});
    assert.equal(invalid.blocked,true);
    const valid=await completeAnswerCitations({answer:"Claim [2].\nReferences:\n[2] Public study about sample preparation.",inventory:[journal],style});
    assert.equal(valid.blocked,false);assert.match(valid.text,/\[2\]/);
  }
});
test("code, links, ordinary dates and disabled citation style do not trigger orphan repair",async()=>{
  const answer="Code `(Missing, 2024)`. [Example (Missing, 2024)](https://example.org). Pada tahun (2024), pekerjaan dimulai.";
  assert.deepEqual(citationPairingIssues(answer,[],"apa6"),[]);
  assert.equal((await completeAnswerCitations({answer:"Claim (Missing, 2024).",inventory:[],style:"none"})).blocked,false);
});
test("primary and alternate provider routes await the same final gate and record repair token usage",()=>{
  const route=readFileSync("app/api/ask/route.ts","utf8");
  assert.equal((route.match(/\.\.\.await finalizeAnswer\(/g)||[]).length,3);
  assert.match(route,/await completeAnswerCitations/);
  assert.match(route,/recordAiTokenUsage\(supabase,repair\.usage/);
  assert.match(citationCompletionInstruction,/Nama lembaga dan tahun yang sama tidak membuktikan/);
});
test("short genuine book titles still pair via the canonical full formatted entry",async()=>{
  const short={title:"Book",formatted:"Author. (2020). Book. Publisher.",authorYearKeys:["Author 2020"],workType:"book",printedPages:["1"]};
  const result=await completeAnswerCitations({answer:"Claim (Author, 2020, hlm. 1).",inventory:[short],style:"apa6"});
  assert.equal(result.blocked,false);assert.match(result.text,/Author\. \(2020\)\. Book/);
});
test("MLA missing works are blocked, while matched author-page references pair",async()=>{
  const item={title:"Actual MLA publication",formatted:"Author. Actual MLA publication.",authorYearKeys:["Author 2020"]};
  const valid=await completeAnswerCitations({answer:"Claim (Author 12).",inventory:[item],style:"mla"});
  assert.equal(valid.blocked,false);
  assert.equal((await completeAnswerCitations({answer:"Claim (Missing 12).",inventory:[item],style:"mla"})).blocked,true);
});
test("verified narrative names retain lowercase surname particles",async()=>{
  const item={title:"Actual study with surname particles",formatted:"de Vries, A. (2020). Actual study with surname particles.",authorYearKeys:["de Vries 2020"]};
  const result=await completeAnswerCitations({answer:"Menurut de Vries (2020), hasil ini diamati.",inventory:[item],style:"apa6"});
  assert.equal(result.blocked,false);
});
test("nonpublication titles and nonnumeric page markers cannot masquerade as formal citations",async()=>{
  const result=await completeAnswerCitations({answer:"Proses ini wajib dilakukan (Minggu ke-2, hlm. Minggu ke-2).",inventory:[],style:"apa6",requireFormalReferences:true,repair:async()=>"Catatan menyebut proses ini wajib. Tidak ada referensi formal."});
  assert.equal(result.blocked,true);assert.match(result.text,/Bahan catatan/);assert.doesNotMatch(result.text,/proses ini wajib/i);
  assert.ok(citationPairingIssues("Claim (Worksheet, hlm. six).",[],"apa6").length>0);
});
test("an explicit bibliography requirement cannot be satisfied by deleting all citation markers",async()=>{
  const result=await completeAnswerCitations({answer:"Claim (Missing, 2020).",inventory:[book],style:"apa6",requireFormalReferences:true,repair:async()=>"This is a claim with no citation."});
  assert.equal(result.blocked,true);
  const valid=await completeAnswerCitations({answer:"Claim (Ministry, 2017, hlm. 7).",inventory:[book],style:"apa6",requireFormalReferences:true});
  assert.equal(valid.blocked,false);assert.match(valid.text,/References/);
});

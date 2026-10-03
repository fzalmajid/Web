import test from "node:test";
import assert from "node:assert/strict";
import { guardAnswerBibliography, omittedAuthorYearReferences } from "../lib/answerEvidence";
import { recoverDocumentBibliography } from "../lib/documentEvidence";
const a={title:"Actual first research publication",formatted:"Alpha (2024). Actual first research publication.",authorYearKeys:["Alpha 2024"]};
const b={title:"Actual second research publication",formatted:"Beta (2023). Actual second research publication.",authorYearKeys:["Beta 2023"]};
test("reference list is exactly the cited set, restoring missing and deleting unused entries",()=>{
  const result=guardAnswerBibliography("Fact (Alpha, 2024).\nReferences:\nActual second research publication.",[a,b],"apa");
  assert.match(result.text,/Actual first/);assert.doesNotMatch(result.text,/Actual second/);
  assert.match(result.warnings.join(" "),/tanpa sitasi/);
});
test("discovery-only recovery never turns retrieved publications into references",()=>{
  assert.equal(recoverDocumentBibliography("Body.",[a,b]).text,"Body.");
});
test("bare mentions, DOI links, code and bibliography self-citations are not body citations",()=>{
  for(const body of ["Alpha 2024 is a search term.","`(Alpha, 2024)`","```text\n(Alpha, 2024)\n```","[(Alpha, 2024)](https://example.org)"]){
    assert.deepEqual(omittedAuthorYearReferences(body,[a],[]),[]);
  }
  assert.doesNotMatch(guardAnswerBibliography("Body.\nReferences:\nAlpha (2024). Actual first research publication.",[a],"apa").text,/Actual first/);
});
test("parenthetical groups and narrative citations restore only uniquely matched real identities",()=>{
  assert.equal(omittedAuthorYearReferences("Fact (Alpha, 2024, p. 12; Beta, 2023).",[a,b],[]).length,2);
  assert.equal(omittedAuthorYearReferences("Alpha (2024) argues this.",[a,b],[]).length,1);
  assert.deepEqual(omittedAuthorYearReferences("Alpha 2024 unrelated (2023).",[a,b],[]),[]);
});
test("missing or ambiguous source never causes a fabricated bibliography entry",()=>{
  const result=guardAnswerBibliography("Fact (Unknown, 2024).",[a],"apa");
  assert.doesNotMatch(result.text,/References/);assert.ok(result.warnings.length);
  assert.deepEqual(omittedAuthorYearReferences("Fact (Alpha, 2024).",[a,{...a,title:"Other edition"}],[]),[]);
});
test("numeric references remove uncited entries without renumbering markers",()=>{
  const result=guardAnswerBibliography("Claim [3].\nReferences:\n[3] Actual first research publication.\n[9] Actual second research publication.",[a,b],"ieee");
  assert.match(result.text,/Claim \[3\]/);assert.match(result.text,/\[3\] Alpha/);assert.doesNotMatch(result.text,/Actual second|\[9\]/);
  assert.ok(guardAnswerBibliography("Claim [7].",[a],"ieee").warnings.length);
});
test("MLA author-page citations select only the matched source",()=>{
  const result=guardAnswerBibliography("Claim (Alpha 12).\nWorks Cited:\nActual second research publication.",[a,b],"mla");
  assert.match(result.text,/Actual first/);assert.doesNotMatch(result.text,/Actual second/);
});

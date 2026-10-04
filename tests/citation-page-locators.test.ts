import test from "node:test";
import assert from "node:assert/strict";
import {formatInTextPageLocators,guardAnswerBibliography} from "../lib/answerEvidence";
import {cleanLegacyReferenceLinks} from "../lib/answerProse";
test("existing print-page locators follow author-date styles without adding retrieved pages",()=>{
  for(const style of ["apa","apa6","harvard"] as const){
    assert.equal(formatInTextPageLocators("Fact (Author, 2020, p. 145).",style),"Fact (Author, 2020, hlm. 145).");
    assert.equal(formatInTextPageLocators("Fact (Author, 2020, pp. 145–146).",style),"Fact (Author, 2020, hlm. 145–146).");
  }
  assert.equal(formatInTextPageLocators("Fact (Author, 2020, hlm. 145).","chicago"),"Fact (Author, 2020, 145).");
  assert.equal(formatInTextPageLocators("Fact (Author, 2020).","apa6"),"Fact (Author, 2020).");
  const literal="`(Author, 2020, hlm. 145)`\n```\n(Author, 2020, hlm. 145)\n```";
  assert.equal(formatInTextPageLocators(literal,"apa6"),literal);
});
test("journal DOI remains visible at the end even when the entry points to the actual PDF",()=>{
  const source={title:"Actual journal study",workType:"journal_article",doi:"10.1234/study",formatted:"Author. (2020). Actual journal study. Journal, 3(1), 66–77.",authorYearKeys:["Author 2020"],readSource:{uri:"https://example.org/read.pdf",format:"full-text-pdf",pages:[1]}};
  const result=guardAnswerBibliography("Fact (Author, 2020).",[source],"apa6");
  assert.match(result.text,/66–77\. https:\/\/doi.org\/10.1234\/study\]\(https:\/\/example.org\/read.pdf\)/);
  assert.equal(guardAnswerBibliography(result.text,[source],"apa6").text,result.text);
  const legacy="*References:*\n"+source.formatted+" https://doi.org/10.1234/study · [Teks lengkap publik — PDF dibaca; halaman PDF 1](https://example.org/read.pdf)";
  assert.match(cleanLegacyReferenceLinks(legacy),/https:\/\/doi.org\/10.1234\/study\]\(https:\/\/example.org\/read.pdf\)/);
});
test("whole-book bibliography is CSL-only while verified print pages remain in the inventory",()=>{
  const source={title:"Actual published official book",workType:"book",formatted:"Author. (2020). Actual published official book. Publisher.",authorYearKeys:["Author 2020"],printedPages:["145–146","2220–2222"]};
  const result=guardAnswerBibliography("Fact (Author, 2020, hlm. 145–146).",[source],"apa6");
  assert.match(result.text,/hlm\. 145–146/);assert.doesNotMatch(result.text,/Halaman cetak sumber terambil|2220/);
  assert.deepEqual(source.printedPages,["145–146","2220–2222"]);
  assert.equal(cleanLegacyReferenceLinks("*References:*\n"+source.formatted+" · Halaman cetak sumber terambil: 145–146, 2220–2222."),"*References:*\n"+source.formatted);
});

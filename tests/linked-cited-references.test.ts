import test from "node:test";
import assert from "node:assert/strict";
import {answerCitationInventory} from "../lib/answerCitationServer";
import {guardAnswerBibliography} from "../lib/answerEvidence";
import {metadataFromKnowledgeSource} from "../lib/citationFormatterServer";
import {cleanLegacyReferenceLinks} from "../lib/answerProse";

test("a journal retrieved privately and publicly is one cited work, not an ambiguity",()=>{
  const metadata:any={title:"Actual uploaded journal publication",type:"journal_article",authors:["Arsi"],year:2021,doi:"10.1234/actual"};
  const hit:any={...metadata,provider:"europepmc",uri:"https://doi.org/10.1234/actual"};
  const inventory=answerCitationInventory([hit],[{source_file_id:"private",bibliographic_metadata:metadata}],"apa6",[{source:hit,uri:"https://example.org/read.pdf",kind:"full-text-pdf",pages:[1,2]}] as any);
  assert.equal(inventory.length,1);
  const answer=guardAnswerBibliography("Claim (Arsi, 2021).",inventory,"apa6");
  assert.match(answer.text,/References/);assert.match(answer.text,/\]\(https:\/\/example.org\/read.pdf\)/);
  assert.doesNotMatch(answer.warnings.join(" "),/belum dapat dipasangkan/);
});
test("numeric and Roman book editions reconcile without guessing a different edition",()=>{
  const inventory=answerCitationInventory([],[{bibliographic_metadata:{title:"Farmakope Indonesia",type:"book",year:2020,edition:"6"}}],"apa6");
  assert.match(guardAnswerBibliography("Fact (FI Edisi VI, 2020).",inventory,"apa6").text,/References/);
  assert.doesNotMatch(guardAnswerBibliography("Fact (FI Edisi V, 2020).",inventory,"apa6").text,/References/);
});
test("flattened publication metadata feeds the same inventory as the formatter",()=>{
  const inventory=answerCitationInventory([],[{bibliographic_type:"journal_article",bibliographic_work_title:"Actually retrieved journal title",bibliographic_authors:["Arsi"],bibliographic_year:"2021"}],"apa6");
  assert.equal(inventory.length,1);assert.match(guardAnswerBibliography("Claim (Arsi, 2021).",inventory,"apa6").text,/References/);
});
test("whole-entry links escape labels and destinations, with numeric labels outside the link",()=>{
  const item={title:"An actual reference [with brackets]",formatted:"Author (2024). An actual reference [with brackets].",doi:"10.1234/link",readSource:{uri:"https://example.org/paper(1).pdf",format:"full-text-pdf",pages:[1]}};
  const result=guardAnswerBibliography("Fact [7].\nReferences:\n[7] An actual reference [with brackets].",[item],"ieee");
  assert.match(result.text,/\[7\] \[Author/);assert.match(result.text,/\\\[with brackets\\\]/);assert.match(result.text,/paper%281%29.pdf/);
  assert.doesNotMatch(result.text,/PDF dibaca|Teks lengkap publik/);
});
test("same DOI with conflicting publication years remains unresolved rather than silently merged",()=>{
  const hits:any[]=[2020,2021].map(year=>({title:"Actual journal record",provider:"europepmc",authors:["Arsi"],year,doi:"10.1234/conflict",uri:"https://doi.org/10.1234/conflict"}));
  assert.equal(answerCitationInventory(hits,[],"apa6").length,2);
});
test("actual legacy FI cover metadata yields a clean book and institution citation without a Database write",()=>{
  const metadata:any={title:"FARMAKOPE INDONESIA EDISI VI 20 20 KEMENTERIAN KESEHATAN REPUBLIK INDONESIA 615.1",isbn:"9786233010177",year:2020,type:"book"};
  const row={bibliographic_metadata:metadata};
  const inventory=answerCitationInventory([], [row], "apa6");
  for(const marker of ["Kemenkes RI, 2020","Farmakope Indonesia Edisi VI, 2020",`${metadata.title}, 2020`]){
    const result=guardAnswerBibliography(`Fact (${marker}).`,inventory,"apa6");
    assert.match(result.text,/References/);assert.match(result.text,/Kementerian Kesehatan Republik Indonesia\. \(2020\)/);
    assert.doesNotMatch(result.text.split("*References:*")[1],/615\.1|20 20/);
  }
  assert.match(metadata.title,/615\.1/);
  assert.equal(metadataFromKnowledgeSource({bibliographic_metadata:{...metadata,audit:{basis:"manual"}}}).title,metadata.title);
});
test("unsafe read target falls back to the real DOI, without executing or nesting Markdown links",()=>{
  const item={title:"Actual linked study",formatted:"[Actual linked study](https://example.org/paper)",doi:"10.1234/safe",authorYearKeys:["Author 2024"],readSource:{uri:"javascript:alert(1)",format:"full-text-pdf",pages:[1]}};
  const result=guardAnswerBibliography("Claim (Author, 2024).",[item],"apa6");
  assert.match(result.text,/\[Actual linked study https:\/\/doi.org\/10.1234\/safe\]\(https:\/\/doi.org\/10.1234\/safe\)/);
  assert.doesNotMatch(result.text,/javascript:|\[\[/);
});
test("saved bibliography status links become whole-entry links without changing the original answer or code",()=>{
  const entry="Arsi, A., & Kemal, A. (2021). Actual public article. J-Plantasimbiosa, 3(1), 66–77.";
  const line=`${entry} · [Teks lengkap publik — PDF dibaca; halaman PDF 1, 2, 3](https://example.org/paper.pdf)`;
  const original=`Body.\n\n*References:*\n${line}`;
  assert.equal(cleanLegacyReferenceLinks(original),`Body.\n\n*References:*\n[${entry}](https://example.org/paper.pdf)`);
  assert.equal(cleanLegacyReferenceLinks(line),line);
  assert.equal(cleanLegacyReferenceLinks(`*References:*\n\x60\x60\x60\n${line}\n\x60\x60\x60`),`*References:*\n\x60\x60\x60\n${line}\n\x60\x60\x60`);
});

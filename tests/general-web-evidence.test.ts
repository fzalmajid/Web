import {test} from "node:test";
import assert from "node:assert/strict";
import {parseHtmlArticle,parseJatsArticle,readableMarkup} from "../lib/articleText";
import {scientificQueryPlan,topicSearchTerms} from "../lib/researchQuery";
import {guardAnswerBibliography,identityInEntry} from "../lib/answerEvidence";
import {mapScopusResults,scopusQuery,scholarlyIndexStatus} from "../lib/scholarlyIndexes";
import {fullTextPromptContext,paperDoiMatches} from "../lib/scholarlyFullText";

const paragraph="Participants practiced retrieval at delayed intervals; the control group reread the material. Outcomes and limitations were recorded separately. ".repeat(9);
test("general topic search strips answer instructions, with conservative bilingual topics",()=>{
  assert.equal(topicSearchTerms("Jelaskan efektivitas energi surya berdasarkan bukti ilmiah"),"effectiveness solar energy");
  assert.equal(scientificQueryPlan("Cari paper tentang retrieval practice dan memory. Sertakan References.").query,"retrieval practice memory");
  assert.equal(topicSearchTerms("unknownNamedTopic"),"unknownNamedTopic");
  assert.equal(topicSearchTerms("10.1234/real-doi"),"10.1234/real-doi");
  assert.equal(scientificQueryPlan("Baca paper DOI 10.1234/real-doi dan ringkas hasilnya").query,"10.1234/real-doi");
});
test("HTML evidence preserves sections, table cells/units, and never executes scripts",()=>{
  const html=`<meta name="citation_title" content="Retrieval practice and delayed memory"><meta name="citation_doi" content="10.1234/memory"><main><article><h1>Retrieval practice and delayed memory</h1><h2>Methods</h2><p>${paragraph}</p><h2>Results</h2><table><tr><th>Group</th><th>Delay (days)</th></tr><tr><td>Retrieval</td><td>7</td></tr></table><script>fetch('https://evil.example')</script><div class="references">Other paper DOI 10.1234/other</div></article></main>`;
  const result=parseHtmlArticle(html);
  assert.equal(result.fullText,true);assert.equal(result.doi,"10.1234/memory");
  assert.match(result.text,/Group \| Delay \(days\)/);assert.match(result.text,/Retrieval \| 7/);
  assert.doesNotMatch(result.text,/evil|Other paper/);
});
test("abstract landing page is not mislabeled as read full text",()=>{
  const result=parseHtmlArticle(`<article><h1>Retrieval practice and delayed memory</h1><h2>Abstract</h2><p>${paragraph}</p><h2>References</h2><p>${paragraph}</p></article>`);
  assert.equal(result.fullText,false);
});
test("JATS uses front-matter identity, not cited paper DOI, and preserves tables",()=>{
  const xml=`<article><front><journal-meta><journal-title>Memory Journal</journal-title></journal-meta><article-meta><article-id pub-id-type="doi">10.1234/memory</article-id><title-group><article-title>Retrieval practice and delayed memory</article-title></title-group><pub-date pub-type="epub"><year>2024</year></pub-date></article-meta></front><body><sec><title>Methods</title><p>${paragraph}</p><table-wrap><label>Table 1</label><table><tr><td>Days</td><td>7</td></tr></table></table-wrap></sec></body><back><ref-list><article-title>Wrong work</article-title><pub-id pub-id-type="doi">10.1234/wrong</pub-id></ref-list></back></article>`;
  const result=parseJatsArticle(xml);
  assert.equal(result.fullText,true);assert.equal(result.doi,"10.1234/memory");assert.match(result.text,/Days \| 7/);assert.doesNotMatch(result.text,/Wrong work/);
  assert.match(result.metadataHtml!,/2024/);
  assert.equal(parseJatsArticle('<!DOCTYPE article [<!ENTITY x SYSTEM "file:///etc/passwd">]>'+xml).fullText,false);
});
test("fetched webpage citation matches a real URL, not prefix-spoofed URLs or DOIs",()=>{
  const item={title:"Official learning documentation",uri:"https://example.org/docs",doi:"10.1234/work"};
  assert.equal(identityInEntry("Source https://example.org/docs-extra",item),false);
  assert.equal(identityInEntry("https://doi.org/10.1234/work-extra",item),false);
  assert.equal(identityInEntry("[Source](https://example.org/docs)",item),true);
});
test("numeric references retain labels while repairing wrong author/year metadata",()=>{
  const result=guardAnswerBibliography("Result [3].\nReferences:\n[3] Wrong Author (2020). Real article title. https://doi.org/10.1234/work",[{title:"Real article title",doi:"10.1234/work",formatted:"[1] Actual Author (2024). Real article title."}],"ieee",true);
  assert.match(result.text,/Result \[3\]/);assert.match(result.text,/\[3\] Actual Author \(2024\)/);assert.doesNotMatch(result.text,/Wrong Author/);
});
test("Scopus is optional metadata with real index provenance, not an OA PDF claim",()=>{
  const hits=mapScopusResults({"search-results":{entry:[{"dc:title":"Memory retrieval practice","dc:creator":"A Researcher","prism:doi":"10.1234/work","prism:coverDate":"2024-01-01",openaccess:"0"}]}});
  assert.deepEqual(hits[0].indexedIn,["scopus"]);assert.equal(hits[0].openAccess,false);assert.equal(hits[0].fullTextUrls,undefined);
  assert.equal(scopusQuery('memory) OR ALL(test)'),"TITLE-ABS-KEY(memory OR ALL test)");
  assert.equal(scholarlyIndexStatus().sinta.automaticAccreditationClaims,false);
});
test("full-text context distinguishes read format and bounded claim support",()=>{
  const text=fullTextPromptContext([{source:{title:"Memory study",doi:"10.1234/work",uri:"https://example.org/article"} as any,uri:"https://example.org/article.xml",kind:"full-text-xml",text:paragraph,pages:[]}]);
  assert.match(text,/full-text-xml/);assert.match(text,/section headings/);assert.doesNotMatch(text,/Public PDF=/);
});
test("a PDF's explicit different DOI cannot be attached to the expected work",()=>{
  assert.equal(paperDoiMatches("10.1234/memory","DOI:10.1234/other"),false);
  assert.equal(paperDoiMatches("10.1234/memory","https://doi.org/10.1234/memory."),true);
});

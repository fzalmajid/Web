import test from "node:test";
import assert from "node:assert/strict";
import {inferReferenceMetadata,citationMetadataReady} from "../lib/referenceMetadata";
import {auditReferenceMetadata} from "../lib/referencePipelineServer";
import {referenceToCsl} from "../lib/citationFormatterServer";
import {answerCitationInventory} from "../lib/answerCitationServer";
import {guardAnswerBibliography} from "../lib/answerEvidence";

const cover="FARMAKOPE INDONESIA EDISI VI 20 20 KEMENTERIAN KESEHATAN REPUBLIK INDONESIA 615.1\nISBN: 9786233010177";
test("live FI cover separates actual title, corporate author, roman edition and OCR year",()=>{
  const metadata=inferReferenceMetadata({fileName:"upload.pdf",frontMatter:cover});metadata.audit=auditReferenceMetadata(metadata,{});
  assert.equal(metadata.title,"Farmakope Indonesia");assert.equal(metadata.corporate_author,"Kementerian Kesehatan Republik Indonesia");assert.equal(metadata.edition,"VI");assert.equal(metadata.year,2020);
  assert.equal(metadata.audit.basis,"document");assert.equal(citationMetadataReady(metadata),true);assert.deepEqual(referenceToCsl(metadata).issued,{"date-parts":[[2020]]});
  const item=answerCitationInventory([],[{bibliographic_metadata:metadata,printed_page_start:"145"}],"apa6")[0];
  const answer=guardAnswerBibliography("Fact (Kemenkes RI, 2020, hlm. 145).",[item],"apa6");
  assert.match(answer.text,/References/);assert.match(answer.text,/Farmakope Indonesia/);assert.match(answer.text,/hlm\. 145/);assert.doesNotMatch(answer.text,/615\.1|Halaman cetak sumber terambil/);
});
test("filename, slide mentions, invalid ISBN and distant institution do not establish cover identity",()=>{
  for(const input of [
    {fileName:"Farmakope Indonesia Ed VI 2020.pdf",frontMatter:""},
    {fileName:"lecture.pptx.pdf",frontMatter:cover},
    {fileName:"upload.pdf",frontMatter:cover.replace("9786233010177","9786233010178")},
    {fileName:"upload.pdf",frontMatter:"Lecture about references\n"+cover},
    {fileName:"upload.pdf",frontMatter:cover.replace("KEMENTERIAN KESEHATAN REPUBLIK INDONESIA","Another institution")},
  ]){
    const parsed=inferReferenceMetadata(input);assert.equal(parsed.corporate_author,undefined);
  }
});
test("roman editions are read from document labels, without filename promotion",()=>{
  const parsed=inferReferenceMetadata({fileName:"book.pdf",frontMatter:"Edition: IV\nISBN: 9786233010177"});assert.equal(parsed.edition,"IV");assert.equal(parsed.provenance?.edition?.source,"document");
});

test("reader wrappers never become citation titles and title-page identity does not require ISBN",()=>{
  const front="[Halaman 1]\n[Teks digital]\nFARMAKOPE\nHERBAL\nINDONESIA EDISI II\n2017 KEMENTERIAN KESEHATAN REPUBLIK INDONESIA 615.1\n\n[Teks dari gambar/OCR]\nFARMAKOPE HERBAL INDONESIA EDISI II 2017 KEMENTERIAN KESEHATAN REPUBLIK INDONESIA";
  const metadata=inferReferenceMetadata({fileName:"user-upload (2).pdf",frontMatter:front});
  metadata.audit=auditReferenceMetadata(metadata,{});
  assert.equal(metadata.title,"Farmakope Herbal Indonesia");
  assert.equal(metadata.type,"book"); assert.equal(metadata.year,2017); assert.equal(metadata.edition,"II");
  assert.equal(metadata.corporate_author,"Kementerian Kesehatan Republik Indonesia");
  assert.equal(metadata.isbn,undefined); assert.equal(citationMetadataReady(metadata),true);
  const item=answerCitationInventory([],[{bibliographic_metadata:metadata,printed_page_start:"6"}],"apa6")[0];
  assert.ok(item.formatted); assert.doesNotMatch(item.formatted!,/Teks digital|OCR/);
  const answer=guardAnswerBibliography("Definisi (Kementerian Kesehatan Republik Indonesia, 2017, hlm. 6).",[item],"apa6");
  assert.match(answer.text,/References/); assert.match(answer.text,/Farmakope Herbal Indonesia/);
  assert.doesNotMatch(answer.text,/Teks digital/);
});

test("wrapper cleanup applies to ordinary titles but never promotes notes to books",()=>{
  const metadata=inferReferenceMetadata({fileName:"notes.pdf",frontMatter:"[Halaman 1]\n[Teks digital]\nCatatan praktikum mahasiswa\n2017"});
  assert.doesNotMatch(metadata.title||"",/Teks digital|Halaman/);
  assert.equal(metadata.type,"other"); assert.equal(metadata.corporate_author,undefined);
});

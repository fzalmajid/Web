import test from "node:test";
import assert from "node:assert/strict";
import { libraryCitationReady } from "../lib/documentPolicy";
import { citationMetadataReady, type ReferenceMetadata } from "../lib/referenceMetadata";
import { answerCitationInventory } from "../lib/answerCitationServer";
import { formatVerifiedReference, referenceToCsl, buildDeterministicCitationInventory, processLibraryCitations } from "../lib/citationFormatterServer";
import { buildCitationMetadataInventory } from "../lib/citations";
import { guardAnswerBibliography } from "../lib/answerEvidence";

const book: ReferenceMetadata = { title: "Farmakope Indonesia", type: "book", year: 2020, edition: "VI", corporate_author: "Kementerian Kesehatan Republik Indonesia" };
test("Database book without machine audit is eligible while public trust remains strict", () => {
  assert.equal(libraryCitationReady(book), true);
  assert.equal(citationMetadataReady(book), false);
  assert.equal(formatVerifiedReference(book, "apa6"), null);
  assert.match(formatVerifiedReference(book, "apa6", true)!, /Farmakope Indonesia/);
  assert.equal(referenceToCsl(book, true).issued?.["date-parts"][0][0], 2020);
});
test("Library title-only journal retains absent fields without fabrication", () => {
  const metadata: ReferenceMetadata = { title: "Actual uploaded publication", type: "journal_article" };
  const csl = referenceToCsl(metadata, true);
  assert.equal(csl.author, undefined); assert.equal(csl.issued, undefined);
  assert.equal(csl.DOI, undefined); assert.equal(csl.page, undefined);
  assert.ok(formatVerifiedReference(metadata, "apa6", true));
});
test("Nonpublication materials remain context even if trusted", () => {
  for (const type of ["lecture_slides", "other", "webpage", undefined]) {
    const metadata = { ...book, type } as ReferenceMetadata;
    assert.equal(libraryCitationReady(metadata), false);
    assert.equal(formatVerifiedReference(metadata, "apa6", true), null);
  }
});
test("Library inventory and recovery include only actually cited books with printed pages", () => {
  const rows = [{ id: "fi", bibliographic_metadata: book, bibliographic_metadata_status: "auto", printed_page_start: "12", printed_page_end: "13" },
    { id: "slides", bibliographic_metadata: { title: "Lecture notes", type: "lecture_slides" } }];
  const inventory = answerCitationInventory([], rows, "apa6");
  assert.equal(inventory.length, 1); assert.deepEqual(inventory[0].printedPages, ["12–13"]);
  assert.ok(inventory[0].authorYearKeys?.includes("Farmakope Indonesia Edisi VI 2020"));
  assert.match(guardAnswerBibliography("Fact (Farmakope Indonesia Edisi VI, 2020, hlm. 12).", inventory, "apa6").text, /References/);
  assert.doesNotMatch(guardAnswerBibliography("No citation.", inventory, "apa6").text, /References/);
  assert.match(buildCitationMetadataInventory("apa6", rows), /SUMBER DATABASE DIVALIDASI PENGGUNA/);
  assert.doesNotMatch(buildCitationMetadataInventory("apa6", rows), /BELUM TERVERIFIKASI: jangan/);
  assert.match(buildDeterministicCitationInventory("apa6", rows), /Farmakope Indonesia/);
  assert.doesNotMatch(buildDeterministicCitationInventory("apa6", rows), /Lecture notes/);
  const processed = processLibraryCitations(rows.map(row => ({ id: row.id, metadata: row.bibliographic_metadata as ReferenceMetadata })), "apa6");
  assert.deepEqual(processed.excluded, ["slides"]);
});

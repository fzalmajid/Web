import { test } from "node:test";
import assert from "node:assert/strict";
import { inferReferenceMetadata, normalizeIsbn, normalizeDoi, referenceIdentity, citationMetadataReady } from "../lib/referenceMetadata";
import { auditReferenceMetadata, mapCrossrefItem, resolveReferenceMetadata, REFERENCE_CAPABILITIES } from "../lib/referencePipelineServer";
import { citationPreviews, formatVerifiedReference, processLibraryCitations, referenceToCsl, buildDeterministicCitationInventory } from "../lib/citationFormatterServer";
import { GET as connect } from "../app/api/mendeley/connect/route";
import { POST as citations } from "../app/api/citations/route";
import { NextRequest } from "next/server";

const article = {
  title: "Molecular structure of nucleic acids",
  authors: ["James Watson", "Francis Crick"], author_details: [{ given: "James", family: "Watson" }, { given: "Francis", family: "Crick" }],
  year: 1953, type: "journal_article" as const, container_title: "Nature", volume: "171", pages: "737-738", doi: "10.1038/171737a0",
};
function confirmed(metadata = article) {
  return { ...metadata, audit: auditReferenceMetadata(metadata, { manual: true }) };
}

test("parser reads explicit DOI/PMID/ISBN and ignores identifiers in references", () => {
  const parsed = inferReferenceMetadata({ fileName: "upload.pdf",
    frontMatter: "Title: Molecular structure of nucleic acids\nAuthors: James Watson; Francis Crick\nPublished: 1953\nDOI: 10.1038/171737a0\nPMID: 13054692\nReferences\n10.9999/unrelated" });
  assert.equal(parsed.doi, article.doi);
  assert.equal(parsed.pmid, "13054692");
  assert.deepEqual(parsed.authors, article.authors);
  assert.equal(parsed.year, 1953);
  assert.equal(parsed.title, article.title);
  const book = inferReferenceMetadata({ fileName: "book.pdf", frontMatter: "ISBN: 978-0-13-110362-7\nEdition: 2" });
  assert.equal(book.isbn, "9780131103627");
  assert.equal(book.edition, "2");
});

test("ISBN checksum and DOI normalization", () => {
  assert.equal(normalizeIsbn("0-13-110362-8"), "0131103628");
  assert.equal(normalizeIsbn("9780131103627"), "9780131103627");
  assert.equal(normalizeIsbn("9780131103628"), "");
  assert.equal(normalizeDoi("https://doi.org/10.1038/171737A0"), article.doi);
});

test("filename and arbitrary cover year cannot auto-verify a reference", () => {
  const metadata = inferReferenceMetadata({ fileName: "notes.pdf", frontMatter: "Notes 2026" });
  const audit = auditReferenceMetadata(metadata, {});
  assert.equal(audit.status, "auto");
  assert.equal(citationMetadataReady({ ...metadata, audit }), false);
  assert.equal(formatVerifiedReference(metadata, "apa"), null);
});

test("publication year must not be a DOI registration year", () => {
  assert.equal(mapCrossrefItem({ title: ["Test"], created: { "date-parts": [[2026]] } }).year, null);
});

test("a document-verified title and author cannot promote an uncertain cover year into CSL", () => {
  const metadata = inferReferenceMetadata({ fileName: "upload.pdf", frontMatter: "Title: Verified local lecture material\nAuthor: Jane Smith\nRevision 2026" });
  metadata.audit = auditReferenceMetadata(metadata, {});
  assert.equal(metadata.audit.status, "verified");
  assert.equal(referenceToCsl(metadata).issued, undefined);
  assert.ok(metadata.audit.issues.includes("unverified:year"));
});

test("ISBN-10 and equivalent ISBN-13 denote the same edition", () => {
  assert.equal(referenceIdentity({ isbn: "0131103628" }, { isbn: "9780131103627" }).accepted, true);
});

test("wrong DOI/PMID/ISBN or an ambiguous edition is rejected", () => {
  assert.equal(referenceIdentity({ doi: article.doi }, { doi: "10.1000/wrong" }).accepted, false);
  assert.equal(referenceIdentity({ pmid: "123" }, { pmid: "456" }).accepted, false);
  assert.equal(referenceIdentity({ title: "Reference Handbook", type: "book", edition: "5" },
    { title: "Reference Handbook", type: "book", edition: "6" }).accepted, false);
  assert.equal(referenceIdentity({ title: "Introduction to Chemistry" }, { title: "Introduction to Chemistry", type: "book" }).accepted, false);
});

test("explicit title is checked against exact identifier to avoid citing another work", () => {
  const input = inferReferenceMetadata({ fileName: "document.pdf", frontMatter: "Title: Completely unrelated pharmaceutical handbook\nDOI: " + article.doi });
  assert.equal(referenceIdentity(input, article).accepted, false);
});

test("all six styles render locally; APA 7 and Vancouver differ", () => {
  const previews = citationPreviews(confirmed());
  assert.equal(Object.keys(previews).length, 6);
  for (const [style, text] of Object.entries(previews)) assert.ok(text && text.includes("Watson"), style);
  assert.ok(previews.apa?.includes("(1953)"));
  assert.notEqual(previews.apa, previews.vancouver);
  assert.equal(referenceToCsl(confirmed()).author?.[0]?.family, "Watson");
});

test("Library citation processor excludes unverified and legacy metadata", () => {
  const result = processLibraryCitations([
    { id: "a", metadata: confirmed() }, { id: "b", metadata: article },
  ], "vancouver");
  assert.deepEqual(result.excluded, ["b"]);
  assert.equal(result.csl.length, 1);
  assert.equal(result.citations[0].sourceFileId, "a");
  assert.equal(buildDeterministicCitationInventory("apa", [{ source_file_id: "b", bibliographic_metadata: article }]), "");
});

test("numeric bibliography follows first-use order", () => {
  const other = confirmed({ ...article, title: "Another source", authors: ["Alice Author"], author_details: [{ family: "Author", given: "Alice" }], doi: "10.1000/another" });
  const result = processLibraryCitations([{ id: "b", metadata: other }, { id: "a", metadata: confirmed() }], "ieee");
  assert.ok(result.bibliography.indexOf("Another source") < result.bibliography.indexOf("Molecular"));
  assert.ok(result.citations[0].inText.includes("1"));
  assert.ok(result.citations[1].inText.includes("2"));
});

test("multiple Library files of one DOI reuse one bibliography identity", () => {
  const result = processLibraryCitations([{ id: "a", metadata: confirmed() }, { id: "b", metadata: confirmed() }], "vancouver");
  assert.equal(result.csl.length, 1);
  assert.equal(result.citations[0].inText, result.citations[1].inText);
});

test("public resolver has no Mendeley/GPT dependency and preserves manual corrections during outage", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (url: any) => { calls.push(String(url)); return new Response("unavailable", { status: 503 }); }) as typeof fetch;
  try {
    const result = await resolveReferenceMetadata({ fileName: "notes.pdf", frontMatter: "Title: Different automatic title\nYear: 2026",
      existing: confirmed(), preserveManual: true });
    assert.equal(result.metadata.title, article.title);
    assert.equal(result.metadata.year, 1953);
    assert.equal(result.status, "manual");
    assert.ok(result.metadata.audit?.history.length);
    assert.ok(calls.every((url) => !/mendeley|openai|gemini/i.test(url)));
    assert.equal(REFERENCE_CAPABILITIES.requiresMendeley, false);
  } finally { globalThis.fetch = originalFetch; }
});

test("exact public DOI metadata replaces filename guesses without blending wrong records", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any) => String(url).includes("api.crossref.org") ?
    Response.json({ message: { title: [article.title], author: [{ given: "James", family: "Watson" }], DOI: article.doi,
      issued: { "date-parts": [[1953]] }, type: "journal-article" } }) : new Response("", { status: 404 })) as typeof fetch;
  try {
    const result = await resolveReferenceMetadata({ fileName: "upload.pdf", frontMatter: "DOI: " + article.doi });
    assert.equal(result.status, "verified");
    assert.equal(result.metadata.title, article.title);
    assert.equal(result.metadata.audit?.matches[0].method, "doi");
  } finally { globalThis.fetch = originalFetch; }
});

test("OAuth is disabled by default and private citation endpoint requires own-Library login", async () => {
  const previous = process.env.ENABLE_LEGACY_MENDELEY;
  delete process.env.ENABLE_LEGACY_MENDELEY;
  try {
    assert.equal((await connect(new NextRequest("https://example.test/api/mendeley/connect"))).status, 410);
    assert.equal((await citations(new NextRequest("https://example.test/api/citations", { method: "POST" }))).status, 401);
  } finally {
    if (previous !== undefined) process.env.ENABLE_LEGACY_MENDELEY = previous;
  }
});

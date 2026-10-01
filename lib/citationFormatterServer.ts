import { Cite, plugins } from "@citation-js/core";
import "@citation-js/plugin-csl";
import type { ReferenceMetadata } from "@/lib/referenceMetadata";
import { citationMetadataReady, normalizeDoi, normalizeIsbn, isbnIdentity } from "@/lib/referenceMetadata";
import type { CitationStyle } from "@/lib/citations";
import cslStyles from "@/lib/cslStyles.json";

export type ProcessorStyle = Exclude<CitationStyle, "none">;
const styleTemplates: Record<ProcessorStyle, string> = {
  apa: "apa", vancouver: "vancouver", mla: "modern-language-association",
  chicago: "chicago-author-date", harvard: "harvard-university-of-leeds", ieee: "ieee",
};
for (const [name, xml] of Object.entries(cslStyles)) plugins.config.get("@csl").styles.add(name, xml);

function splitPerson(value: string) {
  const name = String(value || "").trim();
  if (!name) return null;
  if (name.includes(",")) {
    const [family, ...given] = name.split(",").map((part) => part.trim());
    return { family, given: given.join(" ") || undefined };
  }
  const parts = name.split(/\s+/);
  if (parts.length === 1) return { literal: name };
  return { family: parts.pop(), given: parts.join(" ") };
}

function cslType(type: ReferenceMetadata["type"]) {
  switch (type) {
    case "journal_article": return "article-journal";
    case "book": return "book";
    case "chapter": return "chapter";
    case "report": return "report";
    case "thesis": return "thesis";
    case "webpage": return "webpage";
    case "lecture_slides": return "speech";
    default: return "document";
  }
}

export function referenceToCsl(metadata: ReferenceMetadata) {
  // A verified work may still contain an unverified candidate year/type. CSL
  // must not promote those fields merely because its title/author were verified.
  metadata = { ...metadata };
  if (metadata.audit?.basis !== "manual") {
    for (const field of Object.keys(metadata)) {
      if (field === "audit" || field === "provenance") continue;
      const info = metadata.provenance?.[field];
      if (!info || info.confidence < 0.9 || info.source === "filename" || info.source === "mendeley") {
        delete (metadata as any)[field];
      }
    }
  }
  const authors = metadata.author_details?.length
    ? [...metadata.author_details] : (metadata.authors || []).map(splitPerson).filter(Boolean);
  if (!authors.length && metadata.corporate_author) {
    authors.push({ literal: metadata.corporate_author } as any);
  }
  return {
    id: metadata.doi || metadata.isbn || metadata.openalex_id || metadata.openlibrary_id ||
      metadata.pmid || metadata.title || "reference",
    type: cslType(metadata.type),
    title: metadata.title || undefined,
    author: authors.length ? authors : undefined,
    issued: metadata.year ? { "date-parts": [[metadata.year]] } : undefined,
    publisher: metadata.publisher || metadata.institution || undefined,
    "container-title": metadata.container_title || undefined,
    volume: metadata.volume || undefined,
    issue: metadata.issue || undefined,
    page: metadata.pages || undefined,
    edition: metadata.edition || undefined,
    DOI: normalizeDoi(metadata.doi) || undefined,
    ISBN: normalizeIsbn(metadata.isbn) || undefined,
    URL: metadata.url || undefined,
  };
}

export function formatVerifiedReference(
  metadata: ReferenceMetadata,
  style: ProcessorStyle
) {
  if (!citationMetadataReady(metadata)) return null;
  try {
    const cite = new Cite([referenceToCsl(metadata)]);
    const result = String(cite.format("bibliography", {
      format: "text",
      style: styleTemplates[style],
      lang: "en-US",
    }) || "").replace(/\s+/g, " ").trim();
    return result || null;
  } catch {
    return null;
  }
}

export function formatVerifiedReferences(
  items: ReferenceMetadata[],
  style: ProcessorStyle
) {
  if (!items.length) return "";
  try {
    const cite = new Cite(items.filter(citationMetadataReady).map(referenceToCsl));
    return String(cite.format("bibliography", {
      format: "text",
      style: styleTemplates[style],
      nosort: style === "vancouver" || style === "ieee",
      lang: "en-US",
    }) || "").trim();
  } catch {
    return "";
  }
}


function metadataFromKnowledgeSource(source: any): ReferenceMetadata {
  if (source?.bibliographic_metadata) return source.bibliographic_metadata;
  return {
    title: source?.bibliographic_work_title || source?.title || null,
    authors: Array.isArray(source?.bibliographic_authors) ? source.bibliographic_authors : [],
    corporate_author: source?.bibliographic_corporate_author || null,
    year: Number(source?.bibliographic_year) || null,
    publisher: source?.bibliographic_publisher || null,
    institution: source?.bibliographic_institution || null,
    type: source?.bibliographic_type || null,
    edition: source?.bibliographic_edition || null,
    container_title: source?.bibliographic_container_title || null,
    volume: source?.bibliographic_volume || null,
    issue: source?.bibliographic_issue || null,
    pages: source?.bibliographic_pages || null,
    doi: source?.bibliographic_doi || null,
    isbn: source?.bibliographic_isbn || null,
    url: source?.bibliographic_url || null,
  };
}

export function buildDeterministicCitationInventory(
  style: string,
  rows: any[]
) {
  if (!(style in styleTemplates)) return "";
  const unique = new Map<string, any>();
  for (const row of rows) {
    const key = String(row?.bibliographic_work_id || row?.source_file_id || row?.id || "");
    if (key && !unique.has(key)) unique.set(key, row);
  }
  const items: string[] = [];
  let index = 1;
  for (const [key, row] of unique) {
    const metadata = metadataFromKnowledgeSource(row);
    const formatted = formatVerifiedReference(metadata, style as ProcessorStyle);
    if (!formatted) continue;
    const clean = style === "vancouver" || style === "ieee"
      ? formatted.replace(/^\s*(?:\[\d+\]|\d+[.)])\s*/, "")
      : formatted;
    items.push(
      "WORK_ID=" + key + "\n" +
      "  CSL_" + style.toUpperCase() + "_EXACT=" + clean
    );
    index++;
  }
  if (!items.length) return "";
  return "\n\nFORMAT REFERENSI DETERMINISTIK (Citation.js/CSL; hanya pakai entri jika karya itu benar-benar mendukung jawaban):\n" +
    items.join("\n") +
    ((style === "vancouver" || style === "ieee")
      ? "\nNomor urut mengikuti urutan sitasi pertama dalam jawaban; jangan mengubah teks bibliografi setelah nomor."
      : "\nGunakan teks referensi persis seperti hasil CSL ini untuk karya yang benar-benar dipakai.");
}

export function citationPreviews(metadata: ReferenceMetadata) {
  return Object.fromEntries(Object.keys(styleTemplates).map((style) =>
    [style, formatVerifiedReference(metadata, style as ProcessorStyle)]));
}

/** Fully local, non-AI citation generation. Numeric input order is first-use order. */
export function processLibraryCitations(items: Array<{ id: string; metadata: ReferenceMetadata }>, style: ProcessorStyle) {
  const ready = items.filter((item) => citationMetadataReady(item.metadata));
  const excluded = items.filter((item) => !citationMetadataReady(item.metadata)).map((item) => item.id);
  if (!ready.length) return { csl: [], citations: [], bibliography: "", excluded };
  const workId = (item: { id: string; metadata: ReferenceMetadata }) =>
    normalizeDoi(item.metadata.doi) ? "doi:" + normalizeDoi(item.metadata.doi) :
    isbnIdentity(item.metadata.isbn) ? "isbn:" + isbnIdentity(item.metadata.isbn) :
    item.metadata.pmid ? "pmid:" + item.metadata.pmid : item.id;
  const unique = new Map(ready.map((item) => [workId(item), { ...referenceToCsl(item.metadata), id: workId(item) }]));
  const csl = [...unique.values()];
  const cite = new Cite(csl);
  const citations = ready.map((item, index) => ({
    sourceFileId: item.id,
    inText: String(cite.format("citation", {
      style: styleTemplates[style], lang: "en-US", format: "text",
      entry: workId(item), citationsPre: [...new Set(ready.slice(0, index).map(workId))], citationsPost: [],
    })).trim(),
  }));
  const bibliography = String(cite.format("bibliography", {
    style: styleTemplates[style], lang: "en-US", format: "text",
    nosort: style === "vancouver" || style === "ieee",
  })).trim();
  return { csl, citations, bibliography, excluded };
}

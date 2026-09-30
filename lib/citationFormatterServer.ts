import { Cite } from "@citation-js/core";
import "@citation-js/plugin-csl";
import type { ReferenceMetadata } from "@/lib/referenceMetadata";

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
  const authors = (metadata.authors || []).map(splitPerson).filter(Boolean);
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
    DOI: metadata.doi || undefined,
    ISBN: metadata.isbn || undefined,
    URL: metadata.url || undefined,
  };
}

export function formatVerifiedReference(
  metadata: ReferenceMetadata,
  style: "apa" | "vancouver"
) {
  if (!metadata.title) return null;
  try {
    const cite = new Cite([referenceToCsl(metadata)]);
    const result = String(cite.format("bibliography", {
      format: "text",
      template: style,
      lang: "en-US",
    }) || "").replace(/\s+/g, " ").trim();
    return result || null;
  } catch {
    return null;
  }
}

export function formatVerifiedReferences(
  items: ReferenceMetadata[],
  style: "apa" | "vancouver"
) {
  if (!items.length) return "";
  try {
    const cite = new Cite(items.filter((item) => item.title).map(referenceToCsl));
    return String(cite.format("bibliography", {
      format: "text",
      template: style,
      lang: "en-US",
    }) || "").trim();
  } catch {
    return "";
  }
}

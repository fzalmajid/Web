import {
  inferReferenceMetadata, mergeReferenceMetadata, normalizeDoi, normalizeIsbn,
  normalizePmid, referenceIdentity, titleSimilarity, REFERENCE_ENGINE_VERSION,
  type ReferenceMetadata, type ReferenceAudit,
} from "@/lib/referenceMetadata";
import { lookupPublicReferenceCatalogs, type CatalogMatch } from "@/lib/referenceCatalogsServer";

export const REFERENCE_CAPABILITIES = {
  engine: REFERENCE_ENGINE_VERSION,
  library: "ruang-belajar",
  localParser: true,
  identifiers: ["doi", "pmid", "isbn"],
  catalogs: ["crossref", "openalex", "pubmed", "europepmc", "datacite", "openlibrary"],
  normalizedCsl: true,
  styles: ["apa", "apa6", "vancouver", "mla", "harvard", "ieee", "chicago"],
  ai: "existing-local-ocr-or-gemini-fallback-only",
  requiresMendeley: false,
  requiresGpt: false,
};

export function mapCrossrefItem(item: any): ReferenceMetadata {
  const names = Array.isArray(item?.author) ? item.author : [];
  const metadata: ReferenceMetadata = {
    title: (Array.isArray(item?.title) ? item.title[0] : item?.title) || null,
    authors: names.map((name: any) => name.name || [name.given, name.family].filter(Boolean).join(" ")).filter(Boolean),
    author_details: names.map((name: any) => name.name ? { literal: name.name } : { given: name.given, family: name.family }),
    // DOI registration/creation dates are never publication dates.
    year: Number(item?.issued?.["date-parts"]?.[0]?.[0] || item?.published?.["date-parts"]?.[0]?.[0]) || null,
    publisher: item?.publisher || null,
    type: item?.type === "journal-article" ? "journal_article" : item?.type === "book-chapter" ? "chapter" :
      /book|monograph/i.test(item?.type || "") ? "book" : "other",
    container_title: item?.["container-title"]?.[0] || null,
    volume: item?.volume || null, issue: item?.issue || null, pages: item?.page || null,
    doi: normalizeDoi(item?.DOI) || null,
    isbn: normalizeIsbn(item?.ISBN?.[0]) || null,
    url: normalizeDoi(item?.DOI) ? "https://doi.org/" + normalizeDoi(item.DOI) : null,
  };
  metadata.provenance = Object.fromEntries(Object.entries(metadata)
    .filter(([, value]) => value != null && value !== "" && (!Array.isArray(value) || value.length))
    .map(([field]) => [field, { source: "crossref" as const, confidence: 0.99 }]));
  return metadata;
}

export async function lookupCrossref(input: ReferenceMetadata): Promise<CatalogMatch | null> {
  if (input.type === "lecture_slides" || ((input.isbn || input.pmid) && !input.doi) || !(input.title || input.doi)) return null;
  try {
    const doi = normalizeDoi(input.doi);
    const url = new URL("https://api.crossref.org/works" + (doi ? "/" + encodeURIComponent(doi) : ""));
    if (!doi) {
      url.searchParams.set("query.bibliographic", input.title || "");
      url.searchParams.set("rows", "5");
    }
    const response = await fetch(url, {
      headers: { "User-Agent": "RuangBelajar/1.0 (public-library reference verification)" },
      cache: "no-store", signal: AbortSignal.timeout(6500),
    });
    if (!response.ok) return null;
    const payload = await response.json() as any;
    const items = doi ? [payload?.message] : payload?.message?.items || [];
    const ranked = items.filter(Boolean).map((item: any) => {
      const metadata = mapCrossrefItem(item);
      return { source: "crossref" as const, metadata, similarity: doi ? 1 : titleSimilarity(input.title || "", metadata.title || "") };
    }).sort((a: CatalogMatch, b: CatalogMatch) => b.similarity - a.similarity);
    if (!ranked[0] || ranked[0].similarity < 0.92) return null;
    if (!doi && ranked[1] && ranked[0].similarity - ranked[1].similarity < 0.05) return null;
    return ranked[0];
  } catch {
    return null; // Public service failures must not break local Library imports.
  }
}

export function auditReferenceMetadata(
  metadata: ReferenceMetadata,
  input: { manual?: boolean; matches?: ReferenceAudit["matches"]; issues?: string[]; previous?: ReferenceAudit },
): ReferenceAudit {
  const matches = input.matches || [];
  const issues = [...(input.issues || [])];
  for (const [field, normalize] of [["doi", normalizeDoi], ["isbn", normalizeIsbn], ["pmid", normalizePmid]] as const) {
    if (metadata[field] && !normalize(metadata[field])) issues.push("invalid:" + field);
  }
  const missing = ["title", "authors", "year"].filter((field) =>
    field === "authors" ? !(metadata.authors?.length || metadata.corporate_author) : !(metadata as any)[field]);
  for (const [field, info] of Object.entries(metadata.provenance || {})) {
    if (info.confidence < 0.9 || info.source === "filename") issues.push("unverified:" + field);
  }
  const explicit = (field: string) => metadata.provenance?.[field]?.source === "document" &&
    (metadata.provenance[field].confidence >= 0.9);
  const documentVerified = explicit("title") && (explicit("authors") || explicit("corporate_author"));
  const conflict = issues.some((issue) => /conflict|edition_not_confirmed/.test(issue));
  const basis: ReferenceAudit["basis"] = input.manual ? "manual" :
    matches.length ? "catalog" : documentVerified ? "document" : "incomplete";
  const status: ReferenceAudit["status"] = input.manual ? "manual" : conflict ? "conflict" :
    metadata.title && (matches.length || documentVerified) ? "verified" : "auto";
  if (missing.length) issues.push("missing:" + missing.join(","));
  if (!matches.length && !input.manual) issues.push("no_public_catalog_match");
  const checkedAt = new Date().toISOString();
  const previous = input.previous;
  return {
    engineVersion: REFERENCE_ENGINE_VERSION, checkedAt, status, basis, matches,
    missing, issues: [...new Set(issues)],
    history: [
      ...(previous?.history || []).slice(-8),
      ...(previous ? [{ checkedAt: previous.checkedAt, status: previous.status, basis: previous.basis }] : []),
    ],
  };
}

/** No AI, OAuth, Mendeley or GPT is imported or called in the reference path. */
export async function resolveReferenceMetadata(input: {
  fileName: string; mimeType?: string | null; sourceUrl?: string | null;
  frontMatter?: string | null; existing?: ReferenceMetadata | null; preserveManual?: boolean;
}) {
  const existing: ReferenceMetadata = { ...(input.existing || {}), provenance: { ...(input.existing?.provenance || {}) } };
  if (!input.preserveManual) {
    // Legacy Mendeley fields cannot silently remain the source of truth.
    for (const [field, info] of Object.entries(existing.provenance || {})) {
      if (info.source === "mendeley") {
        delete (existing as any)[field];
        delete existing.provenance![field];
      }
    }
  } else {
    for (const field of Object.keys(existing)) {
      if (field !== "audit" && field !== "provenance") existing.provenance![field] = {
        source: "manual", confidence: 1, note: "Dikonfirmasi pengguna; tidak ditimpa katalog.",
      };
    }
  }
  let metadata = mergeReferenceMetadata(existing, inferReferenceMetadata(input), "document");
  metadata.doi = normalizeDoi(metadata.doi) || null;
  metadata.isbn = normalizeIsbn(metadata.isbn) || null;
  metadata.pmid = normalizePmid(metadata.pmid) || null;
  const results = await Promise.allSettled([lookupCrossref(metadata), lookupPublicReferenceCatalogs(metadata)]);
  const candidates: CatalogMatch[] = [
    ...(results[0].status === "fulfilled" && results[0].value ? [results[0].value] : []),
    ...(results[1].status === "fulfilled" ? results[1].value : []),
  ];
  const matches: ReferenceAudit["matches"] = [], issues: string[] = [];
  let anchor: ReferenceMetadata | null = null;
  for (const candidate of candidates) {
    const identity = referenceIdentity(metadata, candidate.metadata);
    const anchorIdentity = anchor ? referenceIdentity(anchor, candidate.metadata) : null;
    if (!identity.accepted || (anchorIdentity && !anchorIdentity.accepted)) {
      issues.push(candidate.source + ":" + (identity.issue || anchorIdentity?.issue || "catalog_disagreement"));
      continue;
    }
    anchor ||= candidate.metadata;
    matches.push({ source: candidate.source, similarity: candidate.similarity, method: identity.method });
    // Do not let later, weaker providers replace fields already supplied by
    // the canonical record; manual values remain locked.
    const supplement: ReferenceMetadata = { ...candidate.metadata, provenance: { ...candidate.metadata.provenance } };
    for (const field of Object.keys(supplement)) {
      if (field === "provenance") continue;
      const before = (metadata as any)[field], after = (supplement as any)[field];
      if (before && after && JSON.stringify(before) !== JSON.stringify(after) &&
          (metadata.provenance?.[field]?.confidence || 0) >= 0.9 &&
          ["document", "manual"].includes(metadata.provenance?.[field]?.source || "")) {
        issues.push((metadata.provenance?.[field]?.source === "manual" ? "manual_catalog_difference:" : "catalog_correction:") + field);
      }
      if (metadata.provenance?.[field]?.source === "manual" ||
          (matches.length > 1 && metadata.provenance?.[field]?.source !== "document" &&
           metadata.provenance?.[field]?.source !== "filename" && (metadata as any)[field])) {
        delete (supplement as any)[field];
      }
    }
    metadata = mergeReferenceMetadata(metadata, supplement, candidate.source);
  }
  metadata.audit = auditReferenceMetadata(metadata, { manual: input.preserveManual, matches, issues, previous: input.existing?.audit });
  const confidenceValues = Object.values(metadata.provenance || {}).map((item) => item.confidence);
  return {
    metadata, status: metadata.audit.status,
    confidence: confidenceValues.length ? confidenceValues.reduce((sum, n) => sum + n, 0) / confidenceValues.length : 0,
    crossrefMatched: matches.some((match) => match.source === "crossref"),
    crossrefSimilarity: matches.find((match) => match.source === "crossref")?.similarity || null,
    catalogMatches: matches,
  };
}

import type { ReferenceMetadata } from "@/lib/referenceMetadata";
import { inferReferenceMetadata, mergeReferenceMetadata, titleSimilarity } from "@/lib/referenceMetadata";

let cachedMendeley: { token: string; expiresAt: number } | null = null;

export function mendeleyConfigured() {
  return Boolean(process.env.MENDELEY_CLIENT_ID && process.env.MENDELEY_CLIENT_SECRET);
}

async function mendeleyToken() {
  if (!mendeleyConfigured()) return null;
  if (cachedMendeley && cachedMendeley.expiresAt > Date.now() + 60_000) return cachedMendeley.token;
  const id = String(process.env.MENDELEY_CLIENT_ID);
  const secret = String(process.env.MENDELEY_CLIENT_SECRET);
  const basic = Buffer.from(id + ":" + secret).toString("base64");
  const response = await fetch("https://api.mendeley.com/oauth/token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + basic,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=all",
    cache: "no-store",
  });
  if (!response.ok) return null;
  const data = await response.json().catch(() => null) as any;
  const token = String(data?.access_token || "");
  if (!token) return null;
  cachedMendeley = {
    token,
    expiresAt: Date.now() + Math.max(300, Number(data?.expires_in) || 3600) * 1000,
  };
  return token;
}

function mapMendeleyDocument(doc: any): ReferenceMetadata {
  const authors = Array.isArray(doc?.authors)
    ? doc.authors.map((author: any) =>
        [author?.first_name, author?.last_name].filter(Boolean).join(" ").trim()
      ).filter(Boolean)
    : [];
  const identifiers = doc?.identifiers || {};
  return {
    title: doc?.title || null,
    authors,
    year: Number(doc?.year) || null,
    publisher: doc?.publisher || null,
    type: doc?.type === "journal" ? "journal_article" :
      doc?.type === "book" ? "book" : doc?.type === "book_section" ? "chapter" : "other",
    edition: doc?.edition || null,
    container_title: doc?.source || null,
    volume: doc?.volume || null,
    issue: doc?.issue || null,
    pages: doc?.pages || null,
    doi: identifiers?.doi || null,
    isbn: identifiers?.isbn || null,
    mendeley_id: doc?.id || null,
    provenance: Object.fromEntries(
      ["title","authors","year","publisher","type","edition","container_title","volume","issue","pages","doi","isbn","mendeley_id"]
        .filter((key) => {
          const value = (key === "container_title" ? doc?.source :
            key === "doi" ? identifiers?.doi :
            key === "isbn" ? identifiers?.isbn :
            key === "mendeley_id" ? doc?.id :
            (key === "authors" ? authors : doc?.[key]));
          return Array.isArray(value) ? value.length : Boolean(value);
        })
        .map((key) => [key, { source: "mendeley", confidence: key === "doi" || key === "isbn" ? 0.99 : 0.92 }])
    ) as any,
  };
}

export async function lookupMendeleyCatalog(metadata: ReferenceMetadata) {
  if (!mendeleyConfigured() || metadata.type === "lecture_slides" || !metadata.title) return null;
  const token = await mendeleyToken();
  if (!token) return null;
  const url = new URL("https://api.mendeley.com/search/catalog");
  url.searchParams.set("query", metadata.title);
  url.searchParams.set("limit", "5");
  const response = await fetch(url, {
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.mendeley-document.1+json",
    },
    cache: "no-store",
  });
  if (!response.ok) return null;
  const docs = await response.json().catch(() => []) as any[];
  if (!Array.isArray(docs) || !docs.length) return null;
  const ranked = docs
    .map((doc) => ({ doc, similarity: titleSimilarity(metadata.title || "", String(doc?.title || "")) }))
    .sort((a,b) => b.similarity - a.similarity);
  if (!ranked[0] || ranked[0].similarity < 0.78) return null;
  return {
    metadata: mapMendeleyDocument(ranked[0].doc),
    similarity: ranked[0].similarity,
  };
}

export async function resolveReferenceMetadata(input: {
  fileName: string;
  mimeType?: string | null;
  sourceUrl?: string | null;
  frontMatter?: string | null;
  existing?: ReferenceMetadata | null;
  preserveManual?: boolean;
}) {
  let metadata = inferReferenceMetadata(input);
  const existing = input.existing || {};
  if (input.preserveManual) {
    metadata = mergeReferenceMetadata(metadata, existing, "manual", 0);
  } else {
    metadata = mergeReferenceMetadata(existing, metadata, "document", 0);
  }

  const mendeley = await lookupMendeleyCatalog(metadata);
  if (mendeley) {
    metadata = mergeReferenceMetadata(metadata, mendeley.metadata, "mendeley", 0.78);
  }

  const confidenceValues = Object.values(metadata.provenance || {}).map((item) => Number(item.confidence) || 0);
  const confidence = confidenceValues.length
    ? confidenceValues.reduce((sum,n) => sum+n,0) / confidenceValues.length
    : 0;
  return {
    metadata,
    confidence,
    mendeleyMatched: Boolean(mendeley),
    mendeleySimilarity: mendeley?.similarity || null,
  };
}

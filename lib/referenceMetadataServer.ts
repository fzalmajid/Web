import type { ReferenceMetadata } from "@/lib/referenceMetadata";
import { inferReferenceMetadata, mergeReferenceMetadata, titleSimilarity } from "@/lib/referenceMetadata";
import { lookupPublicReferenceCatalogs } from "@/lib/referenceCatalogsServer";

// Server-only Mendeley credentials are read from Vercel environment variables.
// Never expose the client secret to the browser bundle.
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

export async function testMendeleyCatalogConnection() {
  const configured = mendeleyConfigured();
  if (!configured) return { configured: false, reachable: false };
  const token = await mendeleyToken();
  return { configured: true, reachable: Boolean(token) };
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


function mapCrossrefItem(item: any): ReferenceMetadata {
  const authors = Array.isArray(item?.author)
    ? item.author.map((author: any) =>
        [author?.given, author?.family].filter(Boolean).join(" ").trim()
      ).filter(Boolean)
    : [];
  const issued = item?.issued?.["date-parts"]?.[0]?.[0] ||
    item?.published?.["date-parts"]?.[0]?.[0] ||
    item?.created?.["date-parts"]?.[0]?.[0] || null;
  const title = Array.isArray(item?.title) ? item.title[0] : item?.title;
  const container = Array.isArray(item?.["container-title"]) ? item["container-title"][0] : item?.["container-title"];
  const isbn = Array.isArray(item?.ISBN) ? item.ISBN[0] : null;
  const type = item?.type === "journal-article" ? "journal_article" :
    item?.type === "book-chapter" ? "chapter" :
    /book|monograph/i.test(String(item?.type || "")) ? "book" : "other";
  const metadata: ReferenceMetadata = {
    title: title || null,
    authors,
    year: Number(issued) || null,
    publisher: item?.publisher || null,
    type,
    container_title: container || null,
    volume: item?.volume || null,
    issue: item?.issue || null,
    pages: item?.page || null,
    doi: item?.DOI || null,
    isbn: isbn || null,
    url: item?.URL || null,
    provenance: {},
  };
  for (const key of ["title","authors","year","publisher","type","container_title","volume","issue","pages","doi","isbn","url"]) {
    const value = (metadata as any)[key];
    if (Array.isArray(value) ? value.length : value) {
      (metadata.provenance as any)[key] = {
        source: "crossref",
        confidence: key === "doi" || key === "isbn" ? 0.99 : 0.93,
      };
    }
  }
  return metadata;
}

async function lookupCrossref(metadata: ReferenceMetadata) {
  if (!metadata.title || metadata.type === "lecture_slides" || metadata.type === "report" || metadata.type === "webpage") return null;
  try {
    if (metadata.doi) {
      const doi = metadata.doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
      const response = await fetch("https://api.crossref.org/works/" + encodeURIComponent(doi), {
        headers: { "User-Agent": "RuangBelajar/1.0 (metadata validation)" },
        cache: "no-store",
      });
      if (!response.ok) return null;
      const payload = await response.json().catch(() => null) as any;
      const item = payload?.message;
      return item ? { metadata: mapCrossrefItem(item), similarity: 1 } : null;
    }
    if (!["journal_article","chapter","book"].includes(String(metadata.type || ""))) return null;
    const url = new URL("https://api.crossref.org/works");
    url.searchParams.set("query.bibliographic", metadata.title);
    url.searchParams.set("rows", "5");
    url.searchParams.set("select", "DOI,title,author,issued,published,created,publisher,type,container-title,volume,issue,page,ISBN,URL");
    const response = await fetch(url, {
      headers: { "User-Agent": "RuangBelajar/1.0 (metadata validation)" },
      cache: "no-store",
    });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => null) as any;
    const items = payload?.message?.items;
    if (!Array.isArray(items) || !items.length) return null;
    const ranked = items
      .map((item: any) => ({
        item,
        similarity: titleSimilarity(metadata.title || "", String(Array.isArray(item?.title) ? item.title[0] : item?.title || "")),
      }))
      .sort((a: any,b: any) => b.similarity - a.similarity);
    if (!ranked[0] || ranked[0].similarity < 0.86) return null;
    return { metadata: mapCrossrefItem(ranked[0].item), similarity: ranked[0].similarity };
  } catch {
    return null;
  }
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

  // Catalogs are independent verifiers. Never skip a stronger public match just
  // because another provider happened to answer first.
  const [mendeleyResult, crossrefResult, publicResult] = await Promise.allSettled([
    lookupMendeleyCatalog(metadata),
    lookupCrossref(metadata),
    lookupPublicReferenceCatalogs(metadata),
  ]);
  const mendeley = mendeleyResult.status === "fulfilled" ? mendeleyResult.value : null;
  const crossref = crossrefResult.status === "fulfilled" ? crossrefResult.value : null;
  const publicMatches = publicResult.status === "fulfilled" ? publicResult.value : [];

  if (crossref) {
    metadata = mergeReferenceMetadata(metadata, crossref.metadata, "crossref", 0.86);
  }
  for (const match of publicMatches) {
    metadata = mergeReferenceMetadata(
      metadata,
      match.metadata,
      match.source,
      match.source === "openlibrary" ? 0.88 : 0.9
    );
  }
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
    crossrefMatched: Boolean(crossref),
    crossrefSimilarity: crossref?.similarity || null,
    catalogMatches: publicMatches.map((match) => ({
      source: match.source,
      similarity: match.similarity,
    })),
  };
}

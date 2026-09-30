import type { ReferenceMetadata } from "@/lib/referenceMetadata";
import { titleSimilarity } from "@/lib/referenceMetadata";

export type CatalogMatch = {
  source: "datacite" | "openalex" | "openlibrary" | "europepmc" | "pubmed";
  metadata: ReferenceMetadata;
  similarity: number;
};

function cleanDoi(value: unknown) {
  return String(value || "").trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .replace(/[.,;)]$/, "");
}

function cleanIsbn(value: unknown) {
  return String(value || "").replace(/[^0-9X]/gi, "").toUpperCase();
}

function authorsFromDataCite(items: any[]) {
  return (Array.isArray(items) ? items : [])
    .map((creator: any) => String(creator?.name || [creator?.givenName, creator?.familyName].filter(Boolean).join(" ")).trim())
    .filter(Boolean);
}

function provenance(metadata: ReferenceMetadata, source: CatalogMatch["source"], base = 0.93) {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (key === "provenance" || value === null || value === undefined || value === "" ||
        (Array.isArray(value) && !value.length)) continue;
    result[key] = {
      source,
      confidence: ["doi","isbn","pmid","pmcid","datacite_id","openalex_id","openlibrary_id"].includes(key)
        ? 0.99 : base,
    };
  }
  return result;
}

function dataCiteMetadata(item: any): ReferenceMetadata {
  const attributes = item?.attributes || {};
  const title = Array.isArray(attributes?.titles) ? attributes.titles[0]?.title : null;
  const container = Array.isArray(attributes?.container) ? attributes.container?.title : attributes?.container?.title;
  const doi = cleanDoi(attributes?.doi || item?.id);
  const isbn = (Array.isArray(attributes?.relatedIdentifiers) ? attributes.relatedIdentifiers : [])
    .find((entry: any) => /isbn/i.test(String(entry?.relatedIdentifierType || "")))?.relatedIdentifier || null;
  const typeName = String(attributes?.types?.resourceTypeGeneral || "").toLowerCase();
  const type: ReferenceMetadata["type"] =
    typeName.includes("journal") ? "journal_article" :
    typeName.includes("book") ? "book" :
    typeName.includes("report") ? "report" :
    typeName.includes("dissertation") ? "thesis" : "other";
  const metadata: ReferenceMetadata = {
    title: title ? String(title) : null,
    authors: authorsFromDataCite(attributes?.creators),
    year: Number(attributes?.publicationYear) || null,
    publisher: attributes?.publisher || null,
    type,
    container_title: container || null,
    doi: doi || null,
    isbn: isbn ? String(isbn) : null,
    url: doi ? "https://doi.org/" + doi : attributes?.url || null,
    datacite_id: String(item?.id || doi || "") || null,
  };
  metadata.provenance = provenance(metadata, "datacite", 0.94);
  return metadata;
}

async function lookupDataCite(input: ReferenceMetadata): Promise<CatalogMatch | null> {
  try {
    const doi = cleanDoi(input.doi);
    if (doi) {
      const response = await fetch("https://api.datacite.org/dois/" + encodeURIComponent(doi), {
        headers: { "User-Agent": "RuangBelajar/1.0 (reference validation)" },
        signal: AbortSignal.timeout(6500),
        cache: "no-store",
      });
      if (!response.ok) return null;
      const payload = await response.json().catch(() => null) as any;
      const item = payload?.data;
      return item ? { source: "datacite", metadata: dataCiteMetadata(item), similarity: 1 } : null;
    }
    if (!input.title || input.type === "lecture_slides") return null;
    const url = new URL("https://api.datacite.org/dois");
    url.searchParams.set("query", 'titles.title:"' + String(input.title).replace(/"/g, "") + '"');
    url.searchParams.set("page[size]", "5");
    const response = await fetch(url, {
      headers: { "User-Agent": "RuangBelajar/1.0 (reference validation)" },
      signal: AbortSignal.timeout(6500),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => null) as any;
    const items = Array.isArray(payload?.data) ? payload.data : [];
    const ranked = items.map((item: any) => {
      const metadata = dataCiteMetadata(item);
      return { metadata, similarity: titleSimilarity(String(input.title), String(metadata.title || "")) };
    }).sort((a: any, b: any) => b.similarity - a.similarity);
    if (!ranked[0] || ranked[0].similarity < 0.9) return null;
    return { source: "datacite", ...ranked[0] };
  } catch {
    return null;
  }
}

function openAlexMetadata(work: any): ReferenceMetadata {
  const primary = work?.primary_location || {};
  const doi = cleanDoi(work?.doi);
  const metadata: ReferenceMetadata = {
    title: work?.display_name || work?.title || null,
    authors: (Array.isArray(work?.authorships) ? work.authorships : [])
      .map((authorship: any) => String(authorship?.author?.display_name || "").trim()).filter(Boolean),
    year: Number(work?.publication_year) || null,
    publisher: primary?.source?.host_organization_name || null,
    type: /book/i.test(String(work?.type || "")) ? "book" :
      /article|preprint/i.test(String(work?.type || "")) ? "journal_article" : "other",
    container_title: primary?.source?.display_name || null,
    volume: work?.biblio?.volume || null,
    issue: work?.biblio?.issue || null,
    pages: [work?.biblio?.first_page, work?.biblio?.last_page].filter(Boolean).join("-") || null,
    doi: doi || null,
    url: primary?.landing_page_url || (doi ? "https://doi.org/" + doi : work?.id) || null,
    openalex_id: work?.id || null,
  };
  metadata.provenance = provenance(metadata, "openalex", 0.94);
  return metadata;
}

async function lookupOpenAlex(input: ReferenceMetadata): Promise<CatalogMatch | null> {
  const apiKey = String(process.env.OPENALEX_API_KEY || "").trim();
  if (input.type === "lecture_slides") return null;
  try {
    const url = new URL("https://api.openalex.org/works");
    const doi = cleanDoi(input.doi);
    if (doi) url.searchParams.set("filter", "doi:" + doi);
    else if (input.title) url.searchParams.set("search", input.title);
    else return null;
    url.searchParams.set("per-page", "5");
    if (apiKey) url.searchParams.set("api_key", apiKey);
    const response = await fetch(url, {
      headers: { "User-Agent": "RuangBelajar/1.0 (reference validation)" },
      signal: AbortSignal.timeout(6500),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => null) as any;
    const works = Array.isArray(payload?.results) ? payload.results : [];
    const ranked = works.map((work: any) => {
      const metadata = openAlexMetadata(work);
      return {
        metadata,
        similarity: doi ? 1 : titleSimilarity(String(input.title || ""), String(metadata.title || "")),
      };
    }).sort((a: any, b: any) => b.similarity - a.similarity);
    if (!ranked[0] || ranked[0].similarity < (doi ? 0.99 : 0.88)) return null;
    return { source: "openalex", ...ranked[0] };
  } catch {
    return null;
  }
}

function openLibraryMetadata(doc: any): ReferenceMetadata {
  const isbn = Array.isArray(doc?.isbn) ? doc.isbn[0] : doc?.isbn_13?.[0] || doc?.isbn_10?.[0] || null;
  const workKey = doc?.key || doc?.edition_key?.[0] || null;
  const metadata: ReferenceMetadata = {
    title: doc?.title || null,
    authors: Array.isArray(doc?.author_name) ? doc.author_name : [],
    year: Number(doc?.first_publish_year || doc?.publish_year?.[0]) || null,
    publisher: Array.isArray(doc?.publisher) ? doc.publisher[0] : null,
    type: "book",
    edition: Array.isArray(doc?.edition_name) ? doc.edition_name[0] : null,
    isbn: isbn || null,
    url: workKey ? "https://openlibrary.org" + workKey : null,
    openlibrary_id: workKey || null,
  };
  metadata.provenance = provenance(metadata, "openlibrary", 0.91);
  return metadata;
}

async function lookupOpenLibrary(input: ReferenceMetadata): Promise<CatalogMatch | null> {
  if (input.type === "lecture_slides" || input.type === "journal_article") return null;
  try {
    const url = new URL("https://openlibrary.org/search.json");
    const isbn = cleanIsbn(input.isbn);
    if (isbn) url.searchParams.set("isbn", isbn);
    else if (input.title) url.searchParams.set("title", input.title);
    else return null;
    url.searchParams.set("limit", "5");
    url.searchParams.set("fields", "key,title,author_name,first_publish_year,publish_year,publisher,isbn,edition_name,edition_key");
    const response = await fetch(url, {
      headers: { "User-Agent": "RuangBelajar/1.0 (reference validation)" },
      signal: AbortSignal.timeout(6500),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => null) as any;
    const docs = Array.isArray(payload?.docs) ? payload.docs : [];
    const ranked = docs.map((doc: any) => {
      const metadata = openLibraryMetadata(doc);
      return {
        metadata,
        similarity: isbn ? 1 : titleSimilarity(String(input.title || ""), String(metadata.title || "")),
      };
    }).sort((a: any, b: any) => b.similarity - a.similarity);
    if (!ranked[0] || ranked[0].similarity < (isbn ? 0.99 : 0.88)) return null;
    return { source: "openlibrary", ...ranked[0] };
  } catch {
    return null;
  }
}

function europePmcMetadata(item: any): ReferenceMetadata {
  const doi = cleanDoi(item?.doi);
  const metadata: ReferenceMetadata = {
    title: item?.title || null,
    authors: String(item?.authorString || "").split(/,|;/).map((x) => x.trim()).filter(Boolean),
    year: Number(item?.pubYear) || null,
    type: "journal_article",
    container_title: item?.journalTitle || null,
    volume: item?.journalVolume || null,
    issue: item?.issue || null,
    pages: item?.pageInfo || null,
    doi: doi || null,
    url: item?.pmid ? "https://pubmed.ncbi.nlm.nih.gov/" + item.pmid + "/" :
      doi ? "https://doi.org/" + doi : null,
    pmid: item?.pmid || null,
    pmcid: item?.pmcid || null,
  };
  metadata.provenance = provenance(metadata, "europepmc", 0.94);
  return metadata;
}

async function lookupEuropePmc(input: ReferenceMetadata): Promise<CatalogMatch | null> {
  if (input.type === "lecture_slides" || input.type === "book" || !input.title) return null;
  try {
    const url = new URL("https://www.ebi.ac.uk/europepmc/webservices/rest/search");
    const doi = cleanDoi(input.doi);
    url.searchParams.set("query", doi ? 'DOI:"' + doi + '"' : 'TITLE:"' + String(input.title).replace(/"/g, "") + '"');
    url.searchParams.set("format", "json");
    url.searchParams.set("resultType", "core");
    url.searchParams.set("pageSize", "5");
    const response = await fetch(url, {
      headers: { "User-Agent": "RuangBelajar/1.0 (reference validation)" },
      signal: AbortSignal.timeout(6500),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => null) as any;
    const items = Array.isArray(payload?.resultList?.result) ? payload.resultList.result : [];
    const ranked = items.map((item: any) => {
      const metadata = europePmcMetadata(item);
      return { metadata, similarity: doi ? 1 : titleSimilarity(String(input.title), String(metadata.title || "")) };
    }).sort((a: any, b: any) => b.similarity - a.similarity);
    if (!ranked[0] || ranked[0].similarity < (doi ? 0.99 : 0.9)) return null;
    return { source: "europepmc", ...ranked[0] };
  } catch {
    return null;
  }
}


function pubMedMetadata(item: any): ReferenceMetadata {
  const articleIds = Array.isArray(item?.articleids) ? item.articleids : [];
  const doi = cleanDoi(articleIds.find((entry: any) =>
    String(entry?.idtype || "").toLowerCase() === "doi"
  )?.value);
  const yearMatch = /\b(19\d{2}|20\d{2})\b/.exec(String(item?.pubdate || item?.sortpubdate || ""));
  const authors = (Array.isArray(item?.authors) ? item.authors : [])
    .map((author: any) => String(author?.name || "").trim())
    .filter(Boolean);
  const pmid = String(item?.uid || item?.pmid || "");
  const metadata: ReferenceMetadata = {
    title: String(item?.title || "").replace(/[.]$/, "") || null,
    authors,
    year: yearMatch ? Number(yearMatch[1]) : null,
    type: "journal_article",
    container_title: item?.fulljournalname || item?.source || null,
    volume: item?.volume || null,
    issue: item?.issue || null,
    pages: item?.pages || null,
    doi: doi || null,
    url: pmid ? "https://pubmed.ncbi.nlm.nih.gov/" + pmid + "/" : doi ? "https://doi.org/" + doi : null,
    pmid: pmid || null,
  };
  metadata.provenance = provenance(metadata, "pubmed", 0.95);
  return metadata;
}

async function lookupPubMed(input: ReferenceMetadata): Promise<CatalogMatch | null> {
  if (input.type === "lecture_slides" || input.type === "book" || !input.title) return null;
  const apiKey = String(process.env.NCBI_API_KEY || "").trim();
  try {
    const doi = cleanDoi(input.doi);
    const searchUrl = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi");
    searchUrl.searchParams.set("db", "pubmed");
    searchUrl.searchParams.set("retmode", "json");
    searchUrl.searchParams.set("retmax", "5");
    searchUrl.searchParams.set(
      "term",
      doi
        ? '"' + doi.replace(/"/g, "") + '"[AID]'
        : '"' + String(input.title).replace(/"/g, "") + '"[Title]'
    );
    if (apiKey) searchUrl.searchParams.set("api_key", apiKey);
    const searchResponse = await fetch(searchUrl, {
      headers: { "User-Agent": "RuangBelajar/1.0 (reference validation)" },
      signal: AbortSignal.timeout(6500),
      cache: "no-store",
    });
    if (!searchResponse.ok) return null;
    const searchPayload = await searchResponse.json().catch(() => null) as any;
    const ids = Array.isArray(searchPayload?.esearchresult?.idlist)
      ? searchPayload.esearchresult.idlist.slice(0, 5)
      : [];
    if (!ids.length) return null;

    const summaryUrl = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi");
    summaryUrl.searchParams.set("db", "pubmed");
    summaryUrl.searchParams.set("retmode", "json");
    summaryUrl.searchParams.set("id", ids.join(","));
    if (apiKey) summaryUrl.searchParams.set("api_key", apiKey);
    const summaryResponse = await fetch(summaryUrl, {
      headers: { "User-Agent": "RuangBelajar/1.0 (reference validation)" },
      signal: AbortSignal.timeout(6500),
      cache: "no-store",
    });
    if (!summaryResponse.ok) return null;
    const summaryPayload = await summaryResponse.json().catch(() => null) as any;
    const ranked = ids
      .map((id: string) => summaryPayload?.result?.[id])
      .filter(Boolean)
      .map((item: any) => {
        const metadata = pubMedMetadata(item);
        return {
          metadata,
          similarity: doi ? 1 : titleSimilarity(String(input.title), String(metadata.title || "")),
        };
      })
      .sort((a: any,b: any) => b.similarity - a.similarity);
    if (!ranked[0] || ranked[0].similarity < (doi ? 0.99 : 0.9)) return null;
    return { source: "pubmed", ...ranked[0] };
  } catch {
    return null;
  }
}

export async function lookupPublicReferenceCatalogs(input: ReferenceMetadata) {
  const results = await Promise.allSettled([
    lookupDataCite(input),
    lookupOpenAlex(input),
    lookupOpenLibrary(input),
    lookupEuropePmc(input),
    lookupPubMed(input),
  ]);
  return results
    .filter((item): item is PromiseFulfilledResult<CatalogMatch | null> => item.status === "fulfilled")
    .map((item) => item.value)
    .filter((item): item is CatalogMatch => Boolean(item));
}

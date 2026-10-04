import { indexedAbstract, rankResearchHits, scientificQueryPlan, matchesRequiredTopic, withinResearchScope } from "./researchQuery";
import { boundedJson, paperConnections } from "./publicResearch";
import { searchScopus } from "./scholarlyIndexes";
import type { ReferenceDocumentType } from "./referenceMetadata";

export type ScholarlyHit = {
  provider: "openalex" | "europepmc" | "pubmed" | "semanticscholar" | "crossref" | "scopus";
  id: string;
  title: string;
  authors: string[];
  year: number | null;
  doi: string | null;
  pmid: string | null;
  pmcid: string | null;
  journal: string | null;
  uri: string;
  openAccess: boolean;
  abstract?: string | null;
  fullTextUrls?: string[];
  volume?: string | null;
  issue?: string | null;
  pages?: string | null;
  metadataBasis?: "publisher";
  metadataNotice?: string;
  publicationVersionConflict?: boolean;
  indexedIn?: Array<"scopus">;
  workType?: ReferenceDocumentType;
};

function cleanDoi(value: unknown) {
  const raw = String(value || "").trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "");
  return raw || null;
}

function cleanText(value: unknown, max = 600) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function yearFrom(value: unknown) {
  const match = /\b(19\d{2}|20\d{2})\b/.exec(String(value || ""));
  return match ? Number(match[1]) : null;
}

function stableKey(hit: ScholarlyHit) {
  if (hit.doi) return "doi:" + hit.doi.toLowerCase();
  if (hit.pmid) return "pmid:" + hit.pmid;
  return "title:" + hit.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function isBiomedicalQuery(query: string) {
  return /\b(?:farmasi|farmak(?:i|o|okinetik|odinamik)|pharmac(?:y|ology|okinetic|odynamic)|obat|drug|medicine|medication|tablet|kapsul|dosage|dose|dosis|clinical|klinis|biomed|biomedical|disease|penyakit|terapi|therapy|treatment|diagnosis|patient|pasien|paracetamol|parasetamol|acetaminophen|antibiotic|antibiotik|bioavailability|bioavailabilitas|disolusi|dissolution|absorption|absorpsi|metabolism|metabolisme|toxicology|toksikologi|adverse|efek samping)\b/i.test(query);
}

export function openAlexConfigured() {
  return true;
}

export function openAlexHasApiKey() {
  return Boolean(String(process.env.OPENALEX_API_KEY || "").trim());
}

export function openAlexOpenLocationUrls(work:any){
  const bestOa=work?.best_oa_location||null;
  const locations=Array.isArray(work?.locations)?work.locations:[];
  return [...new Set([
    bestOa?.pdf_url,
    bestOa?.landing_page_url,
    ...locations
      .filter((location:any)=>Boolean(location?.is_oa||location?.pdf_url))
      .flatMap((location:any)=>[location?.pdf_url,location?.landing_page_url]),
  ].filter((value):value is string=>typeof value==="string"&&/^https?:\/\//i.test(value)))].slice(0,8);
}

export async function openAlexOpenLocationsForDoi(doi:string){
  const normalized=cleanDoi(doi);
  if(!normalized)return [] as string[];
  const apiKey=String(process.env.OPENALEX_API_KEY||"").trim();
  const url=new URL("https://api.openalex.org/works");
  url.searchParams.set("filter","doi:https://doi.org/"+normalized);
  url.searchParams.set("per-page","1");
  if(apiKey)url.searchParams.set("api_key",apiKey);
  const response=await fetch(url,{
    headers:{"User-Agent":"RuangBelajar/1.0 (full-text resolver)"},
    signal:AbortSignal.timeout(7000),
    cache:"no-store",
  }).catch(()=>null);
  if(!response?.ok)return [] as string[];
  const payload=await response.json().catch(()=>null) as any;
  const work=Array.isArray(payload?.results)?payload.results[0]:null;
  return work?openAlexOpenLocationUrls(work):[];
}

async function searchOpenAlex(query: string, limit: number): Promise<ScholarlyHit[]> {
  const apiKey = String(process.env.OPENALEX_API_KEY || "").trim();
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("search", query);
  url.searchParams.set("per-page", String(Math.max(1, Math.min(12, limit))));
  if (apiKey) url.searchParams.set("api_key", apiKey);
  const response = await fetch(url, {
    headers: { "User-Agent": "RuangBelajar/1.0 (scholarly search)" },
    signal: AbortSignal.timeout(7000),
    cache: "no-store",
  });
  if (!response.ok) return [];
  const payload = await response.json().catch(() => null) as any;
  const works = Array.isArray(payload?.results) ? payload.results : [];
  return works.map((work: any): ScholarlyHit | null => {
    const title = cleanText(work?.display_name || work?.title, 1000);
    if (!title) return null;
    const doi = cleanDoi(work?.doi);
    const bestOa = work?.best_oa_location || null;
    const best = bestOa || work?.primary_location || {};
    const locations = Array.isArray(work?.locations) ? work.locations : [];
    const openLocationUrls = openAlexOpenLocationUrls(work);
    const landing = cleanText(best?.landing_page_url || best?.pdf_url || openLocationUrls[0] || work?.id, 1500);
    const uri = landing || (doi ? "https://doi.org/" + doi : cleanText(work?.id, 1500));
    if (!/^https?:\/\//i.test(uri)) return null;
    return {
      provider: "openalex",
      id: cleanText(work?.id || doi || title, 600),
      title,
      authors: (Array.isArray(work?.authorships) ? work.authorships : [])
        .map((item: any) => cleanText(item?.author?.display_name, 240)).filter(Boolean).slice(0, 30),
      year: Number(work?.publication_year) || null,
      doi,
      pmid: null,
      pmcid: null,
      journal: cleanText(best?.source?.display_name || work?.primary_location?.source?.display_name, 500) || null,
      uri,
      openAccess: Boolean(work?.open_access?.is_oa || bestOa?.is_oa || locations.some((location: any) => Boolean(location?.is_oa))),
      abstract: indexedAbstract(work?.abstract_inverted_index),
      workType: work?.type === "article" ? "journal_article" : work?.type === "book" ? "book" : work?.type === "book-chapter" ? "chapter" : work?.type === "dissertation" ? "thesis" : "other",
      fullTextUrls: openLocationUrls,
    };
  }).filter((item: ScholarlyHit | null): item is ScholarlyHit => Boolean(item));
}


export function semanticScholarHasApiKey() {
  return Boolean(String(process.env.SEMANTIC_SCHOLAR_API_KEY || "").trim());
}

async function searchSemanticScholar(query: string, limit: number): Promise<ScholarlyHit[]> {
  const key = String(process.env.SEMANTIC_SCHOLAR_API_KEY || "").trim();
  const url = new URL("https://api.semanticscholar.org/graph/v1/paper/search");
  url.searchParams.set("query", query.replace(/-/g, " "));
  url.searchParams.set("limit", String(Math.max(1, Math.min(12, limit))));
  url.searchParams.set(
    "fields",
    "title,authors,year,venue,url,externalIds,openAccessPdf,abstract"
  );
  const response = await fetch(url, {
    headers: {
      "User-Agent": "RuangBelajar/1.0 (scholarly search)",
      ...(key ? { "x-api-key": key } : {}),
    },
    signal: AbortSignal.timeout(7000),
    cache: "no-store",
  });
  if (!response.ok) return [];
  const payload = await response.json().catch(() => null) as any;
  const papers = Array.isArray(payload?.data) ? payload.data : [];
  return papers.map((paper: any): ScholarlyHit | null => {
    const title = cleanText(paper?.title, 1000);
    if (!title) return null;
    const doi = cleanDoi(paper?.externalIds?.DOI);
    const pmid = cleanText(paper?.externalIds?.PubMed, 80) || null;
    const paperId = cleanText(paper?.paperId, 240);
    const paperUrl = cleanText(
      paper?.openAccessPdf?.url ||
      paper?.url ||
      (paperId ? "https://www.semanticscholar.org/paper/" + paperId : ""),
      1500
    );
    if (!/^https?:\/\//i.test(paperUrl)) return null;
    return {
      provider: "semanticscholar",
      id: paperId || doi || pmid || title,
      title,
      authors: (Array.isArray(paper?.authors) ? paper.authors : [])
        .map((author: any) => cleanText(author?.name, 240)).filter(Boolean).slice(0, 30),
      year: Number(paper?.year) || null,
      doi,
      pmid,
      pmcid: null,
      journal: cleanText(paper?.venue, 500) || null,
      uri: paperUrl,
      openAccess: Boolean(paper?.openAccessPdf?.url),
      abstract: cleanText(paper?.abstract, 2200) || null,
      fullTextUrls: paper?.openAccessPdf?.url ? [paper.openAccessPdf.url] : [],
    };
  }).filter((item: ScholarlyHit | null): item is ScholarlyHit => Boolean(item));
}

async function searchEuropePmc(query: string, limit: number): Promise<ScholarlyHit[]> {
  const url = new URL("https://www.ebi.ac.uk/europepmc/webservices/rest/search");
  url.searchParams.set("query", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("resultType", "core");
  url.searchParams.set("pageSize", String(Math.max(1, Math.min(15, limit))));
  url.searchParams.set("synonym", "true");
  const response = await fetch(url, {
    headers: { "User-Agent": "RuangBelajar/1.0 (scholarly search)" },
    signal: AbortSignal.timeout(7000),
    cache: "no-store",
  });
  if (!response.ok) return [];
  const payload = await response.json().catch(() => null) as any;
  const results = Array.isArray(payload?.resultList?.result) ? payload.resultList.result : [];
  return results.map((item: any): ScholarlyHit | null => {
    const title = cleanText(item?.title, 1000);
    if (!title) return null;
    const doi = cleanDoi(item?.doi);
    const pmid = cleanText(item?.pmid, 80) || null;
    const pmcid = cleanText(item?.pmcid, 80) || null;
    const fullUrls = Array.isArray(item?.fullTextUrlList?.fullTextUrl)
      ? item.fullTextUrlList.fullTextUrl : [];
    const oaUrl = fullUrls.find((u: any) => /pdf/i.test(String(u?.documentStyle || "")))?.url
      || fullUrls[0]?.url;
    const uri = cleanText(
      oaUrl ||
      (pmcid ? "https://europepmc.org/articles/" + pmcid :
        pmid ? "https://europepmc.org/article/MED/" + pmid :
        doi ? "https://doi.org/" + doi : ""),
      1500
    );
    if (!/^https?:\/\//i.test(uri)) return null;
    return {
      provider: "europepmc",
      workType: item?.source === "PPR" ? "other" : "journal_article",
      id: pmcid || pmid || doi || title,
      title,
      authors: cleanText(item?.authorString, 1800)
        .split(/,|;|\band\b/i).map((value) => value.trim()).filter(Boolean).slice(0, 30),
      year: Number(item?.pubYear) || yearFrom(item?.firstPublicationDate),
      doi,
      pmid,
      pmcid,
      journal: cleanText(item?.journalTitle || item?.journalInfo?.journal?.title, 500) || null,
      uri,
      openAccess: String(item?.isOpenAccess || "").toUpperCase() === "Y",
      abstract: cleanText(item?.abstractText, 2200) || null,
      fullTextUrls: fullUrls.filter((u:any)=>String(u?.availability||"").toLowerCase()==="open access").map((u:any)=>u.url).filter((u:unknown)=>typeof u==="string"&&/^https?:\/\//i.test(u)),
      volume:cleanText(item?.journalInfo?.volume)||null,issue:cleanText(item?.journalInfo?.issue)||null,pages:cleanText(item?.pageInfo)||null,
    };
  }).filter((item: ScholarlyHit | null): item is ScholarlyHit => Boolean(item));
}

async function searchPubMed(query: string, limit: number): Promise<ScholarlyHit[]> {
  const key = String(process.env.NCBI_API_KEY || "").trim();
  const email = String(process.env.NCBI_EMAIL || "").trim();
  const common = new URLSearchParams({
    db: "pubmed",
    retmode: "json",
    tool: "RuangBelajar",
  });
  if (key) common.set("api_key", key);
  if (email) common.set("email", email);

  const searchUrl = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi");
  for (const [k, v] of common) searchUrl.searchParams.set(k, v);
  searchUrl.searchParams.set("term", query);
  searchUrl.searchParams.set("retmax", String(Math.max(1, Math.min(12, limit))));
  searchUrl.searchParams.set("sort", "relevance");

  const searchResponse = await fetch(searchUrl, {
    headers: { "User-Agent": "RuangBelajar/1.0 (scholarly search)" },
    signal: AbortSignal.timeout(7000),
    cache: "no-store",
  });
  if (!searchResponse.ok) return [];
  const searchPayload = await searchResponse.json().catch(() => null) as any;
  const ids = Array.isArray(searchPayload?.esearchresult?.idlist)
    ? searchPayload.esearchresult.idlist.map(String).filter(Boolean) : [];
  if (!ids.length) return [];

  const summaryUrl = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi");
  for (const [k, v] of common) summaryUrl.searchParams.set(k, v);
  summaryUrl.searchParams.set("id", ids.join(","));
  const summaryResponse = await fetch(summaryUrl, {
    headers: { "User-Agent": "RuangBelajar/1.0 (scholarly search)" },
    signal: AbortSignal.timeout(7000),
    cache: "no-store",
  });
  if (!summaryResponse.ok) return [];
  const summary = await summaryResponse.json().catch(() => null) as any;
  const result = summary?.result || {};

  return ids.map((id: string): ScholarlyHit | null => {
    const item = result?.[id];
    const title = cleanText(item?.title, 1000);
    if (!title) return null;
    const articleIds = Array.isArray(item?.articleids) ? item.articleids : [];
    const doi = cleanDoi(articleIds.find((x: any) => x?.idtype === "doi")?.value);
    const pmcid = cleanText(articleIds.find((x: any) => x?.idtype === "pmc")?.value, 80) || null;
    return {
      provider: "pubmed",
      workType: "journal_article",
      id,
      title,
      authors: (Array.isArray(item?.authors) ? item.authors : [])
        .map((author: any) => cleanText(author?.name, 240)).filter(Boolean).slice(0, 30),
      year: yearFrom(item?.pubdate),
      doi,
      pmid: id,
      pmcid,
      journal: cleanText(item?.fulljournalname || item?.source, 500) || null,
      uri: "https://pubmed.ncbi.nlm.nih.gov/" + id + "/",
      openAccess: false,
    };
  }).filter((item: ScholarlyHit | null): item is ScholarlyHit => Boolean(item));
}

export async function searchCrossref(query: string, limit = 12): Promise<ScholarlyHit[]> {
  const exactDoi=/\b10\.\d{4,9}\/[^\s]+/i.exec(query)?.[0]?.replace(/[.,;)]+$/g,"");
  const url = new URL("https://api.crossref.org/works"+(exactDoi?"/"+encodeURIComponent(exactDoi):""));
  if(!exactDoi){url.searchParams.set("query.bibliographic", query);url.searchParams.set("rows", String(Math.min(20,limit)));}
  const payload:any=await boundedJson(url.href,{headers:{Accept:"application/json","User-Agent":"RuangBelajar/1.0 (public scholarly research)"},cache:"no-store"});
  return (exactDoi&&payload?.message?.DOI?[payload.message]:Array.isArray(payload?.message?.items)?payload.message.items:[]).map((item:any):ScholarlyHit|null=>{
    const title=cleanText(item.title?.[0],1000),doi=cleanDoi(item.DOI);
    if(!title||!doi)return null;
    if(!["journal-article","proceedings-article","posted-content","book","monograph","book-chapter","report","dissertation"].includes(item.type))return null;
    const uri=cleanText(item.resource?.primary?.URL||item.URL||"https://doi.org/"+doi,1800);
    if(!/^https?:\/\//i.test(uri))return null;
    return {provider:"crossref",id:doi,title,doi,authors:(item.author||[]).map((a:any)=>cleanText([a.given,a.family].filter(Boolean).join(" "),240)).filter(Boolean),year:item.published?.["date-parts"]?.[0]?.[0]||null,journal:cleanText(item["container-title"]?.[0],500)||null,pmid:null,pmcid:null,uri,openAccess:false,abstract:cleanText(String(item.abstract||"").replace(/<[^>]+>/g," "),2200)||null,
      fullTextUrls:(item.link||[]).filter((link:any)=>link["content-type"]==="application/pdf").map((link:any)=>link.URL),volume:cleanText(item.volume)||null,issue:cleanText(item.issue)||null,pages:cleanText(item.page)||null,workType:item.type==="journal-article"?"journal_article":item.type==="book"?"book":item.type==="book-chapter"?"chapter":"other"};
  }).filter((hit:ScholarlyHit|null):hit is ScholarlyHit=>Boolean(hit));
}

export async function searchScholarlySources(query: string, limit = 12, expandConnections=false) {
  const plan=scientificQueryPlan(cleanText(query,1200));
  const clean = plan.query;
  if (!clean) return [] as ScholarlyHit[];
  const exactIdentifier=/^10\.\d{4,9}\//i.test(clean);
  const biomedical = isBiomedicalQuery(clean) || /\b(psychology|memory|memori|retrieval practice|testing effect|capsicum|medicinal plant|natural products|pharmacognosy)\b/i.test(clean);
  const jobs: Array<Promise<ScholarlyHit[]>> = [];
  if(!exactIdentifier){
    jobs.push(searchOpenAlex(clean, Math.min(8, limit)));
    jobs.push(searchSemanticScholar(clean, Math.min(8, limit)));
    // Formulation searches often describe release behavior or manufacturing in the
    // abstract rather than the title. Run the deterministic broad fallback through
    // the discovery indexes too, not only Crossref, so full-text OA locations can surface.
    if(plan.broadQuery!==clean){
      jobs.push(searchOpenAlex(plan.broadQuery, Math.min(6, limit)));
      jobs.push(searchSemanticScholar(plan.broadQuery, Math.min(6, limit)));
    }
  }
  jobs.push(searchCrossref(clean, 16));
  if(plan.broadQuery!==clean)jobs.push(searchCrossref(plan.broadQuery,8));
  jobs.push(searchScopus(clean,8));
  if(exactIdentifier)jobs.push(searchEuropePmc("DOI:"+clean,1));
  if (biomedical) {
    jobs.push(searchEuropePmc(clean, Math.min(8, limit)));
    jobs.push(searchEuropePmc(`(${clean}) AND OPEN_ACCESS:Y`, Math.min(8,limit)));
    jobs.push(searchPubMed(clean, Math.min(6, limit)));
    if(plan.broadQuery!==clean){
      jobs.push(searchEuropePmc(plan.broadQuery,Math.min(8,limit)));
      jobs.push(searchPubMed(plan.broadQuery,Math.min(6,limit)));
    }
  }
  if (!jobs.length) return [] as ScholarlyHit[];

  const settled = await Promise.allSettled(jobs);
  const merged = new Map<string, ScholarlyHit>();
  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    for (const hit of result.value) {
      const key = stableKey(hit);
      const existing = merged.get(key);
      hit.indexedIn=[...new Set([...(hit.indexedIn||[]),...(existing?.indexedIn||[])])];
      if(existing?.workType&&!hit.workType)hit.workType=existing.workType;
      if(existing){existing.pmcid ||= hit.pmcid;existing.pmid ||= hit.pmid;existing.indexedIn=hit.indexedIn;hit.pmcid ||= existing.pmcid;hit.pmid ||= existing.pmid;}
      if(existing&&hit.provider==="scopus"){merged.set(key,{...existing,indexedIn:hit.indexedIn});continue;}
      if (!existing || (hit.abstract && !existing.abstract) || (hit.openAccess && !existing.openAccess)) {
        merged.set(key, { ...existing, ...hit, abstract: hit.abstract || existing?.abstract || null, fullTextUrls:[...new Set([...(hit.fullTextUrls||[]),...(existing?.fullTextUrls||[])])],volume:hit.volume||existing?.volume,issue:hit.issue||existing?.issue,pages:hit.pages||existing?.pages });
      } else {
        merged.set(key,{...hit,...existing,fullTextUrls:[...new Set([...(hit.fullTextUrls||[]),...(existing.fullTextUrls||[])])],volume:existing.volume||hit.volume,issue:existing.issue||hit.issue,pages:existing.pages||hit.pages});
      }
    }
  }
  const exactDoi=/\b10\.\d{4,9}\/[^\s]+/i.exec(clean)?.[0]?.replace(/[.,;)]+$/g,"").toLowerCase();
  if(exactDoi)return [...merged.values()].filter(hit=>hit.doi?.toLowerCase()===exactDoi).slice(0,1);
  let ranked=rankResearchHits([...merged.values()].filter(hit=>withinResearchScope(hit,query)),clean,query);
  // One public seed, four resolved DOI neighbors at most. A citation edge is
  // discovery only: resolve identity and reapply the original scope afterwards.
  if(expandConnections&&ranked[0]?.doi){
    try{
      const connections=await paperConnections(ranked[0].doi);
      const missing=connections.edges.filter(edge=>![...merged.values()].some(hit=>hit.doi?.toLowerCase()===edge.doi.toLowerCase())).slice(0,4);
      const resolved=await Promise.allSettled(missing.map(edge=>searchCrossref(edge.doi,1)));
      for(const result of resolved)if(result.status==="fulfilled")for(const hit of result.value)if(withinResearchScope(hit,query))merged.set(stableKey(hit),hit);
      ranked=rankResearchHits([...merged.values()].filter(hit=>withinResearchScope(hit,query)),clean,query);
    }catch{/* Existing providers remain usable when OpenCitations fails. */}
  }
  return ranked.slice(0, Math.max(1, Math.min(20, limit)));
}

export function scholarlyPromptContext(hits: ScholarlyHit[]) {
  if (!hits.length) return "";
  const rows = hits.map((hit, index) => [
    (index + 1) + ". " + hit.title,
    hit.authors.length ? "authors=" + hit.authors.slice(0, 8).join("; ") : "",
    hit.year ? (hit.publicationVersionConflict?"catalog_year_disputed="+hit.year:"year="+hit.year) : "",
    hit.journal ? "journal=" + hit.journal : "",
    hit.doi ? "doi=" + hit.doi : "",
    hit.pmid ? "pmid=" + hit.pmid : "",
    "provider=" + hit.provider,
    hit.indexedIn?.length ? "index_record=" + hit.indexedIn.join(",") + " (not claim validation or automatic full-text access)" : "",
    hit.metadataNotice ? "metadata_notice=" + cleanText(hit.metadataNotice, 600) : "",
    hit.publicationVersionConflict ? "formal_citation=blocked (edition unresolved; link is a research lead only, not evidence for findings or a verified publication year)" : "",
    "url=" + hit.uri,
    hit.openAccess ? "open_access=yes" : "open_access=unknown/no",
    hit.abstract ? "abstract=" + cleanText(hit.abstract, 2200) : "",
  ].filter(Boolean).join(" | "));
  return "\n\nSCHOLARLY INDEX TERSTRUKTUR (metadata publik; verifikasi isi klaim melalui halaman sumber sebelum mengutip):\n" +
    rows.join("\n") +
    "\nGunakan daftar ini untuk menemukan sumber ilmiah yang benar-benar relevan. Jangan menganggap metadata/abstract sebagai bukti untuk klaim yang tidak terlihat pada sumber.";
}

export function scholarlyWebSources(hits: ScholarlyHit[]) {
  return hits.map((hit) => ({ title: hit.title, uri: hit.uri }));
}

export function mergeWebSources(
  providerSources: Array<{ title: string; uri: string }> | undefined,
  scholarly: ScholarlyHit[]
) {
  const seen = new Set<string>();
  const result: Array<{ title: string; uri: string }> = [];
  const titleKey=(title:string)=>title.replace(/\s*[—–]\s*dibaca:.*$/i,"").replace(/<[^>]*>/g,"").toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim();
  const identities=new Map<string,Set<string>>();
  const uriIdentities=new Map<string,string>();
  for(const hit of scholarly){
    const identity=stableKey(hit),key=titleKey(hit.title),matches=identities.get(key)||new Set<string>();
    matches.add(identity);identities.set(key,matches);
    for(const uri of [hit.uri,...(hit.fullTextUrls||[])])uriIdentities.set(uri.replace(/\/$/,""),identity);
  }
  for (const item of [...(providerSources || []), ...scholarlyWebSources(scholarly)]) {
    const uri = cleanText(item?.uri, 1800);
    const title = cleanText(item?.title, 1000);
    if (!uri || !title || !/^https?:\/\//i.test(uri)) continue;
    const matches=identities.get(titleKey(title));
    // Exact unique catalog title can link the actual PDF/XML read to its DOI.
    // Same title with conflicting DOIs stays separate; never invent identity.
    const key = uriIdentities.get(uri.replace(/\/$/,"")) || (matches?.size===1?[...matches][0]:"uri:"+uri.replace(/\/$/, ""));
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ title, uri });
  }
  return result.slice(0, 30);
}

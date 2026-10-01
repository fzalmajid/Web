import { normalizeDoi } from "./referenceMetadata";
import { publicUrl } from "./researchLinks";
export { publicUrl, doiFromUrl } from "./researchLinks";

// Fixed upstreams only. Never use this helper as a user-supplied URL proxy.
export async function boundedJson(url: string, options: RequestInit = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(7000) });
  if (!response.ok) throw new Error("Layanan publik sementara tidak tersedia (" + response.status + ").");
  if (Number(response.headers.get("content-length") || 0) > 2_000_000) throw new Error("Respons layanan terlalu besar.");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Respons kosong.");
  const parts: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.length;
      if (size > 2_000_000) throw new Error("Respons layanan terlalu besar.");
      parts.push(next.value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  return JSON.parse(Buffer.concat(parts).toString("utf8"));
}

export function mapOaLocation(location: any) {
  return {
    pdf: publicUrl(location?.url_for_pdf || location?.pdf_url),
    landing: publicUrl(location?.url_for_landing_page || location?.landing_page_url),
    license: String(location?.license || "Tidak tercantum").slice(0, 120),
    version: String(location?.version || "").slice(0, 100),
  };
}

export async function findOpenPaper(doi: string) {
  let warning = "";
  const email = String(process.env.UNPAYWALL_EMAIL || "").trim();
  if (email) {
    try {
      const data = await boundedJson("https://api.unpaywall.org/v2/" + encodeURIComponent(doi) + "?email=" + encodeURIComponent(email), { next: { revalidate: 86400 } });
      const location = mapOaLocation(data.best_oa_location);
      if (location.pdf || location.landing) return { doi, title: String(data.title || doi), provider: "unpaywall", ...location, warning };
    } catch { warning = "Unpaywall tidak merespons; sumber open-access lain digunakan."; }
  } else { warning = "Kontak Unpaywall belum dikonfigurasi; memakai fallback OpenAlex."; }
  try {
    const url = new URL("https://api.openalex.org/works/https://doi.org/" + doi);
    if (process.env.OPENALEX_API_KEY) url.searchParams.set("api_key", process.env.OPENALEX_API_KEY);
    const data = await boundedJson(url.href, { next: { revalidate: 86400 } });
    return { doi, title: String(data.display_name || doi), provider: "openalex", ...mapOaLocation(data.best_oa_location), warning };
  } catch {
    return { doi, title: doi, provider: "doi", pdf: null, landing: "https://doi.org/" + doi, license: "Tidak tercantum", version: "", warning: warning + " PDF legal belum ditemukan; tautan penerbit tetap tersedia." };
  }
}

export function mapCitationEdges(rows: any[], direction: "references" | "citations", center: string) {
  const unique = new Map<string, { doi: string; url: string; direction: string; year: string }>();
  for (const row of Array.isArray(rows) ? rows : []) {
    const identifiers = String(direction === "references" ? row.cited : row.citing);
    const match = identifiers.match(/\bdoi:(10\.\d{4,9}\/[^\s;]+)/i);
    const doi = match ? normalizeDoi(match[1]) : "";
    if (doi && doi !== center && !unique.has(doi)) unique.set(doi, { doi, url: "https://doi.org/" + doi, direction, year: String(row.creation || "").slice(0, 10) });
    if (unique.size >= 30) break;
  }
  return [...unique.values()];
}

export async function paperConnections(doi: string) {
  const directions = ["references", "citations"] as const;
  const settled = await Promise.allSettled(directions.map(async direction => {
    const data = await boundedJson("https://api.opencitations.net/index/v2/" + direction + "/" + encodeURIComponent("doi:" + doi), {
      headers: process.env.OPENCITATIONS_TOKEN ? { authorization: process.env.OPENCITATIONS_TOKEN } : {}, next: { revalidate: 86400 },
    });
    return mapCitationEdges(data, direction, doi);
  }));
  return {
    edges: settled.flatMap(item => item.status === "fulfilled" ? item.value : []),
    partial: settled.some(item => item.status === "rejected"),
    limitPerDirection: 30,
  };
}

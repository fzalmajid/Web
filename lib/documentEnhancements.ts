import type { PdfIndexedPage } from "./pdfIndex";
import type { ReferenceMetadata } from "./referenceMetadata";

function configured(feature: string) {
  return process.env[feature] === "true" && Boolean(process.env.DOCUMENT_WORKER_URL && process.env.DOCUMENT_WORKER_TOKEN);
}
export function documentEnhancementStatus() {
  return {
    docling: { configured: configured("ENABLE_DOCLING"), fallback: "existing PDF/OCR", sameRagIndex: true },
    grobid: { configured: configured("ENABLE_GROBID"), fallback: "existing reference parser/catalogs", preservesManual: true },
    flashRank: { configured: configured("ENABLE_FLASHRANK"), fallback: "existing hybrid ranking", sameRagIndex: true },
    requiresHosting: "authenticated document worker; not hosted by this deployment",
  };
}
async function workerRequest(path: string, body: object, maxMs = 6000) {
  const base = new URL(String(process.env.DOCUMENT_WORKER_URL));
  if (!["https:", "http:"].includes(base.protocol) || base.username || base.password) throw new Error("Worker URL tidak valid.");
  const response = await fetch(new URL(path, base), {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + process.env.DOCUMENT_WORKER_TOKEN },
    body: JSON.stringify(body), signal: AbortSignal.timeout(maxMs), cache: "no-store", redirect: "error",
  });
  if (!response.ok) throw new Error("Worker tidak tersedia.");
  const reader=response.body?.getReader();if(!reader)throw new Error("Respons kosong.");const parts:Uint8Array[]=[];let size=0;try{while(true){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>1_500_000)throw new Error("Respons worker terlalu besar.");parts.push(next.value);}}finally{await reader.cancel().catch(()=>undefined);}return JSON.parse(Buffer.concat(parts).toString("utf8"));
}

export function mergeStructuredPages(original: PdfIndexedPage[], candidate: any): PdfIndexedPage[] {
  if (!Array.isArray(candidate)) return original;
  const mapped = new Map<number, string>();
  for (const row of candidate) {
    if (!Number.isInteger(row?.page) || mapped.has(row.page) || typeof row.text !== "string" || row.text.length > 160000) return original;
    mapped.set(row.page, row.text.trim());
  }
  // All expected pages must be present. A partial worker response cannot silently
  // replace a complete native/OCR batch or change its page identity.
  if (mapped.size !== original.length || original.some(row => !mapped.has(row.page))) return original;
  return original.map(row => {
    const text = mapped.get(row.page)!;
    return text.length >= Math.max(40, row.text.length * 0.55) ? { ...row, text } : row;
  });
}
export async function enhancePdfPages(buffer: Buffer, original: PdfIndexedPage[]) {
  if (!configured("ENABLE_DOCLING") || !original.length) return original;
  try {
    const { PDFDocument } = await import("pdf-lib");
    const source = await PDFDocument.load(buffer), excerpt = await PDFDocument.create();
    const copied = await excerpt.copyPages(source, original.map(row => row.page - 1));
    copied.forEach(page => excerpt.addPage(page));
    const bytes = await excerpt.save();
    if (bytes.length > 8_000_000) return original;
    const result = await workerRequest("/docling", { pdf: Buffer.from(bytes).toString("base64"), pages: original.map(row => row.page) }, 18000);
    return mergeStructuredPages(original, result.pages);
  } catch { return original; }
}

export function validatedRanking<T extends { id: string }>(rows: T[], ids: unknown): T[] {
  if (!Array.isArray(ids) || ids.length !== rows.length || new Set(ids).size !== rows.length) return rows;
  const lookup = new Map(rows.map(row => [row.id, row]));
  if (ids.some(id => typeof id !== "string" || !lookup.has(id))) return rows;
  return ids.map(id => lookup.get(id)!);
}
export async function rerankKnowledge<T extends { id: string; raw_content?: string | null; content?: string }>(rows: T[], query: string) {
  if (!configured("ENABLE_FLASHRANK") || rows.length < 3) return rows;
  try {
    const candidates = rows.slice(0, 24);
    const result = await workerRequest("/rerank", { query: query.slice(0, 2000), documents: candidates.map(row => ({ id: row.id, text: String(row.raw_content || row.content || "").slice(0, 4500) })) });
    // Preserve the leading exact/curated evidence. Ranking changes order only:
    // no fabricated IDs, missing sources, content replacement, or scope expansion.
    const ranked = validatedRanking(candidates, result.ids);
    return [rows[0], ...ranked.filter(row => row.id !== rows[0].id), ...rows.slice(24)];
  } catch { return rows; }
}

export async function grobidMetadata(buffer: Buffer): Promise<ReferenceMetadata | null> {
  if (!configured("ENABLE_GROBID") || buffer.length > 12_000_000) return null;
  try {
    const result = await workerRequest("/grobid", { pdf: buffer.toString("base64") }, 12000);
    const input = result.metadata || {}, metadata: ReferenceMetadata = {};
    if (typeof input.title === "string") metadata.title = input.title.slice(0, 1000);
    if (Array.isArray(input.authors)) metadata.authors = input.authors.filter((v: unknown) => typeof v === "string").map((v: string) => v.slice(0, 240)).slice(0, 30);
    if (typeof input.doi === "string") metadata.doi = input.doi.slice(0, 240);
    if (Number.isInteger(input.year) && input.year >= 1000 && input.year <= 2200) metadata.year = input.year;
    metadata.provenance = Object.fromEntries(Object.keys(metadata).map(field => [field, { source: "document", confidence: 0.7, note: "GROBID extraction; must be verified by existing reference pipeline." }]));
    return metadata;
  } catch { return null; }
}

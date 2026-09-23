import { PDFDocument } from "pdf-lib";
import { assertPdfFile } from "./pdfValidation";

/** Free-tier Storage permits 50 MiB per object, not per document. */
export const STORAGE_OBJECT_LIMIT = 50 * 1024 * 1024;
export const MAX_LARGE_FILE_BYTES = 200 * 1024 * 1024;
export const MAX_LARGE_PDF_BYTES = MAX_LARGE_FILE_BYTES;
export const PDF_STORAGE_PART_BYTES = 40 * 1024 * 1024;
export const PDF_OCR_PART_BYTES = 38 * 1024 * 1024;
export const LARGE_PDF_MANIFEST_KIND = "rb-chunked-pdf-v1";
export const LARGE_FILE_MANIFEST_KIND = "rb-chunked-file-v1";

export type LargePdfManifest = {
  kind: typeof LARGE_PDF_MANIFEST_KIND;
  name: string;
  mimeType: "application/pdf";
  totalBytes: number;
  parts: Array<{ path: string; bytes: number }>;
};

export type LargeFileManifest = {
  kind: typeof LARGE_FILE_MANIFEST_KIND;
  name: string;
  mimeType: string;
  totalBytes: number;
  parts: Array<{ path: string; bytes: number }>;
};

export type ChunkedFileManifest = LargePdfManifest | LargeFileManifest;

export function isLargeSupportedFile(file: File) {
  const mime = String(file.type || "").toLowerCase();
  const name = file.name.toLowerCase();
  return file.size > STORAGE_OBJECT_LIMIT && file.size <= MAX_LARGE_FILE_BYTES && (
    mime === "application/pdf" || name.endsWith(".pdf") ||
    mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation" || name.endsWith(".pptx") ||
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || name.endsWith(".docx") ||
    mime === "image/png" || mime === "image/jpeg" || mime === "image/webp" ||
    name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".webp")
  );
}

export function isLargePdf(file: File) {
  return file.size > STORAGE_OBJECT_LIMIT &&
    (file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf");
}

export function checkLargePdf(file: File) {
  if (!isLargePdf(file)) return;
  if (file.size > MAX_LARGE_PDF_BYTES) {
    throw new Error(
      "PDF melebihi 200 MB. Batas satu dokumen saat ini 200 MB; " +
      "untuk dokumen lebih besar, bagi menjadi beberapa PDF terlebih dahulu."
    );
  }
}

export type PdfOcrPart = {
  bytes: Uint8Array;
  startPage: number;
  endPage: number;
  totalPages: number;
};

/**
 * Split a PDF into fully independent, valid page-range PDFs for OCR only.
 * Original bytes are stored separately in Storage parts and never rewritten.
 * Emits one small PDF at a time to avoid holding multiple generated parts in RAM.
 */
export async function* pdfOcrParts(
  file: File,
  onStatus?: (label: string) => void
): AsyncGenerator<PdfOcrPart> {
  checkLargePdf(file);
  await assertPdfFile(file);
  const input = new Uint8Array(await file.arrayBuffer());
  let source: PDFDocument;
  try {
    source = await PDFDocument.load(input, { updateMetadata: false });
  } catch {
    throw new Error(
      "Header PDF ditemukan, tetapi struktur halaman tidak bisa diproses. " +
      "PDF mungkin rusak, dienkripsi, menggunakan struktur yang tidak kompatibel, atau terpotong. " +
      "Coba ekspor ulang menjadi PDF standar yang tidak dikunci."
    );
  }

  const totalPages = source.getPageCount();
  if (totalPages < 1) throw new Error("PDF tidak memiliki halaman.");
  const targetSegments = Math.max(1, Math.ceil(file.size / (PDF_OCR_PART_BYTES * 0.8)));
  const initialPages = Math.max(1, Math.ceil(totalPages / targetSegments));

  async function* renderRange(start: number, end: number): AsyncGenerator<PdfOcrPart> {
    onStatus?.("Menyiapkan OCR halaman " + (start + 1) + "–" + end + " dari " + totalPages + "...");
    const segment = await PDFDocument.create();
    const indices = Array.from({ length: end - start }, (_, i) => start + i);
    const copied = await segment.copyPages(source, indices);
    for (const page of copied) segment.addPage(page);
    const bytes = await segment.save({ useObjectStreams: true });

    if (bytes.length > PDF_OCR_PART_BYTES) {
      if (end - start === 1) {
        throw new Error(
          "Halaman " + (start + 1) + " menghasilkan PDF di atas 38 MB. " +
          "Halaman ini perlu dikompres terlebih dahulu."
        );
      }
      const middle = start + Math.floor((end - start) / 2);
      yield* renderRange(start, middle);
      yield* renderRange(middle, end);
    } else {
      yield { bytes, startPage: start + 1, endPage: end, totalPages };
    }
  }

  for (let start = 0; start < totalPages; start += initialPages) {
    yield* renderRange(start, Math.min(totalPages, start + initialPages));
  }
}

function validChunkParts(raw: Record<string, unknown>, maxParts = 5) {
  if (!Array.isArray(raw.parts) || raw.parts.length < 2 || raw.parts.length > maxParts) return false;
  const parts = raw.parts as Array<{ path?: unknown; bytes?: unknown }>;
  if (!parts.every(part =>
    part && typeof part.path === "string" && part.path.length > 0 &&
    typeof part.bytes === "number" && Number.isInteger(part.bytes) &&
    part.bytes > 0 && part.bytes <= PDF_STORAGE_PART_BYTES
  )) return false;
  return parts.reduce((sum, part) => sum + Number(part.bytes), 0) === raw.totalBytes;
}

export function parseLargePdfManifest(value: unknown): LargePdfManifest | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.kind !== LARGE_PDF_MANIFEST_KIND ||
      raw.mimeType !== "application/pdf" ||
      typeof raw.totalBytes !== "number" ||
      !Number.isFinite(raw.totalBytes) ||
      raw.totalBytes <= STORAGE_OBJECT_LIMIT ||
      raw.totalBytes > MAX_LARGE_PDF_BYTES ||
      !validChunkParts(raw, Math.ceil(MAX_LARGE_PDF_BYTES / PDF_STORAGE_PART_BYTES))) return null;
  return raw as LargePdfManifest;
}

export function parseChunkedFileManifest(value: unknown): ChunkedFileManifest | null {
  const pdf = parseLargePdfManifest(value);
  if (pdf) return pdf;
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.kind !== LARGE_FILE_MANIFEST_KIND ||
      typeof raw.name !== "string" || !raw.name ||
      typeof raw.mimeType !== "string" || !raw.mimeType ||
      typeof raw.totalBytes !== "number" ||
      !Number.isFinite(raw.totalBytes) ||
      raw.totalBytes <= STORAGE_OBJECT_LIMIT ||
      raw.totalBytes > MAX_LARGE_FILE_BYTES ||
      !validChunkParts(raw, Math.ceil(MAX_LARGE_FILE_BYTES / PDF_STORAGE_PART_BYTES))) return null;
  return raw as LargeFileManifest;
}

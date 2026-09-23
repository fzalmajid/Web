import { PDFDocument } from "pdf-lib";

/** Free-tier Storage permits 50 MiB per object, not per document. */
export const STORAGE_OBJECT_LIMIT = 50 * 1024 * 1024;
export const MAX_LARGE_PDF_BYTES = 200 * 1024 * 1024;
export const PDF_STORAGE_PART_BYTES = 40 * 1024 * 1024;
export const PDF_OCR_PART_BYTES = 38 * 1024 * 1024;
export const LARGE_PDF_MANIFEST_KIND = "rb-chunked-pdf-v1";

export type LargePdfManifest = {
  kind: typeof LARGE_PDF_MANIFEST_KIND;
  name: string;
  mimeType: "application/pdf";
  totalBytes: number;
  parts: Array<{ path: string; bytes: number }>;
};

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
  const input = new Uint8Array(await file.arrayBuffer());
  let source: PDFDocument;
  try {
    source = await PDFDocument.load(input, { updateMetadata: false });
  } catch {
    throw new Error(
      "PDF tidak dapat dibagi untuk OCR. Pastikan dokumen tidak dikunci, " +
      "rusak, atau dilindungi kata sandi."
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

export function parseLargePdfManifest(value: unknown): LargePdfManifest | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.kind !== LARGE_PDF_MANIFEST_KIND ||
      raw.mimeType !== "application/pdf" ||
      typeof raw.totalBytes !== "number" ||
      !Number.isFinite(raw.totalBytes) ||
      raw.totalBytes <= STORAGE_OBJECT_LIMIT ||
      raw.totalBytes > MAX_LARGE_PDF_BYTES ||
      !Array.isArray(raw.parts) ||
      raw.parts.length < 2 ||
      raw.parts.length > 5) return null;
  const parts = raw.parts as Array<{ path?: unknown; bytes?: unknown }>;
  const allPartsValid = parts.every(part =>
    part && typeof part.path === "string" && part.path.length > 0 &&
    typeof part.bytes === "number" && Number.isInteger(part.bytes) &&
    part.bytes > 0 && part.bytes <= PDF_STORAGE_PART_BYTES
  );
  if (!allPartsValid) return null;
  if (parts.reduce((sum, part) => sum + Number(part.bytes), 0) !== raw.totalBytes) return null;
  return raw as LargePdfManifest;
}

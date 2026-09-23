import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { geminiGenerateDetailed } from "./gemini";
import { modelPlanForSelection, selectionFromHeaders } from "./aiModels";
import { geminiUserAuthFromHeaders } from "./geminiUserAuth";
import { normalizeAiMode } from "./aiQuota";
import { extractPdfPageBatch, type PdfIndexedPage } from "./pdfIndex";

export type VisualOcrOptions = {
  selection: ReturnType<typeof selectionFromHeaders>;
  aiMode: ReturnType<typeof normalizeAiMode>;
  auth: ReturnType<typeof geminiUserAuthFromHeaders>;
  onUsage?: (
    usage: Awaited<ReturnType<typeof geminiGenerateDetailed>>["usage"],
    model: string
  ) => Promise<void>;
};

type VisualImage = { label: string; mimeType: string; data: string; name: string };

const MAX_OFFICE_IMAGES = 48;
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
export const PDF_PAGES_PER_BATCH = 8;

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCharCode(parseInt(code, 16)));
}

function supportedImageMime(name: string) {
  const ext = name.toLowerCase().split(".").pop() || "";
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    bmp: "image/bmp",
    tif: "image/tiff",
    tiff: "image/tiff",
  };
  return map[ext] || "";
}

async function readImage(
  zip: JSZip,
  path: string,
  label: string
): Promise<VisualImage> {
  const file = zip.file(path);
  if (!file) throw new Error("Gambar " + label + " tidak ditemukan di dokumen.");
  const bytes = await file.async("uint8array");
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new Error(label + " berukuran lebih dari 16 MB. Perkecil gambar lalu upload ulang.");
  }
  return {
    label,
    name: path,
    mimeType: supportedImageMime(path),
    data: Buffer.from(bytes).toString("base64"),
  };
}

async function recognizeImage(image: VisualImage, options: VisualOcrOptions) {
  const result = await geminiGenerateDetailed(
    [
      {
        text:
          "OCR secara literal semua tulisan yang benar-benar tampak pada gambar " +
          image.label +
          ". Pertahankan tabel, rumus, angka, satuan, dan baris sejauh mungkin. " +
          "Jangan meringkas, menerka, atau menambahkan pengetahuan luar. " +
          "Jika tidak ada tulisan yang dapat dibaca, jawab persis [tidak ada teks].",
      },
      { inlineData: { mimeType: image.mimeType, data: image.data } },
    ],
    "Tugas hanya membaca bukti visual secara teliti.",
    {
      models: modelPlanForSelection(options.selection.model, options.aiMode, "standard"),
      effort: options.selection.effort,
      maxOutputTokens: 12288,
      outputBudgetMultiplier: 1,
      apiKey: options.auth.apiKey,
      accessToken: options.auth.accessToken,
      projectId: options.auth.projectId,
    }
  );
  if (options.onUsage) await options.onUsage(result.usage, result.model);
  const text = result.text.trim();
  return text === "[tidak ada teks]" ? "" : text;
}

function slideNumber(name: string) {
  return Number(name.match(/slide(\d+)\.xml/i)?.[1] || 0);
}

/**
 * Read digital Office text AND OCR all referenced raster images.
 * Unlike an "OCR only if no text" fallback, scanned slides in mixed PPTX are included.
 * Never silently discard media above the processing limit.
 */
export async function readOfficeDocument(
  buffer: Buffer,
  kind: "pptx" | "docx",
  digitalText: string,
  options: VisualOcrOptions
) {
  const zip = await JSZip.loadAsync(buffer);
  const seen = new Map<string, Promise<string>>();
  const tasks: Array<{ label: string; name: string }> = [];
  const slides: Array<{ number: number; text: string; images: Array<{ label: string; name: string }> }> = [];
  const wordMedia = Object.keys(zip.files)
    .filter((name) => name.toLowerCase().startsWith("word/media/") && supportedImageMime(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  if (kind === "pptx") {
    const slideFiles = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
      .sort((a, b) => slideNumber(a) - slideNumber(b));
    for (const slidePath of slideFiles) {
      const number = slideNumber(slidePath);
      const xml = (await zip.file(slidePath)?.async("string")) || "";
      const pieces = Array.from(xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/gi))
        .map((part) => decodeXml(part[1]).trim())
        .filter(Boolean);
      const relationPath = "ppt/slides/_rels/slide" + number + ".xml.rels";
      const relsXml = (await zip.file(relationPath)?.async("string")) || "";
      const relationMap = new Map<string, string>();
      for (const relation of relsXml.match(/<Relationship\b[^>]*\/?>/gi) || []) {
        const id = relation.match(/\bId="([^"]+)"/i)?.[1];
        const target = relation.match(/\bTarget="([^"]+)"/i)?.[1];
        const external = /\bTargetMode="External"/i.test(relation);
        if (id && target && !external) relationMap.set(id, "ppt/media/" + target.split("/").pop());
      }
      const imageRefs = Array.from(xml.matchAll(/\br:embed="([^"]+)"/g))
        .map((part) => relationMap.get(part[1]) || "")
        .filter((name) => name && supportedImageMime(name));
      const uniqueImages = Array.from(new Set(imageRefs));
      const images = uniqueImages.map((name, index) => ({
        label: "Slide " + number + " · gambar " + (index + 1),
        name,
      }));
      slides.push({ number, text: pieces.join("\n"), images });
      tasks.push(...images);
    }
    // Preserve media that is not attached to a standard slide relationship, rather than losing it.
    const remaining = Object.keys(zip.files)
      .filter((name) => name.toLowerCase().startsWith("ppt/media/") && supportedImageMime(name))
      .filter((name) => !tasks.some((task) => task.name === name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    tasks.push(...remaining.map((name, index) => ({ label: "Gambar presentasi lain " + (index + 1), name })));
  } else {
    tasks.push(...wordMedia.map((name, index) => ({
      label: "Gambar dokumen " + (index + 1),
      name,
    })));
  }

  if (tasks.length > MAX_OFFICE_IMAGES) {
    throw new Error(
      "Dokumen memuat " + tasks.length + " gambar yang perlu diperiksa. " +
      "Untuk menjaga OCR lengkap tanpa melewatkan gambar, bagi dokumen menjadi beberapa file " +
      "(maksimal " + MAX_OFFICE_IMAGES + " gambar per file)."
    );
  }

  // Two concurrent requests reduce time spent on mixed presentations without saturating API quotas.
  for (let i = 0; i < tasks.length; i += 2) {
    const group = tasks.slice(i, i + 2);
    await Promise.all(group.map(async (task) => {
      if (!seen.has(task.name)) {
        const image = await readImage(zip, task.name, task.label);
        seen.set(task.name, recognizeImage(image, options));
      }
      await seen.get(task.name);
    }));
  }

  if (kind === "docx") {
    const sections = [digitalText.trim()];
    for (const task of tasks) {
      const text = (await seen.get(task.name)) || "";
      if (text) sections.push("[" + task.label + " · OCR]\n" + text);
    }
    return sections.filter(Boolean).join("\n\n");
  }

  const sections: string[] = [];
  for (const slide of slides) {
    const parts = [slide.text];
    for (const image of slide.images) {
      const text = (await seen.get(image.name)) || "";
      if (text) parts.push("[" + image.label + " · OCR]\n" + text);
    }
    sections.push("Slide " + slide.number + ":\n" + (parts.filter(Boolean).join("\n\n") || "[tidak ada teks terbaca]"));
  }
  for (const task of tasks.filter((task) => !slides.some((slide) => slide.images.some((image) => image.name === task.name)))) {
    const text = (await seen.get(task.name)) || "";
    if (text) sections.push("[" + task.label + " · OCR]\n" + text);
  }
  return sections.join("\n\n");
}

export async function readPdfNativeBatch(buffer: Buffer, startPage: number, maxPages = PDF_PAGES_PER_BATCH) {
  const first = Math.max(1, Math.floor(startPage || 1));
  try {
    return await extractPdfPageBatch(buffer, first, {
      maxPages: Math.max(1, Math.min(maxPages, PDF_PAGES_PER_BATCH)),
      maxMs: 26000,
    });
  } catch {
    // Scanned, malformed text layers can fail pdf.js while pdf-lib can still split pages.
    const pdf = await PDFDocument.load(buffer);
    const totalPages = pdf.getPageCount();
    if (first > totalPages) throw new Error("Halaman PDF di luar jangkauan.");
    const last = Math.min(totalPages, first + Math.max(1, Math.min(maxPages, PDF_PAGES_PER_BATCH)) - 1);
    const pages: PdfIndexedPage[] = [];
    for (let page = first; page <= last; page++) pages.push({ page, text: "" });
    return { totalPages, startPage: first, endPage: last, pages, timedOut: last < totalPages };
  }
}

export function pdfPageNeedsOcr(page: PdfIndexedPage) {
  return String(page.text || "").trim().length < 120;
}

export async function readPdfBatchWithOcr(
  buffer: Buffer,
  pages: PdfIndexedPage[],
  options: VisualOcrOptions
): Promise<PdfIndexedPage[]> {
  const needOcr = pages.filter(pdfPageNeedsOcr);
  if (!needOcr.length) return pages;
  const original = await PDFDocument.load(buffer);
  const results = new Map<number, string>();

  // A PDF is split before OCR, so page N can never be omitted because of a long global response.
  for (let index = 0; index < needOcr.length; index += 2) {
    const group = needOcr.slice(index, index + 2);
    await Promise.all(group.map(async (page) => {
      const single = await PDFDocument.create();
      const [copied] = await single.copyPages(original, [page.page - 1]);
      single.addPage(copied);
      const bytes = await single.save();
      if (bytes.length > 18 * 1024 * 1024) {
        throw new Error("Halaman " + page.page + " terlalu besar untuk OCR. Kompres gambar pada PDF.");
      }
      const result = await geminiGenerateDetailed(
        [
          {
            text:
              "OCR hanya halaman " + page.page + " dari PDF ini secara literal. " +
              "Pertahankan semua tulisan, judul, tabel, rumus, dan angka. " +
              "Jangan menambah pengetahuan atau menyimpulkan isi yang tidak terbaca. " +
              "Jika benar-benar kosong, jawab persis [tidak ada teks].",
          },
          { inlineData: { mimeType: "application/pdf", data: Buffer.from(bytes).toString("base64") } },
        ],
        "Transkripsi halaman PDF, bukan ringkasan.",
        {
          models: modelPlanForSelection(options.selection.model, options.aiMode, "standard"),
          effort: options.selection.effort,
          maxOutputTokens: 12288,
          outputBudgetMultiplier: 1,
          apiKey: options.auth.apiKey,
          accessToken: options.auth.accessToken,
          projectId: options.auth.projectId,
        }
      );
      if (options.onUsage) await options.onUsage(result.usage, result.model);
      const recognized = result.text.trim();
      const digital = String(page.text || "").trim();
      const ocr = recognized === "[tidak ada teks]" ? "" : recognized;
      results.set(
        page.page,
        digital && ocr
          ? "[Teks digital]\n" + digital + "\n\n[Teks dari gambar/OCR]\n" + ocr
          : ocr || digital || "[tidak ada teks terbaca]"
      );
    }));
  }
  return pages.map((page) => ({ page: page.page, text: results.get(page.page) ?? page.text }));
}

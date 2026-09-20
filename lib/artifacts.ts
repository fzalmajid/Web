import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import PptxGenJS from "pptxgenjs";

export type ArtifactFormat = "docx" | "pdf" | "pptx" | "txt" | "md" | "csv" | "json";

export type GeneratedArtifact = {
  buffer: Buffer;
  mimeType: string;
  extension: ArtifactFormat;
  fileName: string;
};

const MIME: Record<ArtifactFormat, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  json: "application/json; charset=utf-8",
};

export function detectArtifactFormat(value: string): ArtifactFormat | null {
  const text = String(value || "").toLowerCase();
  const createIntent =
    /\b(buat(?:kan)?|bikin(?:kan)?|jadikan|hasilkan|generate|create|export|konversi|convert|ubah(?:kan)?|simpan\s+sebagai|save\s+as|downloadkan)\b/i.test(text);
  if (!createIntent) return null;

  if (/\b(powerpoint|pptx?|slide\s*deck|presentasi)\b/i.test(text)) return "pptx";
  if (/\b(word|docx?)\b/i.test(text)) return "docx";
  if (/\b(pdf)\b/i.test(text)) return "pdf";
  if (/\b(csv)\b/i.test(text)) return "csv";
  if (/\b(json)\b/i.test(text)) return "json";
  if (/\b(markdown|\.md\b|\bmd\b)\b/i.test(text)) return "md";
  if (/\b(txt|text\s*file|file\s*teks)\b/i.test(text)) return "txt";
  return null;
}

export function artifactPromptInstruction(format: ArtifactFormat | null) {
  if (!format) return "";
  const common =
    "User meminta FILE jadi. Tulis isi final yang siap dimasukkan ke file; jangan membahas proses pembuatan file dan jangan mengatakan bahwa Anda tidak dapat membuat file.";

  if (format === "pptx") {
    return [
      common,
      "FORMAT TARGET: PPTX.",
      "Susun jawaban memakai heading per slide: ## Slide 1 — Judul, lalu bullet singkat.",
      "Isi slide padat dan presentable; hindari paragraf panjang.",
    ].join("\n");
  }
  if (format === "csv") {
    return [
      common,
      "FORMAT TARGET: CSV.",
      "Utamakan tabel/data konsisten. Jika cocok, gunakan tabel Markdown agar konversi kolom stabil.",
    ].join("\n");
  }
  if (format === "json") {
    return [
      common,
      "FORMAT TARGET: JSON.",
      "Keluarkan JSON valid tanpa komentar bila isi memang berupa data terstruktur.",
    ].join("\n");
  }
  if (format === "docx" || format === "pdf") {
    return [
      common,
      "FORMAT TARGET: " + format.toUpperCase() + ".",
      "Susun dokumen dengan judul, heading/subheading, paragraf, dan bullet yang rapi.",
    ].join("\n");
  }
  return common + "\nFORMAT TARGET: " + format.toUpperCase() + ".";
}

function stripInline(value: string) {
  return String(value || "")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\x60([^\x60]+)\x60/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .trim();
}

function cleanTitle(value: string) {
  const title = stripInline(
    String(value || "")
      .replace(/^#+\s*/, "")
      .replace(/\b(buat(?:kan)?|bikin(?:kan)?|jadikan|hasilkan|generate|create|export|konversi|convert|ubah(?:kan)?)\b/gi, " ")
      .replace(/\b(powerpoint|pptx?|word|docx?|pdf|csv|json|markdown|txt|file)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
  return (title || "Dokumen AI").slice(0, 90);
}

export function artifactTitleFromQuestion(question: string) {
  const quoted = String(question || "").match(/["“](.{3,100}?)[”"]/);
  if (quoted?.[1]) return cleanTitle(quoted[1]);
  const about = String(question || "").match(/\b(?:tentang|mengenai|about)\s+(.{3,120})/i);
  if (about?.[1]) return cleanTitle(about[1]);
  return cleanTitle(question);
}

function fileName(title: string, ext: ArtifactFormat) {
  const base =
    cleanTitle(title)
      .normalize("NFKD")
      .replace(/[^\w\s.-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .slice(0, 80) || "dokumen-ai";
  return base + "." + ext;
}

type Block = {
  kind: "heading" | "bullet" | "text" | "blank";
  text: string;
  level: number;
};

function blocks(content: string): Block[] {
  return String(content || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((raw) => {
      const line = raw.trimEnd();
      if (!line.trim()) return { kind: "blank", text: "", level: 0 } as Block;
      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        return {
          kind: "heading",
          text: stripInline(heading[2]),
          level: heading[1].length,
        } as Block;
      }
      const bullet = line.match(/^\s*(?:[-*+•]|\d+[.)])\s+(.+)$/);
      if (bullet) {
        return { kind: "bullet", text: stripInline(bullet[1]), level: 0 } as Block;
      }
      return { kind: "text", text: stripInline(line), level: 0 } as Block;
    });
}

async function makeDocx(title: string, content: string) {
  const children: Paragraph[] = [
    new Paragraph({ text: title, heading: HeadingLevel.TITLE }),
  ];

  for (const block of blocks(content)) {
    if (block.kind === "blank") {
      children.push(new Paragraph(""));
      continue;
    }
    if (block.kind === "heading") {
      children.push(
        new Paragraph({
          text: block.text,
          heading: block.level <= 2 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
        })
      );
      continue;
    }
    if (block.kind === "bullet") {
      children.push(
        new Paragraph({
          children: [new TextRun(block.text)],
          bullet: { level: 0 },
          spacing: { after: 120 },
        })
      );
      continue;
    }
    children.push(
      new Paragraph({
        children: [new TextRun(block.text)],
        spacing: { after: 120, line: 276 },
      })
    );
  }

  const doc = new Document({
    sections: [{ properties: {}, children }],
  });
  return Packer.toBuffer(doc);
}

function pdfSafe(value: string) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[^\x20-\x7E\u00A0-\u00FF]/g, "?");
}

function wrapPdf(text: string, font: any, size: number, maxWidth: number) {
  const words = pdfSafe(text).split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? line + " " + word : word;
    if (!line || font.widthOfTextAtSize(candidate, size) <= maxWidth) line = candidate;
    else {
      out.push(line);
      line = word;
    }
  }
  if (line) out.push(line);
  return out.length ? out : [""];
}

async function makePdf(title: string, content: string) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pageSize: [number, number] = [595.28, 841.89];
  const margin = 48;
  let page = pdf.addPage(pageSize);
  let y = pageSize[1] - margin;

  const addLine = (text: string, size = 11, isBold = false, indent = 0) => {
    const active = isBold ? bold : font;
    const wrapped = wrapPdf(text, active, size, pageSize[0] - margin * 2 - indent);
    for (const line of wrapped) {
      if (y < margin + 24) {
        page = pdf.addPage(pageSize);
        y = pageSize[1] - margin;
      }
      page.drawText(line, {
        x: margin + indent,
        y,
        size,
        font: active,
        color: rgb(0.1, 0.1, 0.1),
      });
      y -= size * 1.45;
    }
  };

  addLine(title, 18, true);
  y -= 8;

  for (const block of blocks(content)) {
    if (block.kind === "blank") {
      y -= 7;
      continue;
    }
    if (block.kind === "heading") {
      y -= 4;
      addLine(block.text, block.level <= 2 ? 14 : 12, true);
      y -= 3;
      continue;
    }
    if (block.kind === "bullet") {
      addLine("- " + block.text, 11, false, 12);
      continue;
    }
    addLine(block.text, 11);
  }

  return Buffer.from(await pdf.save());
}

type SlideData = { title: string; bullets: string[] };

function slideData(title: string, content: string) {
  const result: SlideData[] = [];
  let current: SlideData | null = null;

  const push = () => {
    if (!current) return;
    current.bullets = current.bullets.filter(Boolean).slice(0, 8);
    if (current.title || current.bullets.length) result.push(current);
    current = null;
  };

  for (const block of blocks(content)) {
    if (block.kind === "heading" && block.level <= 3) {
      push();
      current = {
        title: block.text.replace(/^Slide\s*\d+\s*[-—:]\s*/i, ""),
        bullets: [],
      };
      continue;
    }
    if (block.kind === "blank") continue;
    if (!current) current = { title: result.length ? "Lanjutan" : title, bullets: [] };
    current.bullets.push(block.text);
    if (current.bullets.length >= 6) push();
  }
  push();

  if (!result.length) result.push({ title, bullets: [] });
  if (result[0].title.toLowerCase() !== title.toLowerCase()) {
    result.unshift({ title, bullets: [] });
  }
  return result.slice(0, 30);
}

async function makePptx(title: string, content: string) {
  const pptx: any = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Ruang Belajar AI";
  pptx.subject = title;
  pptx.title = title;
  pptx.company = "Ruang Belajar";

  const slides = slideData(title, content);
  slides.forEach((item, index) => {
    const slide = pptx.addSlide();
    slide.background = { color: "FFFFFF" };
    slide.addText(item.title || ("Slide " + (index + 1)), {
      x: 0.7,
      y: 0.45,
      w: 11.9,
      h: 0.75,
      fontFace: "Aptos Display",
      fontSize: index === 0 && !item.bullets.length ? 28 : 24,
      bold: true,
      color: "1F2937",
      margin: 0,
    });

    if (item.bullets.length) {
      slide.addText(
        item.bullets.map((text) => ({
          text,
          options: { bullet: { indent: 18 }, breakLine: true },
        })) as any,
        {
          x: 0.9,
          y: 1.5,
          w: 11.2,
          h: 5.2,
          fontFace: "Aptos",
          fontSize: 18,
          color: "273444",
          breakLine: false,
          valign: "top",
          margin: 0.04,
          paraSpaceAfterPt: 10,
        } as any
      );
    }
  });

  const output = await (pptx as any).write({ outputType: "nodebuffer" });
  return Buffer.isBuffer(output) ? output : Buffer.from(output);
}

function markdownTableRows(content: string) {
  const lines = String(content || "")
    .split(/\r?\n/)
    .filter((line) => /^\s*\|.*\|\s*$/.test(line));
  if (lines.length < 2) return [] as string[][];
  return lines
    .filter((line) => !/^\s*\|?\s*:?-{3,}/.test(line))
    .map((line) =>
      line
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((cell) => stripInline(cell.trim()))
    );
}

function makeCsv(content: string) {
  const fenced = String(content || "").match(/\x60\x60\x60(?:csv)?\s*\n([\s\S]*?)\x60\x60\x60/i)?.[1]?.trim();
  if (fenced) return Buffer.from("\uFEFF" + fenced, "utf8");

  const rows = markdownTableRows(content);
  if (!rows.length) return Buffer.from("\uFEFF" + String(content || ""), "utf8");

  const csv = rows
    .map((row) =>
      row
        .map((cell) => {
          const value = String(cell || "");
          return /[",\n]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
        })
        .join(",")
    )
    .join("\r\n");
  return Buffer.from("\uFEFF" + csv, "utf8");
}

function makeJson(title: string, content: string) {
  const fenced = String(content || "").match(/\x60\x60\x60(?:json)?\s*\n([\s\S]*?)\x60\x60\x60/i)?.[1]?.trim();
  const candidate = fenced || String(content || "").trim();
  try {
    return Buffer.from(JSON.stringify(JSON.parse(candidate), null, 2), "utf8");
  } catch {
    return Buffer.from(JSON.stringify({ title, content }, null, 2), "utf8");
  }
}

export async function generateArtifact(
  format: ArtifactFormat,
  titleInput: string,
  contentInput: string
): Promise<GeneratedArtifact> {
  const title = cleanTitle(titleInput || "Dokumen AI");
  const content = String(contentInput || "").trim();
  let buffer: Buffer;

  if (format === "docx") buffer = await makeDocx(title, content);
  else if (format === "pdf") buffer = await makePdf(title, content);
  else if (format === "pptx") buffer = await makePptx(title, content);
  else if (format === "csv") buffer = makeCsv(content);
  else if (format === "json") buffer = makeJson(title, content);
  else buffer = Buffer.from(content, "utf8");

  return {
    buffer,
    mimeType: MIME[format],
    extension: format,
    fileName: fileName(title, format),
  };
}

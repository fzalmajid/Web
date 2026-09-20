import { NextRequest, NextResponse } from "next/server";
import * as mammoth from "mammoth";
import JSZip from "jszip";
import { createServerSupabase } from "@/lib/supabase";
import { geminiGenerateDetailed } from "@/lib/gemini";
import { modelPlanForSelection, selectionFromHeaders } from "@/lib/aiModels";
import { geminiUserAuthFromHeaders } from "@/lib/geminiUserAuth";
import { normalizeAiMode, recordAiTokenUsage } from "@/lib/aiQuota";

function bearer(req: NextRequest) {
  const h = req.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

function normalizeMime(value: string) {
  const mime = String(value || "application/octet-stream").split(";")[0].trim().toLowerCase();
  if (mime === "audio/mp4") return "audio/m4a";
  return mime;
}

function isTextMime(mime: string) {
  return mime.startsWith("text/") || ["application/json", "application/xml"].includes(mime);
}

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code) => String.fromCharCode(parseInt(code, 16)));
}

async function extractPptxText(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => Number(a.match(/slide(\d+)\.xml/i)?.[1] || 0) - Number(b.match(/slide(\d+)\.xml/i)?.[1] || 0));

  const slides: string[] = [];
  for (const name of names) {
    const xml = await zip.file(name)?.async("string");
    if (!xml) continue;
    const pieces = Array.from(xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/gi))
      .map((match) => decodeXml(match[1]).trim())
      .filter(Boolean);
    if (pieces.length) slides.push(pieces.join("\n"));
  }
  return slides.join("\n\n");
}

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const token = bearer(req);
    if (!token) return NextResponse.json({ error: "Belum login." }, { status: 401 });

    const supabase = createServerSupabase(token);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) return NextResponse.json({ error: "Sesi tidak valid." }, { status: 401 });

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "File tidak ditemukan." }, { status: 400 });
    if (file.size > 50 * 1024 * 1024) return NextResponse.json({ error: "File maksimal 50 MB." }, { status: 400 });

    const mimeType = normalizeMime(file.type);
    const fileName = file.name || "Lampiran";
    const buffer = Buffer.from(await file.arrayBuffer());
    let rawText = "";

    if (fileName.toLowerCase().endsWith(".docx") || mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      rawText = (await mammoth.extractRawText({ buffer })).value.trim();
    } else if (fileName.toLowerCase().endsWith(".pptx") || mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation") {
      rawText = (await extractPptxText(buffer)).trim();
    } else if (isTextMime(mimeType)) {
      rawText = buffer.toString("utf8").trim();
    } else {
      const aiMode = normalizeAiMode(String(form.get("aiMode") || "instant"));
      const selection = selectionFromHeaders(req.headers, "general", aiMode);
      const auth = geminiUserAuthFromHeaders(req.headers);
      const base64 = buffer.toString("base64");
      const isMedia = mimeType.startsWith("audio/") || mimeType.startsWith("video/");
      const prompt = isMedia
        ? "Transkripsikan seluruh ucapan secara VERBATIM. Tulis hanya yang benar-benar terdengar. Jangan memperbaiki istilah, jangan menebak dari konteks, jangan merangkum, jangan menata ulang."
        : mimeType.startsWith("image/")
          ? "Ekstrak semua teks yang benar-benar terlihat pada gambar ini secara literal. Jangan menebak, jangan merangkum, jangan menambah isi."
          : mimeType === "application/pdf"
            ? "Ekstrak teks dokumen PDF ini selengkap dan seliteral mungkin. Jangan meringkas, jangan memperbaiki, jangan menambah pengetahuan."
            : "Ekstrak isi tekstual file ini secara literal dan selengkap mungkin. Jangan meringkas atau menambahkan isi.";

      const result = await geminiGenerateDetailed(
        [{ text: prompt }, { inlineData: { mimeType, data: base64 } }],
        "Tugas Anda hanya membaca sumber mentah secara literal.",
        {
          models: modelPlanForSelection(selection.model, aiMode, isMedia ? "audio" : "standard"),
          effort: selection.effort,
          responseLength: selection.length,
          apiKey: auth.apiKey,
          accessToken: auth.accessToken,
          projectId: auth.projectId,
        }
      );
      await recordAiTokenUsage(supabase, result.usage, result.model, auth.provider);
      rawText = result.text.trim();
    }

    if (!rawText) return NextResponse.json({ error: "Tidak ada isi mentah yang berhasil dibaca." }, { status: 422 });

    return NextResponse.json({
      fileName,
      mimeType,
      rawText: rawText.slice(0, 60000),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Gagal membaca lampiran." }, { status: 500 });
  }
}

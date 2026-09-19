import { NextRequest, NextResponse } from "next/server";
import * as mammoth from "mammoth";
import JSZip from "jszip";
import { createServerSupabase } from "@/lib/supabase";
import { cleanJsonText, geminiGenerateDetailed, geminiModelsForMode, WHATSAPP_FORMAT_INSTRUCTION } from "@/lib/gemini";
import { buildKnowledgeContext, getScopeKnowledge } from "@/lib/knowledge";
import { aiModeInstruction, aiQuotaError, checkAiCredits, finalizeAiCredits, normalizeAiMode, recordAiTokenUsage } from "@/lib/aiQuota";

function bearer(req: NextRequest) {
  const h = req.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

function normalizeMime(value: string) {
  const mime = (value || "application/octet-stream").split(";")[0].trim().toLowerCase();
  if (mime === "audio/mp4") return "audio/m4a";
  return mime;
}

function isTextMime(mime: string) {
  return mime.startsWith("text/") || ["application/json", "application/xml"].includes(mime);
}

function isMediaMime(mime: string) {
  return mime.startsWith("audio/") || mime.startsWith("video/");
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
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const an = Number(a.match(/slide(\d+)\.xml/i)?.[1] || 0);
      const bn = Number(b.match(/slide(\d+)\.xml/i)?.[1] || 0);
      return an - bn;
    });

  const slides: string[] = [];
  for (const name of slideFiles) {
    const xml = await zip.file(name)?.async("string");
    if (!xml) continue;
    const pieces = Array.from(xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/gi))
      .map((match) => decodeXml(match[1]).trim())
      .filter(Boolean);
    if (pieces.length) {
      const number = Number(name.match(/slide(\d+)\.xml/i)?.[1] || slides.length + 1);
      slides.push("Slide " + number + ":\n" + pieces.join("\n"));
    }
  }

  return slides.join("\n\n");
}

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "Belum login." }, { status: 401 });

  const supabase = createServerSupabase(token);
  let sourceFileId = "";

  try {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return NextResponse.json({ error: "Sesi tidak valid." }, { status: 401 });
    }

    const body = await req.json();
    sourceFileId = String(body.sourceFileId || "");
    const filePath = String(body.filePath || "");
    const nodeId = String(body.nodeId || "");
    const fileName = String(body.fileName || "File");
    const mimeType = normalizeMime(String(body.mimeType || "application/octet-stream"));
    const aiMode = normalizeAiMode(body.aiMode);
    const userGeminiKey = String(req.headers.get("x-rb-gemini-key") || "").trim() || undefined;
    const ownGemini = Boolean(userGeminiKey);

    if (aiMode === "simple") {
      return NextResponse.json({ error: "Mode Simple diproses secara Local di perangkat dan tidak memanggil Gemini." }, { status: 400 });
    }

    if (!sourceFileId || !filePath || !nodeId) {
      return NextResponse.json({ error: "Data file tidak lengkap." }, { status: 400 });
    }

    const { data: row, error: rowError } = await supabase
      .from("source_files")
      .select("id,node_id,file_path,file_name,mime_type")
      .eq("id", sourceFileId)
      .single();
    if (rowError || !row || row.file_path !== filePath || row.node_id !== nodeId) {
      return NextResponse.json({ error: "File tidak ditemukan." }, { status: 404 });
    }

    const { data: blob, error: downloadError } = await supabase.storage
      .from("study-files")
      .download(filePath);
    if (downloadError || !blob) throw downloadError || new Error("File tidak dapat dibaca.");

    if (blob.size > 50 * 1024 * 1024) {
      throw new Error("File maksimal 50 MB untuk pemrosesan ini.");
    }

    const buffer = Buffer.from(await blob.arrayBuffer());
    let rawText = "";

    const heavyFile =
      isMediaMime(mimeType) ||
      mimeType === "application/pdf" ||
      mimeType.startsWith("image/");
    const guardAction = heavyFile ? "file_heavy" : "file_light";
    const preflight = ownGemini ? null : await checkAiCredits(supabase, guardAction, aiMode);
    if (preflight && !preflight.allowed) {
      await supabase
        .from("source_files")
        .update({
          processing_status: "error",
          error_message: aiQuotaError(preflight).error,
        })
        .eq("id", sourceFileId);
      return NextResponse.json(aiQuotaError(preflight), { status: 429 });
    }

    if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || fileName.toLowerCase().endsWith(".docx")) {
      const extracted = await mammoth.extractRawText({ buffer });
      rawText = extracted.value.trim();
    } else if (mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation" || fileName.toLowerCase().endsWith(".pptx")) {
      rawText = (await extractPptxText(buffer)).trim();
    } else if (isTextMime(mimeType)) {
      rawText = buffer.toString("utf8").trim();
    } else {
      const base64 = buffer.toString("base64");
      const prompt = isMediaMime(mimeType)
        ? "Transkripsikan seluruh ucapan dari file ini secara VERBATIM, sedekat mungkin kata demi kata. Jangan merangkum, jangan mengoreksi istilah, jangan menambah isi. Gunakan paragraf dan tanda baca secukupnya."
        : mimeType === "application/pdf"
          ? "Ekstrak isi dokumen PDF ini selengkap mungkin. Pertahankan judul, subjudul, daftar, angka, istilah, dan isi penting. Jangan meringkas dan jangan menambahkan pengetahuan luar."
          : "Ekstrak semua informasi tekstual yang dapat dibaca dari file/gambar ini. Jangan menambahkan informasi yang tidak ada pada sumber.";
      const extractionResult = await geminiGenerateDetailed(
        [
          { text: prompt },
          { inlineData: { mimeType, data: base64 } },
        ],
        undefined,
        {
          models: geminiModelsForMode(aiMode, isMediaMime(mimeType) ? "audio" : "standard"),
          apiKey: userGeminiKey,
        }
      );
      await recordAiTokenUsage(supabase, extractionResult.usage, extractionResult.model);
      rawText = extractionResult.text;
    }

    if (!rawText.trim()) throw new Error("Tidak ada teks yang berhasil diekstrak.");

    const knowledge = await getScopeKnowledge(supabase, nodeId, 40);
    const context = buildKnowledgeContext(knowledge.filter(k => k.title !== fileName), 26000);
    const media = isMediaMime(mimeType);

    const structuredResult = await geminiGenerateDetailed(
      [{
        text: `SUMBER MENTAH:
${rawText}

DATABASE REFERENSI YANG SUDAH ADA:
${context || "(belum ada database yang relevan)"}

Keluarkan JSON valid tanpa markdown:
{
  "structured_text":"...",
  "summary":"...",
  "corrections":[{"heard":"...","corrected":"...","basis":"..."}]
}

Aturan:
- ${media ? "Sumber mentah adalah transkrip verbatim. structured_text harus menata ulang ucapan menjadi transkrip terstruktur." : "structured_text harus menyusun isi dokumen menjadi catatan terstruktur yang tetap mempertahankan informasi penting."}
- Jangan menambah fakta yang tidak ada di SUMBER MENTAH.
- DATABASE REFERENSI hanya boleh dipakai untuk menyelesaikan istilah/nama/singkatan yang keliru atau ambigu.
- Koreksi hanya dilakukan jika database benar-benar mendukungnya; semua koreksi harus dicatat.
- Jika database tidak membantu, susun/rangkum berdasarkan SUMBER MENTAH saja.\n- ${aiModeInstruction(aiMode)}\n- ${WHATSAPP_FORMAT_INSTRUCTION}`,
      }],
      "Anda mengolah sumber belajar secara konservatif. Jangan mengarang fakta.",
      { models: geminiModelsForMode(aiMode, "standard"), apiKey: userGeminiKey }
    );
    await recordAiTokenUsage(supabase, structuredResult.usage, structuredResult.model);
    const structuredRaw = structuredResult.text;

    let structuredText = rawText;
    let summary = "";
    let corrections: Array<{ heard: string; corrected: string; basis: string }> = [];

    try {
      const parsed = JSON.parse(cleanJsonText(structuredRaw));
      structuredText = String(parsed.structured_text || rawText).trim();
      summary = String(parsed.summary || "").trim();
      corrections = Array.isArray(parsed.corrections)
        ? parsed.corrections.slice(0, 40).map((x: any) => ({
            heard: String(x.heard || ""),
            corrected: String(x.corrected || ""),
            basis: String(x.basis || ""),
          })).filter((x: any) => x.heard && x.corrected)
        : [];
    } catch {
      structuredText = structuredRaw || rawText;
    }

    const combined = [
      structuredText,
      summary ? `Ringkasan:\n${summary}` : "",
      `SUMBER MENTAH:\n${rawText}`,
    ].filter(Boolean).join("\n\n---\n\n");

    const { data: entry, error: entryError } = await supabase
      .from("knowledge_entries")
      .insert({
        user_id: userData.user.id,
        node_id: nodeId,
        title: fileName,
        category: media ? "Transkrip file" : "File",
        content: combined,
        raw_content: rawText,
        source_type: "file",
        source_file_id: sourceFileId,
      })
      .select("id")
      .single();
    if (entryError) throw entryError;

    const { error: updateError } = await supabase
      .from("source_files")
      .update({
        processing_status: "ready",
        raw_text: rawText,
        structured_text: structuredText + (summary ? `\n\nRingkasan:\n${summary}` : ""),
        corrections,
        error_message: null,
      })
      .eq("id", sourceFileId);
    if (updateError) throw updateError;

    const aiUsage = ownGemini ? null : await finalizeAiCredits(supabase, guardAction, aiMode);

    return NextResponse.json({
      entryId: entry.id,
      rawText,
      structuredText,
      summary,
      corrections,
      aiUsage,
      structuringModel: structuredResult.model,
      provider: ownGemini ? "user-api-key" : "shared-api-key",
    });
  } catch (error: any) {
    const status = Number(error?.statusCode || 500);
    console.error("[API_IMPORT_FILE_ERROR]", { name: error?.name, code: error?.code, status });

    if (sourceFileId) {
      await supabase
        .from("source_files")
        .update({
          processing_status: "error",
          error_message: error?.message || "Gagal memproses file.",
        })
        .eq("id", sourceFileId);
    }

    return NextResponse.json(
      { error: error?.message || "Gagal memproses file." },
      { status: status >= 400 && status < 600 ? status : 500 }
    );
  }
}

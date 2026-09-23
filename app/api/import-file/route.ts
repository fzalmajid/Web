import { NextRequest, NextResponse } from "next/server";
import * as mammoth from "mammoth";
import JSZip from "jszip";
import { createServerSupabase } from "@/lib/supabase";
import { cleanJsonText, geminiGenerateDetailed, WHATSAPP_FORMAT_INSTRUCTION } from "@/lib/gemini";
import { buildKnowledgeContext, getScopeKnowledge } from "@/lib/knowledge";
import { modelPlanForSelection, selectionFromHeaders } from "@/lib/aiModels";
import { geminiUserAuthFromHeaders } from "@/lib/geminiUserAuth";
import { aiModeInstruction, aiQuotaError, checkAiCredits, finalizeAiCredits, normalizeAiMode, recordAiTokenUsage } from "@/lib/aiQuota";
import { getTextAiRequestInfo, generateTextAi } from "@/lib/requestTextAi";

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

type VisionPart = { label: string; mimeType: string; data: string };

function imageMime(name: string) {
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

async function extractOfficeImages(buffer: Buffer, kind: "pptx" | "docx") {
  const zip = await JSZip.loadAsync(buffer);
  const prefix = kind === "pptx" ? "ppt/media/" : "word/media/";
  const names = Object.keys(zip.files)
    .filter((name) => name.toLowerCase().startsWith(prefix) && imageMime(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const parts: VisionPart[] = [];
  for (const name of names.slice(0, 40)) {
    const file = zip.file(name);
    if (!file) continue;
    const data = await file.async("base64");
    parts.push({
      label: kind === "pptx" ? `Slide image ${parts.length + 1}` : `Document image ${parts.length + 1}`,
      mimeType: imageMime(name),
      data,
    });
  }
  return parts;
}

async function readVisionImages(
  parts: VisionPart[],
  selection: ReturnType<typeof selectionFromHeaders>,
  aiMode: ReturnType<typeof normalizeAiMode>,
  auth: ReturnType<typeof geminiUserAuthFromHeaders>,
  prompt: string
) {
  const chunks: string[] = [];
  let usage = { inputTokens: 0, outputTokens: 0, thoughtsTokens: 0, totalTokens: 0 };
  let model = "";
  for (const part of parts) {
    const result = await geminiGenerateDetailed(
      [{ text: `${prompt}\n\nSumber: ${part.label}` }, { inlineData: { mimeType: part.mimeType, data: part.data } }],
      "Baca gambar secara teliti. Jangan mengarang teks yang tidak terlihat.",
      {
        models: modelPlanForSelection(selection.model, aiMode, "standard"),
        effort: selection.effort,
        apiKey: auth.apiKey,
        accessToken: auth.accessToken,
        projectId: auth.projectId,
      }
    );
    chunks.push(`${part.label}:\n${result.text.trim()}`);
    model = result.model;
    usage = {
      inputTokens: usage.inputTokens + result.usage.inputTokens,
      outputTokens: usage.outputTokens + result.usage.outputTokens,
      thoughtsTokens: usage.thoughtsTokens + result.usage.thoughtsTokens,
      totalTokens: usage.totalTokens + result.usage.totalTokens,
    };
  }
  return { text: chunks.filter(Boolean).join("\n\n"), usage, model };
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
    const operation = body.operation === "ai-copy" ? "ai-copy" : "raw";
    const aiCopyMode =
      body.aiCopyMode === "compact" || body.aiCopyMode === "complex"
        ? body.aiCopyMode
        : "medium";
    const aiCopyRatio = aiCopyMode === "compact" ? 30 : aiCopyMode === "complex" ? 90 : 50;
    const aiSelection = selectionFromHeaders(req.headers, "general", aiMode);
    const geminiAuth = geminiUserAuthFromHeaders(req.headers);
    const aiInfo = operation === "ai-copy" ? getTextAiRequestInfo(req, aiMode) : null;
    const sharedGemini = operation === "ai-copy"
      ? Boolean(aiInfo?.sharedGemini)
      : !geminiAuth.ownGemini;

    if (aiMode === "simple") {
      return NextResponse.json({ error: "Local diproses secara Local di perangkat dan tidak memanggil Gemini." }, { status: 400 });
    }

    if (!sourceFileId || !filePath || !nodeId) {
      return NextResponse.json({ error: "Data file tidak lengkap." }, { status: 400 });
    }

    const { data: row, error: rowError } = await supabase
      .from("source_files")
      .select("id,node_id,file_path,file_name,mime_type,raw_text")
      .eq("id", sourceFileId)
      .single();
    if (rowError || !row || row.file_path !== filePath || row.node_id !== nodeId) {
      return NextResponse.json({ error: "File tidak ditemukan." }, { status: 404 });
    }

    let rawText = operation === "ai-copy" ? String(row.raw_text || "").trim() : "";
    let buffer: Buffer | null = null;

    if (!rawText) {
      const { data: blob, error: downloadError } = await supabase.storage
        .from("study-files")
        .download(filePath);
      if (downloadError || !blob) throw downloadError || new Error("File tidak dapat dibaca.");

      if (blob.size > 50 * 1024 * 1024) {
        throw new Error("File maksimal 50 MB untuk pemrosesan ini.");
      }

      buffer = Buffer.from(await blob.arrayBuffer());
    }

    const heavyFile =
      isMediaMime(mimeType) ||
      mimeType === "application/pdf" ||
      mimeType.startsWith("image/");
    const guardAction = heavyFile ? "file_heavy" : "file_light";
    const preflight = sharedGemini ? await checkAiCredits(supabase, guardAction, aiMode) : null;
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

    if (!rawText && (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || fileName.toLowerCase().endsWith(".docx"))) {
      const extracted = await mammoth.extractRawText({ buffer: buffer! });
      rawText = extracted.value.trim();
    } else if (!rawText && (mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation" || fileName.toLowerCase().endsWith(".pptx"))) {
      rawText = (await extractPptxText(buffer!)).trim();
    } else if (!rawText && isTextMime(mimeType)) {
      rawText = buffer!.toString("utf8").trim();
    }

    if (!rawText && (fileName.toLowerCase().endsWith(".pptx") || mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation" || fileName.toLowerCase().endsWith(".docx") || mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document")) {
      const officeKind = fileName.toLowerCase().endsWith(".pptx") || mimeType.includes("presentation") ? "pptx" : "docx";
      const images = await extractOfficeImages(buffer!, officeKind);
      if (images.length) {
        const vision = await readVisionImages(
          images,
          aiSelection,
          aiMode,
          geminiAuth,
          "OCR seluruh tulisan yang terlihat pada gambar ini secara literal. Pertahankan urutan, judul, nomor, tabel, rumus, dan daftar. Jangan meringkas atau menebak. Jika bagian tidak terbaca, tandai [tidak terbaca]."
        );
        await recordAiTokenUsage(supabase, vision.usage, vision.model, geminiAuth.provider);
        rawText = vision.text;
      }
    }

    if (!rawText) {
      const base64 = buffer!.toString("base64");
      const prompt = isMediaMime(mimeType)
        ? "Transkripsikan seluruh ucapan dari file ini secara VERBATIM, sedekat mungkin kata demi kata. Jangan merangkum, jangan mengoreksi istilah, jangan menambah isi. Gunakan paragraf dan tanda baca secukupnya."
        : mimeType === "application/pdf"
          ? "Baca PDF ini sebagai dokumen visual, termasuk halaman yang merupakan hasil scan/foto. OCR seluruh tulisan yang terlihat secara literal dan selengkap mungkin. Pertahankan judul, subjudul, daftar, tabel, angka, istilah, dan urutan halaman. Jangan meringkas, jangan menambahkan pengetahuan luar. Jika bagian tidak terbaca, tandai [tidak terbaca]."
          : "Ekstrak semua informasi tekstual yang dapat dibaca dari file/gambar ini. Jangan menambahkan informasi yang tidak ada pada sumber.";
      const extractionResult = await geminiGenerateDetailed(
        [
          { text: prompt },
          { inlineData: { mimeType, data: base64 } },
        ],
        undefined,
        {
          models: modelPlanForSelection(aiSelection.model, aiMode, isMediaMime(mimeType) ? "audio" : "standard"),
          effort: aiSelection.effort,
          apiKey: geminiAuth.apiKey,
      accessToken: geminiAuth.accessToken,
      projectId: geminiAuth.projectId,
        }
      );
      await recordAiTokenUsage(supabase, extractionResult.usage, extractionResult.model, geminiAuth.provider);
      rawText = extractionResult.text;
    }

    if (!rawText.trim()) throw new Error("Tidak ada teks yang berhasil diekstrak.");

    const media = isMediaMime(mimeType);

    if (operation === "raw") {
      const { data: existingEntry } = await supabase
        .from("knowledge_entries")
        .select("id")
        .eq("source_file_id", sourceFileId)
        .maybeSingle();

      if (existingEntry?.id) {
        const { error: entryUpdateError } = await supabase
          .from("knowledge_entries")
          .update({
            title: fileName,
            category: media ? "Transkrip file" : "File",
            content: rawText,
            raw_content: rawText,
            source_type: "file",
          })
          .eq("id", existingEntry.id);
        if (entryUpdateError) throw entryUpdateError;
      } else {
        const { error: entryInsertError } = await supabase
          .from("knowledge_entries")
          .insert({
            user_id: userData.user.id,
            node_id: nodeId,
            title: fileName,
            category: media ? "Transkrip file" : "File",
            content: rawText,
            raw_content: rawText,
            source_type: "file",
            source_file_id: sourceFileId,
          });
        if (entryInsertError) throw entryInsertError;
      }

      const { error: rawUpdateError } = await supabase
        .from("source_files")
        .update({
          processing_status: "ready",
          raw_text: rawText,
          structured_text: null,
          corrections: [],
          error_message: null,
          ai_copy_mode: null,
          ai_copy_ratio: null,
          ai_copy_model: null,
          ai_copy_updated_at: null,
        })
        .eq("id", sourceFileId);
      if (rawUpdateError) throw rawUpdateError;

      const aiUsage = sharedGemini ? await finalizeAiCredits(supabase, guardAction, aiMode) : null;
      return NextResponse.json({ rawText, aiUsage, operation: "raw" });
    }

    const knowledge = await getScopeKnowledge(supabase, nodeId, 40);
    const context = buildKnowledgeContext(knowledge.filter(k => k.title !== fileName), 26000);

    if (!aiInfo) throw new Error("Konfigurasi AI copy tidak tersedia.");
    const structuredResult = await generateTextAi(
      aiInfo,
      aiMode,
      `SUMBER MENTAH:
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
- ${media ? "Sumber mentah adalah transkrip verbatim. structured_text harus membuat SALINAN versi AI yang lebih rapi, bukan mengganti RAW." : "structured_text harus membuat SALINAN versi AI dari dokumen RAW, bukan mengganti RAW."}
- Target panjang structured_text kira-kira ${aiCopyRatio}% dari jumlah karakter SUMBER MENTAH. Boleh sedikit meleset agar kalimat tetap utuh.
- Mode panjang: ${aiCopyMode === "compact" ? "RINGKAS / 30%: hanya inti, poin utama, definisi penting." : aiCopyMode === "complex" ? "KOMPLEKS / 90%: hampir seluruh informasi dipertahankan, hanya dirapikan dan sedikit dipadatkan." : "MEDIUM / 50%: pertahankan poin penting dan penjelasan utama, buang repetisi/detail sekunder."}
- Jangan menambah fakta yang tidak ada di SUMBER MENTAH.
- DATABASE REFERENSI hanya boleh dipakai untuk menyelesaikan istilah/nama/singkatan yang keliru atau ambigu.
- Koreksi hanya dilakukan jika database benar-benar mendukungnya; semua koreksi harus dicatat.
- Jika database tidak membantu, susun/rangkum berdasarkan SUMBER MENTAH saja.\n- ${aiModeInstruction(aiMode)}\n- ${WHATSAPP_FORMAT_INSTRUCTION}`,
      "Anda mengolah sumber belajar secara konservatif. Jangan mengarang fakta.",
      {
        web: false,
        json: true,
      }
    );
    await recordAiTokenUsage(supabase, structuredResult.usage, structuredResult.model, structuredResult.provider);
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

    const copyContent = structuredText + (summary ? `\n\nRingkasan:\n${summary}` : "");
    const { data: insertedEntry, error: entryError } = await supabase
      .from("knowledge_entries")
      .insert({
        user_id: userData.user.id,
        node_id: nodeId,
        title: `Copy by AI - ${fileName}`,
        category: media
          ? `Salinan AI transkrip · sekitar ${aiCopyRatio}% · ${structuredResult.model}`
          : `Salinan AI · sekitar ${aiCopyRatio}% · ${structuredResult.model}`,
        content: copyContent,
        raw_content: copyContent,
        source_type: "generated",
        source_file_id: null,
      })
      .select("id")
      .single();
    if (entryError) throw entryError;
    const entryId = insertedEntry.id;

    const { error: updateError } = await supabase
      .from("source_files")
      .update({
        processing_status: "ready",
        raw_text: rawText,
        structured_text: null,
        corrections,
        error_message: null,
        ai_copy_mode: aiCopyMode,
        ai_copy_ratio: aiCopyRatio,
        ai_copy_model: structuredResult.model,
        ai_copy_updated_at: new Date().toISOString(),
      })
      .eq("id", sourceFileId);
    if (updateError) throw updateError;

    const aiUsage = sharedGemini ? await finalizeAiCredits(supabase, guardAction, aiMode) : null;

    return NextResponse.json({
      entryId,
      rawText,
      structuredText,
      summary,
      corrections,
      aiUsage,
      structuringModel: structuredResult.model,
      provider: structuredResult.provider,
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


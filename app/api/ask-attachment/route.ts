import { NextRequest, NextResponse } from "next/server";
import * as mammoth from "mammoth";
import { createServerSupabase } from "@/lib/supabase";
import { geminiGenerateDetailed } from "@/lib/gemini";
import { modelPlanForSelection, selectionFromHeaders } from "@/lib/aiModels";
import { geminiUserAuthFromHeaders } from "@/lib/geminiUserAuth";
import { normalizeAiMode, recordAiTokenUsage } from "@/lib/aiQuota";
import { readOfficeDocument, readPdfNativeBatch, readPdfBatchWithOcr } from "@/lib/visualOcr";

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
    } else if (isTextMime(mimeType)) {
      rawText = buffer.toString("utf8").trim();
    }

    const aiMode = normalizeAiMode(String(form.get("aiMode") || "instant"));
    const selection = selectionFromHeaders(req.headers, "general", aiMode);
    const auth = geminiUserAuthFromHeaders(req.headers);
    const ocrOptions = {
      selection,
      aiMode,
      auth,
      onUsage: async (
        usage: Awaited<ReturnType<typeof geminiGenerateDetailed>>["usage"],
        model: string
      ) => {
        await recordAiTokenUsage(supabase, usage, model, auth.provider);
      },
    };

    if (fileName.toLowerCase().endsWith(".pptx") || mimeType.includes("presentation") ||
        fileName.toLowerCase().endsWith(".docx") || mimeType.includes("wordprocessingml")) {
      // Extract embedded scan screenshots even when some slides already contain digital text.
      const kind = fileName.toLowerCase().endsWith(".pptx") || mimeType.includes("presentation")
        ? "pptx" : "docx";
      rawText = await readOfficeDocument(buffer, kind, rawText, ocrOptions);
    }

    if (mimeType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf")) {
      const pages: Array<{ page: number; text: string }> = [];
      let start = 1;
      for (;;) {
        const batch = await readPdfNativeBatch(buffer, start);
        if (batch.totalPages > 24) {
          return NextResponse.json({
            error: "PDF berisi " + batch.totalPages + " halaman. Untuk pembacaan lengkap, simpan ke Database; sistem akan memproses semua halaman secara bertahap.",
          }, { status: 413 });
        }
        if (!batch.pages.length) throw new Error("Tidak ada halaman PDF yang dapat dibaca.");
        const withOcr = await readPdfBatchWithOcr(buffer, batch.pages, ocrOptions);
        pages.push(...withOcr);
        if (batch.endPage >= batch.totalPages) break;
        if (batch.endPage < start) throw new Error("Pembacaan PDF tidak menunjukkan kemajuan.");
        start = batch.endPage + 1;
      }
      rawText = pages.map((page) =>
        "[Halaman " + page.page + "]\n" + (page.text.trim() || "[tidak ada teks terbaca]")
      ).join("\n\n");
    }

    if (!rawText) {
      const base64 = buffer.toString("base64");
      const isMedia = mimeType.startsWith("audio/") || mimeType.startsWith("video/");
      const prompt = isMedia
        ? "Transkripsikan seluruh ucapan secara VERBATIM. Tulis hanya yang benar-benar terdengar. Jangan memperbaiki istilah, jangan menebak dari konteks, jangan merangkum, jangan menata ulang."
        : mimeType.startsWith("image/")
          ? "Ekstrak semua teks yang benar-benar terlihat pada gambar ini secara literal. Jangan menebak, jangan merangkum, jangan menambah isi."
          : mimeType === "application/pdf"
            ? "Baca PDF ini sebagai dokumen visual, termasuk halaman yang merupakan hasil scan/foto. OCR seluruh tulisan yang terlihat secara literal dan selengkap mungkin. Pertahankan urutan halaman, judul, tabel, angka, dan daftar. Jangan meringkas, jangan memperbaiki, jangan menambah pengetahuan. Jika bagian tidak terbaca, tandai [tidak terbaca]."
            : "Ekstrak isi tekstual file ini secara literal dan selengkap mungkin. Jangan meringkas atau menambahkan isi.";

      const result = await geminiGenerateDetailed(
        [{ text: prompt }, { inlineData: { mimeType, data: base64 } }],
        "Tugas Anda hanya membaca sumber mentah secara literal.",
        {
          models: modelPlanForSelection(selection.model, aiMode, isMedia ? "audio" : "standard"),
          effort: selection.effort,
          apiKey: auth.apiKey,
          accessToken: auth.accessToken,
          projectId: auth.projectId,
        }
      );
      await recordAiTokenUsage(supabase, result.usage, result.model, auth.provider);
      rawText = result.text.trim();
    }

    if (!rawText) return NextResponse.json({ error: "Tidak ada isi mentah yang berhasil dibaca." }, { status: 422 });
    if (rawText.length > 60000) return NextResponse.json({ error: "Teks file terlalu panjang untuk lampiran Tanya AI. Simpan ke Database untuk pemrosesan lengkap per bagian." }, { status: 413 });

    return NextResponse.json({
      fileName,
      mimeType,
      rawText: rawText.slice(0, 60000),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Gagal membaca lampiran." }, { status: 500 });
  }
}


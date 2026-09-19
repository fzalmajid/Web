import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { cleanJsonText, geminiGenerate } from "@/lib/gemini";
import { buildKnowledgeContext, getScopeKnowledge } from "@/lib/knowledge";

function bearer(req: NextRequest) {
  const h = req.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

function normalizeMime(value: string) {
  const mime = (value || "audio/webm").split(";")[0].trim().toLowerCase();
  if (mime === "audio/mp4") return "audio/m4a";
  return mime || "audio/webm";
}

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const token = bearer(req);
    if (!token) return NextResponse.json({ error: "Belum login." }, { status: 401 });

    const body = await req.json();
    const recordingId = String(body.recordingId || "");
    const filePath = String(body.filePath || "");
    const contextNodeId = body.contextNodeId ? String(body.contextNodeId) : null;
    const mimeType = normalizeMime(String(body.mimeType || "audio/webm"));

    if (!recordingId || !filePath) {
      return NextResponse.json({ error: "Data rekaman tidak lengkap." }, { status: 400 });
    }

    const supabase = createServerSupabase(token);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return NextResponse.json({ error: "Sesi tidak valid." }, { status: 401 });
    }

    const { data: recording, error: recError } = await supabase
      .from("recordings")
      .select("id,title,file_path")
      .eq("id", recordingId)
      .single();

    if (recError || !recording || recording.file_path !== filePath) {
      return NextResponse.json({ error: "Rekaman tidak ditemukan." }, { status: 404 });
    }

    const { data: blob, error: downloadError } = await supabase.storage
      .from("recordings")
      .download(filePath);

    if (downloadError || !blob) {
      throw downloadError || new Error("Audio tidak dapat dibaca.");
    }

    if (blob.size > 50 * 1024 * 1024) {
      return NextResponse.json({ error: "Rekaman maksimal 50 MB." }, { status: 413 });
    }

    const base64 = Buffer.from(await blob.arrayBuffer()).toString("base64");

    const rawTranscript = await geminiGenerate([
      {
        text:
          "Transkripsikan audio berikut secara VERBATIM. Tulis apa yang benar-benar terdengar sedekat mungkin kata demi kata. Jangan mengoreksi istilah, jangan merangkum, jangan menambahkan fakta. Rapikan tanda baca dan paragraf secukupnya.",
      },
      { inlineData: { mimeType, data: base64 } },
    ]);

    const knowledge = await getScopeKnowledge(supabase, contextNodeId, 40);
    const context = buildKnowledgeContext(knowledge, 26000);

    const structuredRaw = await geminiGenerate(
      [
        {
          text:
            "TRANSKRIP VERBATIM:\n" +
            rawTranscript +
            "\n\nDATABASE REFERENSI:\n" +
            (context || "(tidak ada database yang relevan)") +
            "\n\nKeluarkan JSON valid tanpa markdown dengan bentuk:\n" +
            '{"structured_transcript":"...","summary":"...","corrections":[{"heard":"...","corrected":"...","basis":"..."}]}\n\n' +
            "Aturan:\n" +
            "1. structured_transcript harus menata ulang isi ucapan agar runtut tanpa mengubah makna.\n" +
            "2. Istilah hanya boleh dikoreksi bila DATABASE REFERENSI benar-benar mendukung koreksi itu.\n" +
            '3. Contoh: bila terdengar "CPOD" tetapi database pada konteks yang sama jelas memakai/menjelaskan "CPOB", versi tertata boleh menulis CPOB dan koreksinya dicatat.\n' +
            "4. Jangan mengubah transkrip verbatim.\n" +
            "5. Bila database kosong/tidak relevan, jangan menambah fakta luar; cukup tata dan rangkum berdasarkan rekaman.\n" +
            "6. basis harus singkat dan menyebut dasar dari database.",
        },
      ],
      "Anda menyunting transkrip secara konservatif. Database yang diberikan adalah satu-satunya sumber untuk koreksi istilah faktual."
    );

    let structuredTranscript = rawTranscript;
    let summary = "";
    let corrections: Array<{ heard: string; corrected: string; basis: string }> = [];

    try {
      const parsed = JSON.parse(cleanJsonText(structuredRaw));
      structuredTranscript = String(parsed.structured_transcript || rawTranscript).trim();
      summary = String(parsed.summary || "").trim();
      corrections = Array.isArray(parsed.corrections)
        ? parsed.corrections
            .slice(0, 30)
            .map((x: any) => ({
              heard: String(x.heard || ""),
              corrected: String(x.corrected || ""),
              basis: String(x.basis || ""),
            }))
            .filter((x: any) => x.heard && x.corrected)
        : [];
    } catch {
      structuredTranscript = structuredRaw || rawTranscript;
    }

    const { error: updateError } = await supabase
      .from("recordings")
      .update({
        raw_transcript: rawTranscript,
        structured_transcript: structuredTranscript,
        transcript: structuredTranscript,
        corrections,
      })
      .eq("id", recordingId);

    if (updateError) throw updateError;

    return NextResponse.json({
      rawTranscript,
      structuredTranscript,
      summary,
      corrections,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Transkripsi gagal." }, { status: 500 });
  }
}

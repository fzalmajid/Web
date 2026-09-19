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
    const scopeNodeId = body.scopeNodeId ? String(body.scopeNodeId) : null;
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
      .select("id,title,file_path,knowledge_entry_id")
      .eq("id", recordingId)
      .single();
    if (recError || !recording || recording.file_path !== filePath) {
      return NextResponse.json({ error: "Rekaman tidak ditemukan." }, { status: 404 });
    }

    const { data: blob, error: downloadError } = await supabase.storage
      .from("recordings")
      .download(filePath);
    if (downloadError || !blob) throw downloadError || new Error("Audio tidak dapat dibaca.");

    if (blob.size > 50 * 1024 * 1024) {
      return NextResponse.json({ error: "Rekaman maksimal 50 MB." }, { status: 413 });
    }

    const base64 = Buffer.from(await blob.arrayBuffer()).toString("base64");

    const rawTranscript = await geminiGenerate([
      {
        text:
          "Transkripsikan audio berikut secara VERBATIM. Tulis apa yang benar-benar terdengar, kata demi kata, termasuk istilah yang mungkin salah ucap. Jangan mengoreksi istilah, jangan merangkum, jangan menambahkan fakta. Rapikan hanya tanda baca dan pemisahan paragraf agar terbaca.",
      },
      { inlineData: { mimeType, data: base64 } },
    ]);

    const knowledge = await getScopeKnowledge(supabase, scopeNodeId, 40);
    const context = buildKnowledgeContext(knowledge, 26000);

    const structuredRaw = await geminiGenerate(
      [{
        text: `TRANSKRIP VERBATIM:
${rawTranscript}

DATABASE REFERENSI:
${context || "(tidak ada database pada scope ini)"}

Keluarkan JSON valid tanpa markdown:
{
  "structured_transcript":"...",
  "summary":"...",
  "corrections":[{"heard":"...","corrected":"...","basis":"..."}]
}

Aturan:
1. structured_transcript harus menata ulang isi ucapan menjadi paragraf/poin yang runtut TANPA mengubah makna.
2. Istilah hanya boleh dikoreksi jika DATABASE REFERENSI benar-benar mendukung koreksi itu. Contoh: jika terdengar "CPOD" tetapi database jelas menggunakan/menjelaskan "CPOB" pada konteks yang sama, structured_transcript boleh menulis CPOB dan masukkan koreksinya ke corrections.
3. Jangan mengubah TRANSKRIP VERBATIM.
4. Jika database kosong/tidak relevan, jangan menambah fakta luar; cukup tata dan rangkum berdasarkan isi rekaman.
5. basis harus singkat dan menjelaskan dasar dari database, bukan pengetahuan umum.`,
      }],
      "Anda menyunting transkrip secara konservatif. Database adalah satu-satunya sumber untuk koreksi istilah faktual."
    );

    let structuredTranscript = rawTranscript;
    let summary = "";
    let corrections: Array<{ heard: string; corrected: string; basis: string }> = [];

    try {
      const parsed = JSON.parse(cleanJsonText(structuredRaw));
      structuredTranscript = String(parsed.structured_transcript || rawTranscript).trim();
      summary = String(parsed.summary || "").trim();
      corrections = Array.isArray(parsed.corrections)
        ? parsed.corrections.slice(0, 30).map((x: any) => ({
            heard: String(x.heard || ""),
            corrected: String(x.corrected || ""),
            basis: String(x.basis || ""),
          })).filter((x: any) => x.heard && x.corrected)
        : [];
    } catch {
      structuredTranscript = structuredRaw || rawTranscript;
    }

    let knowledgeEntryId = recording.knowledge_entry_id as string | null;

    if (scopeNodeId) {
      if (knowledgeEntryId) {
        const { error } = await supabase
          .from("knowledge_entries")
          .update({
            node_id: scopeNodeId,
            title: recording.title,
            category: "Transkrip rekaman",
            raw_content: rawTranscript,
            content: structuredTranscript + (summary ? `\n\nRingkasan:\n${summary}` : ""),
            source_type: "transcript",
          })
          .eq("id", knowledgeEntryId);
        if (error) throw error;
      } else {
        const { data: entry, error } = await supabase
          .from("knowledge_entries")
          .insert({
            user_id: userData.user.id,
            node_id: scopeNodeId,
            title: recording.title,
            category: "Transkrip rekaman",
            raw_content: rawTranscript,
            content: structuredTranscript + (summary ? `\n\nRingkasan:\n${summary}` : ""),
            source_type: "transcript",
          })
          .select("id")
          .single();
        if (error) throw error;
        knowledgeEntryId = entry.id;
      }
    }

    const { error: updateError } = await supabase
      .from("recordings")
      .update({
        node_id: scopeNodeId,
        raw_transcript: rawTranscript,
        structured_transcript: structuredTranscript,
        transcript: structuredTranscript,
        corrections,
        knowledge_entry_id: knowledgeEntryId,
      })
      .eq("id", recordingId);
    if (updateError) throw updateError;

    return NextResponse.json({
      rawTranscript,
      structuredTranscript,
      summary,
      corrections,
      knowledgeEntryId,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Transkripsi gagal." }, { status: 500 });
  }
}

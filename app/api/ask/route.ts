import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { geminiGenerateDetailed } from "@/lib/gemini";
import { buildKnowledgeContext, getScopeKnowledge, searchScopeKnowledge } from "@/lib/knowledge";
import { aiModeInstruction, aiQuotaError, consumeAiCredits, normalizeAiMode } from "@/lib/aiQuota";

function bearer(req: NextRequest) {
  const h = req.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

export async function POST(req: NextRequest) {
  try {
    const token = bearer(req);
    if (!token) return NextResponse.json({ error: "Belum login." }, { status: 401 });

    const { question, scopeNodeId = null, aiMode: rawAiMode = "instant", publicWeb = false } = await req.json();
    const aiMode = normalizeAiMode(rawAiMode);
    if (!question || typeof question !== "string" || question.trim().length < 3) {
      return NextResponse.json({ error: "Pertanyaan terlalu pendek." }, { status: 400 });
    }

    if (aiMode === "simple") {
      return NextResponse.json({ error: publicWeb ? "Public Web membutuhkan Gemini 3.6. Pilih Instant, Medium, atau High." : "Mode Simple diproses secara Local di perangkat dan tidak memanggil Gemini." }, { status: 400 });
    }

    const supabase = createServerSupabase(token);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return NextResponse.json({ error: "Sesi tidak valid." }, { status: 401 });
    }

    const searchLimit = aiMode === "high" ? 16 : aiMode === "medium" ? 12 : 8;
    const fallbackLimit = aiMode === "high" ? 40 : aiMode === "medium" ? 28 : 20;
    let data = await searchScopeKnowledge(supabase, question.trim(), scopeNodeId, searchLimit);

    if (!data.length) {
      data = await getScopeKnowledge(supabase, scopeNodeId, fallbackLimit);
    }

    if (!data.length && !publicWeb) {
      return NextResponse.json({
        answer: "Materi ini belum tersedia di database.",
        sources: [],
        webSources: [],
        grounded: true,
        publicWeb: false,
      });
    }

    const contextLimit = aiMode === "high" ? 42000 : aiMode === "medium" ? 32000 : 22000;
    const context = data.length ? buildKnowledgeContext(data, contextLimit) : "(Database pribadi pada scope ini kosong.)";

    const aiUsage = await consumeAiCredits(supabase, publicWeb ? "ask_web" : "ask", aiMode);
    if (!aiUsage.allowed) {
      return NextResponse.json(aiQuotaError(aiUsage), { status: 429 });
    }

    const prompt = publicWeb
      ? `PERTANYAAN:
${question.trim()}

DATABASE PRIBADI:
${context}

Mode Public Web AKTIF.
- Gunakan DATABASE PRIBADI sebagai konteks utama bila relevan.
- Anda boleh memakai Google Search untuk melengkapi atau memverifikasi informasi publik.
- Bedakan dengan jelas bila informasi berasal dari web publik.
- Jangan mengarang sumber.
${aiModeInstruction(aiMode)}
- Jawab dengan jelas dan terstruktur.`
      : `PERTANYAAN:
${question.trim()}

DATABASE:
${context}

Jawab hanya berdasarkan DATABASE di atas.
${aiModeInstruction(aiMode)}
- Jika database tidak cukup untuk menjawab pertanyaan, jawab persis: "Materi ini belum tersedia di database."
- Jangan gunakan pengetahuan umum atau internet.
- Bila ada istilah yang berbeda, utamakan istilah yang benar-benar tertulis/terdefinisi di database.
- Jawab dengan jelas dan terstruktur.`;

    const result = await geminiGenerateDetailed(
      [{ text: prompt }],
      publicWeb
        ? "Anda adalah tutor Ruang Belajar. Database pribadi tetap prioritas, tetapi Google Search boleh dipakai karena pengguna secara eksplisit mengaktifkan Public Web."
        : "Anda adalah tutor Ruang Belajar yang terikat ketat pada database yang diberikan. Jangan memakai pengetahuan eksternal.",
      { googleSearch: Boolean(publicWeb) }
    );

    return NextResponse.json({
      answer: result.text,
      sources: data.map((m) => ({ id: m.id, node_id: m.node_id, title: m.title, category: m.category })),
      webSources: result.webSources,
      grounded: true,
      publicWeb: Boolean(publicWeb),
      aiUsage,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Gagal menjawab." }, { status: 500 });
  }
}

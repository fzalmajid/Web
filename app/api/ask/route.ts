import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { geminiGenerate } from "@/lib/gemini";
import { buildKnowledgeContext, getScopeKnowledge, searchScopeKnowledge } from "@/lib/knowledge";

function bearer(req: NextRequest) {
  const h = req.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

export async function POST(req: NextRequest) {
  try {
    const token = bearer(req);
    if (!token) return NextResponse.json({ error: "Belum login." }, { status: 401 });

    const { question, scopeNodeId = null } = await req.json();
    if (!question || typeof question !== "string" || question.trim().length < 3) {
      return NextResponse.json({ error: "Pertanyaan terlalu pendek." }, { status: 400 });
    }

    const supabase = createServerSupabase(token);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return NextResponse.json({ error: "Sesi tidak valid." }, { status: 401 });
    }

    let data = await searchScopeKnowledge(supabase, question.trim(), scopeNodeId, 8);

    if (!data.length) {
      data = await getScopeKnowledge(supabase, scopeNodeId, 20);
    }

    if (!data.length) {
      return NextResponse.json({
        answer: "Materi ini belum tersedia di database.",
        sources: [],
        grounded: true,
      });
    }

    const context = buildKnowledgeContext(data, 28000);

    const answer = await geminiGenerate(
      [{
        text: `PERTANYAAN:
${question.trim()}

DATABASE:
${context}

Jawab hanya berdasarkan DATABASE di atas.
- Jika database tidak cukup untuk menjawab pertanyaan, jawab persis: "Materi ini belum tersedia di database."
- Jangan gunakan pengetahuan umum atau internet.
- Bila ada istilah yang berbeda, utamakan istilah yang benar-benar tertulis/terdefinisi di database.
- Jawab dengan jelas dan terstruktur.`,
      }],
      "Anda adalah tutor Ruang Belajar yang terikat ketat pada database yang diberikan. Jangan memakai pengetahuan eksternal."
    );

    return NextResponse.json({
      answer,
      sources: data.map((m) => ({ id: m.id, node_id: m.node_id, title: m.title, category: m.category })),
      grounded: true,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Gagal menjawab." }, { status: 500 });
  }
}

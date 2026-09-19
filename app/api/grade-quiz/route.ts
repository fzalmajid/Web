import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { cleanJsonText, geminiGenerate } from "@/lib/gemini";
import { buildKnowledgeContext, getScopeKnowledge } from "@/lib/knowledge";
import { aiModeInstruction, aiQuotaError, consumeAiCredits, normalizeAiMode } from "@/lib/aiQuota";

function bearer(req: NextRequest) {
  const h = req.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

export async function POST(req: NextRequest) {
  try {
    const token = bearer(req);
    if (!token) return NextResponse.json({ error: "Belum login." }, { status: 401 });

    const body = await req.json();
    const quizId = String(body.quizId || "");
    const answer = String(body.answer || "").trim();
    const aiMode = normalizeAiMode(body.aiMode);

    if (!quizId || !answer) {
      return NextResponse.json({ error: "Jawaban belum diisi." }, { status: 400 });
    }
    if (aiMode === "simple") {
      return NextResponse.json({
        error: "Penilaian essay membutuhkan Gemini 3.6. Pilih Instant, Medium, atau High."
      }, { status: 400 });
    }

    const supabase = createServerSupabase(token);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return NextResponse.json({ error: "Sesi tidak valid." }, { status: 401 });
    }

    const { data: quiz, error: quizError } = await supabase
      .from("quizzes")
      .select("id,question,scope_node_id,quiz_type,grading_mode")
      .eq("id", quizId)
      .single();

    if (quizError || !quiz) {
      return NextResponse.json({ error: "Soal tidak ditemukan." }, { status: 404 });
    }
    if (quiz.quiz_type !== "essay" || quiz.grading_mode !== "ai") {
      return NextResponse.json({ error: "Soal ini bukan essay AI." }, { status: 400 });
    }

    const { data: quizNode, error: nodeError } = await supabase
      .from("study_nodes")
      .select("id,parent_id")
      .eq("id", quiz.scope_node_id)
      .single();

    if (nodeError || !quizNode) {
      return NextResponse.json({ error: "Konteks kuis tidak ditemukan." }, { status: 404 });
    }

    const knowledge = await getScopeKnowledge(supabase, quizNode.parent_id, aiMode === "high" ? 60 : aiMode === "medium" ? 48 : 32);
    if (!knowledge.length) {
      return NextResponse.json({ error: "Database sumber kuis masih kosong." }, { status: 400 });
    }

    const aiUsage = await consumeAiCredits(supabase, "study", aiMode);
    if (!aiUsage.allowed) {
      return NextResponse.json(aiQuotaError(aiUsage), { status: 429 });
    }

    const context = buildKnowledgeContext(
      knowledge,
      aiMode === "high" ? 46000 : aiMode === "medium" ? 36000 : 24000
    );

    const raw = await geminiGenerate([{
      text: `PERTANYAAN:
${quiz.question}

JAWABAN PESERTA:
${answer}

DATABASE SUMBER:
${context}

Nilai jawaban peserta HANYA berdasarkan DATABASE SUMBER.
${aiModeInstruction(aiMode)}

Keluarkan JSON valid tanpa markdown:
{
  "gradable": true,
  "correct": true,
  "score": 0,
  "feedback": "...",
  "basis": "..."
}

Aturan:
- score angka 0-100.
- correct=true hanya bila inti jawaban sudah benar berdasarkan database.
- Jawaban sebagian benar boleh diberi score parsial tetapi correct=false bila inti masih kurang/keliru.
- Jangan menggunakan pengetahuan umum atau internet.
- Jika database tidak cukup untuk menilai, gradable=false, correct=false, score=0 dan jelaskan kekurangan sumber di feedback.
- basis harus singkat, menyebut dasar dari database tanpa mengarang kutipan.`
    }], "Anda adalah penilai kuis yang ketat dan hanya boleh memakai database yang diberikan.");

    const parsed = JSON.parse(cleanJsonText(raw));
    return NextResponse.json({
      gradable: parsed.gradable !== false,
      correct: parsed.correct === true,
      score: Math.max(0, Math.min(100, Number(parsed.score || 0))),
      feedback: String(parsed.feedback || "").trim(),
      basis: String(parsed.basis || "").trim(),
      aiUsage,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Gagal menilai jawaban." }, { status: 500 });
  }
}

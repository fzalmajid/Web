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
    const aiMode = normalizeAiMode(body.aiMode);
    const items = Array.isArray(body.answers)
      ? body.answers
          .map((item: any) => ({
            quizId: String(item.quizId || ""),
            answer: String(item.answer || "").trim(),
          }))
          .filter((item: any) => item.quizId && item.answer)
      : [{
          quizId: String(body.quizId || ""),
          answer: String(body.answer || "").trim(),
        }].filter((item) => item.quizId && item.answer);

    if (!items.length) {
      return NextResponse.json({ error: "Jawaban essay belum diisi." }, { status: 400 });
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

    const ids = items.map((item: any) => item.quizId);
    const { data: quizzes, error: quizError } = await supabase
      .from("quizzes")
      .select("id,question,scope_node_id,quiz_type,grading_mode")
      .in("id", ids);

    if (quizError || !quizzes || quizzes.length !== ids.length) {
      return NextResponse.json({ error: "Ada soal essay yang tidak ditemukan." }, { status: 404 });
    }
    if (quizzes.some((quiz: any) => quiz.quiz_type !== "essay" || quiz.grading_mode !== "ai")) {
      return NextResponse.json({ error: "Ada soal yang bukan essay AI." }, { status: 400 });
    }

    const scopeIds = Array.from(new Set(quizzes.map((quiz: any) => quiz.scope_node_id).filter(Boolean)));
    if (scopeIds.length !== 1) {
      return NextResponse.json({ error: "Soal essay harus berasal dari satu halaman kuis yang sama." }, { status: 400 });
    }

    const { data: quizNode, error: nodeError } = await supabase
      .from("study_nodes")
      .select("id,parent_id")
      .eq("id", scopeIds[0])
      .single();

    if (nodeError || !quizNode) {
      return NextResponse.json({ error: "Konteks kuis tidak ditemukan." }, { status: 404 });
    }

    const knowledge = await getScopeKnowledge(
      supabase,
      quizNode.parent_id,
      aiMode === "high" ? 60 : aiMode === "medium" ? 48 : 32
    );
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

    const qa = quizzes.map((quiz: any) => {
      const found = items.find((item: any) => item.quizId === quiz.id);
      return {
        id: quiz.id,
        question: quiz.question,
        answer: found?.answer || "",
      };
    });

    const raw = await geminiGenerate([{
      text: `SOAL DAN JAWABAN PESERTA:
${JSON.stringify(qa, null, 2)}

DATABASE SUMBER:
${context}

Nilai setiap jawaban HANYA berdasarkan DATABASE SUMBER.
${aiModeInstruction(aiMode)}

Keluarkan JSON valid tanpa markdown:
{
  "results": [
    {
      "id": "uuid-soal",
      "gradable": true,
      "correct": true,
      "score": 0,
      "feedback": "...",
      "basis": "..."
    }
  ]
}

Aturan:
- Harus ada tepat satu result untuk setiap id soal.
- score angka 0-100.
- correct=true hanya bila inti jawaban sudah benar berdasarkan database.
- Jawaban sebagian benar boleh diberi score parsial tetapi correct=false bila inti masih kurang/keliru.
- Jangan menggunakan pengetahuan umum atau internet.
- Jika database tidak cukup untuk menilai suatu soal, gradable=false, correct=false, score=0 dan jelaskan kekurangan sumber di feedback.
- basis harus singkat dan menyebut dasar dari database tanpa mengarang kutipan.`
    }], "Anda adalah penilai kuis yang ketat dan hanya boleh memakai database yang diberikan.");

    const parsed = JSON.parse(cleanJsonText(raw));
    const rawResults = Array.isArray(parsed.results) ? parsed.results : [];
    const results = qa.map((item) => {
      const result = rawResults.find((row: any) => String(row.id) === item.id) || {};
      return {
        id: item.id,
        gradable: result.gradable !== false,
        correct: result.correct === true,
        score: Math.max(0, Math.min(100, Number(result.score || 0))),
        feedback: String(result.feedback || "").trim(),
        basis: String(result.basis || "").trim(),
      };
    });

    return NextResponse.json({ results, aiUsage });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Gagal menilai jawaban." }, { status: 500 });
  }
}

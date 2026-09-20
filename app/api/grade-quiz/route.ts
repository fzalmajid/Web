import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { cleanJsonText, geminiGenerateDetailed, WHATSAPP_FORMAT_INSTRUCTION } from "@/lib/gemini";
import { buildKnowledgeContext, getScopeKnowledge } from "@/lib/knowledge";
import { modelPlanForSelection, selectionFromHeaders } from "@/lib/aiModels";
import { geminiUserAuthFromHeaders } from "@/lib/geminiUserAuth";
import { aiModeInstruction, aiQuotaError, checkAiCredits, finalizeAiCredits, normalizeAiMode, recordAiTokenUsage } from "@/lib/aiQuota";

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
    const aiSelection = selectionFromHeaders(req.headers, "general", aiMode);
    const geminiAuth = geminiUserAuthFromHeaders(req.headers);
    const ownGemini = geminiAuth.ownGemini;
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
      return NextResponse.json({ error: "Jawaban kuis AI belum diisi." }, { status: 400 });
    }
    if (aiMode === "simple") {
      return NextResponse.json({
        error: "Penilaian AI membutuhkan model Gemini. Pilih salah satu model Gemini."
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
      .select("id,question,choices,correct_answer,scope_node_id,quiz_type,grading_mode")
      .in("id", ids);

    if (quizError || !quizzes || quizzes.length !== ids.length) {
      return NextResponse.json({ error: "Ada soal AI yang tidak ditemukan." }, { status: 404 });
    }
    if (quizzes.some((quiz: any) => quiz.grading_mode !== "ai" && quiz.quiz_type !== "essay")) {
      return NextResponse.json({ error: "Ada soal pilihan ganda yang bukan mode dinilai AI." }, { status: 400 });
    }

    const scopeIds = Array.from(new Set(quizzes.map((quiz: any) => quiz.scope_node_id).filter(Boolean)));
    if (scopeIds.length !== 1) {
      return NextResponse.json({ error: "Soal AI harus berasal dari satu halaman kuis yang sama." }, { status: 400 });
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

    const preflight = ownGemini ? null : await checkAiCredits(supabase, "study", aiMode);
    if (preflight && !preflight.allowed) {
      return NextResponse.json(aiQuotaError(preflight), { status: 429 });
    }

    const context = buildKnowledgeContext(
      knowledge,
      aiMode === "high" ? 46000 : aiMode === "medium" ? 36000 : 24000
    );

    const qa = quizzes.map((quiz: any) => {
      const found = items.find((item: any) => item.quizId === quiz.id);
      return {
        id: quiz.id,
        quiz_type: quiz.quiz_type,
        question: quiz.question,
        choices: Array.isArray(quiz.choices) ? quiz.choices : [],
        reference_answer: String(quiz.correct_answer || "").trim(),
        grading_mode: quiz.grading_mode,
        answer: found?.answer || "",
      };
    });

    const geminiResult = await geminiGenerateDetailed([{
      text: `SOAL DAN JAWABAN PESERTA:
${JSON.stringify(qa, null, 2)}

DATABASE SUMBER:
${context}

Nilai setiap jawaban berdasarkan DATABASE SUMBER dan konteks pertanyaan. Untuk essay, reference_answer hanya REFERENSI makna/rubrik, bukan teks yang harus disalin persis.
${aiModeInstruction(aiMode)}

Keluarkan JSON valid tanpa markdown:
{
  "results": [
    {
      "id": "uuid-soal",
      "gradable": true,
      "verdict": "benar",
      "correct": true,
      "score": 100,
      "feedback": "...",
      "basis": "..."
    }
  ]
}

Aturan:
- Harus ada tepat satu result untuk setiap id soal.
- verdict hanya boleh: "benar", "kurang_tepat", atau "salah".
- score angka 0-100.
- Jika verdict="benar", score=100 dan correct=true.
- Jika verdict="kurang_tepat", correct=false dan score 1-99 sesuai seberapa banyak konsep yang benar.
- Jika verdict="salah", correct=false dan score=0.
- Untuk quiz_type="mcq": nilai pilihan yang dipilih peserta berdasarkan Database. Pilihan benar = verdict="benar", score=100. Pilihan salah = verdict="salah", score=0.
- Untuk quiz_type="essay": nilai MAKNA dan KETEPATAN KONSEP, bukan kemiripan kata. Parafrasa, sinonim, urutan kalimat berbeda, atau gaya bahasa berbeda tetap harus dinilai benar bila maknanya setara dan inti jawaban terpenuhi.
- reference_answer boleh membantu memahami jawaban ideal, tetapi JANGAN menjadikannya exact-match. Cocokkan kembali dengan pertanyaan dan Database.
- Jika jawaban hanya memuat sebagian konsep yang benar, kehilangan bagian penting, terlalu umum, atau mencampur konsep benar dengan kekeliruan material: verdict="kurang_tepat" dan jelaskan singkat apa yang kurang.
- Jangan menggunakan pengetahuan umum atau internet.
- Jika database tidak cukup untuk menilai suatu soal, gradable=false, verdict="salah", correct=false, score=0 dan jelaskan kekurangan sumber di feedback.
- basis harus singkat dan menyebut dasar dari database tanpa mengarang kutipan.
- ${WHATSAPP_FORMAT_INSTRUCTION}`
    }], "Anda adalah penilai kuis yang adil secara semantik. Nilai kebenaran konsep, bukan kecocokan kata-per-kata, dan hanya gunakan database yang diberikan.", {
      models: modelPlanForSelection(aiSelection.model, aiMode, "standard"),
      effort: aiSelection.effort,
      apiKey: geminiAuth.apiKey,
      accessToken: geminiAuth.accessToken,
      projectId: geminiAuth.projectId,
    });
    await recordAiTokenUsage(supabase, geminiResult.usage, geminiResult.model, geminiAuth.provider);
    const raw = geminiResult.text;

    const parsed = JSON.parse(cleanJsonText(raw));
    const rawResults = Array.isArray(parsed.results) ? parsed.results : [];
    const results = qa.map((item) => {
      const result = rawResults.find((row: any) => String(row.id) === item.id) || {};
      const gradable = result.gradable !== false;
      const rawScore = Math.max(0, Math.min(100, Number(result.score || 0)));
      const rawVerdict = String(result.verdict || "").trim().toLowerCase();
      const verdict = !gradable
        ? "tidak_dapat_dinilai"
        : rawVerdict === "benar" || result.correct === true
          ? "benar"
          : rawVerdict === "kurang_tepat" || rawScore > 0
            ? "kurang_tepat"
            : "salah";
      const score = verdict === "benar" ? 100 : verdict === "salah" ? 0 : Math.max(1, Math.min(99, rawScore));
      return {
        id: item.id,
        gradable,
        verdict,
        correct: verdict === "benar",
        score,
        feedback: String(result.feedback || "").trim(),
        basis: String(result.basis || "").trim(),
      };
    });

    const aiUsage = ownGemini ? null : await finalizeAiCredits(supabase, "study", aiMode);
    return NextResponse.json({
      results,
      aiUsage,
      model: geminiResult.model,
      provider: geminiAuth.provider,
    });
  } catch (error: any) {
    const status = Number(error?.statusCode || 500);
    console.error("[API_GRADE_QUIZ_ERROR]", { name: error?.name, code: error?.code, status });
    return NextResponse.json(
      { error: error?.message || "Gagal menilai jawaban." },
      { status: status >= 400 && status < 600 ? status : 500 }
    );
  }
}

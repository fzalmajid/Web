import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { cleanJsonText, geminiGenerateDetailed, WHATSAPP_FORMAT_INSTRUCTION } from "@/lib/gemini";
import { buildKnowledgeContext, getScopeKnowledge } from "@/lib/knowledge";
import { modelPlanForSelection, selectionFromHeaders } from "@/lib/aiModels";
import { geminiUserAuthFromHeaders } from "@/lib/geminiUserAuth";
import { aiQuotaError, checkAiCredits, finalizeAiCredits, normalizeAiMode, recordAiTokenUsage } from "@/lib/aiQuota";

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

    const hasEssay = quizzes.some((quiz: any) => quiz.quiz_type === "essay");
    const gradingAction = hasEssay ? "grade_essay" as const : "study" as const;

    // Essay grading only needs enough source context to judge correctness,
    // not the full Study-generation context.
    const knowledge = await getScopeKnowledge(
      supabase,
      quizNode.parent_id,
      hasEssay
        ? aiMode === "high" ? 36 : aiMode === "medium" ? 28 : 20
        : aiMode === "high" ? 60 : aiMode === "medium" ? 48 : 32
    );
    if (!knowledge.length) {
      return NextResponse.json({ error: "Database sumber kuis masih kosong." }, { status: 400 });
    }

    const preflight = ownGemini ? null : await checkAiCredits(supabase, gradingAction, aiMode);
    if (preflight && !preflight.allowed) {
      return NextResponse.json(aiQuotaError(preflight), { status: 429 });
    }

    const context = buildKnowledgeContext(
      knowledge,
      hasEssay
        ? aiMode === "high" ? 28000 : aiMode === "medium" ? 22000 : 15000
        : aiMode === "high" ? 46000 : aiMode === "medium" ? 36000 : 24000
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
Penilaian harus efisien: pikirkan secukupnya untuk menentukan level nilai dengan benar, tetapi jangan membuat analisis panjang.\n\nKeluarkan JSON valid tanpa markdown:
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
- verdict hanya boleh: "benar", "hampir_benar", "benar_sebagian", "benar_sedikit", atau "salah".
- score WAJIB salah satu dari: 0, 25, 50, 70, 100. Jangan keluarkan angka lain.
- Skala penilaian essay:
  * 0/100 = salah: inti jawaban salah/tidak menjawab konsep yang diminta.
  * 25/100 = benar sedikit: ada sedikit bagian/fragmen konsep yang benar, tetapi mayoritas jawaban masih salah atau belum menjawab inti.
  * 50/100 = benar sebagian: sebagian konsep penting sudah benar, tetapi masih ada bagian penting yang hilang atau keliru.
  * 70/100 = hampir benar: inti dan mayoritas konsep sudah benar, hanya ada kekurangan/kekeliruan kecil tetapi material.
  * 100/100 = benar: konsep yang diminta terpenuhi secara benar dan memadai; parafrasa atau susunan kata berbeda tetap benar.
- correct=true HANYA untuk score=100 / verdict="benar". Semua level di bawah 100 menggunakan correct=false.
- Untuk quiz_type="mcq": hanya gunakan 0 atau 100. Pilihan benar = verdict="benar", score=100. Pilihan salah = verdict="salah", score=0.
- Untuk quiz_type="essay": nilai MAKNA dan KETEPATAN KONSEP, bukan kemiripan kata. Parafrasa, sinonim, urutan kalimat berbeda, atau gaya bahasa berbeda tetap harus dinilai 100 bila maknanya setara dan inti jawaban terpenuhi.
- reference_answer boleh membantu memahami jawaban ideal, tetapi JANGAN menjadikannya exact-match. Cocokkan kembali dengan pertanyaan dan Database.
- Feedback MAKSIMAL 1 kalimat pendek. Sebutkan hanya alasan utama nilai dan kekurangan terpenting bila belum 100.
- basis MAKSIMAL 12 kata. Jangan mengulang pertanyaan atau jawaban peserta.
- Jangan menggunakan pengetahuan umum atau internet.
- Jika database tidak cukup untuk menilai suatu soal, gradable=false, verdict="salah", correct=false, score=0 dan jelaskan kekurangan sumber di feedback.
- basis harus singkat dan menyebut dasar dari database tanpa mengarang kutipan.
- ${WHATSAPP_FORMAT_INSTRUCTION}`
    }], "Anda adalah penilai kuis yang adil secara semantik. Nilai kebenaran konsep, bukan kecocokan kata-per-kata, dan hanya gunakan database yang diberikan.", {
      models: modelPlanForSelection(aiSelection.model, aiMode, "standard"),
      effort: aiSelection.effort,
      responseLength: hasEssay ? "short" : aiSelection.length,
      maxOutputTokens: hasEssay
        ? Math.min(2400, Math.max(1200, 500 + qa.length * 160))
        : undefined,
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

      let verdict:
        | "benar"
        | "hampir_benar"
        | "benar_sebagian"
        | "benar_sedikit"
        | "salah"
        | "tidak_dapat_dinilai";
      let score: 0 | 25 | 50 | 70 | 100;

      if (!gradable) {
        verdict = "tidak_dapat_dinilai";
        score = 0;
      } else if (item.quiz_type === "mcq") {
        const isCorrect = rawVerdict === "benar" || result.correct === true || rawScore === 100;
        verdict = isCorrect ? "benar" : "salah";
        score = isCorrect ? 100 : 0;
      } else if (rawVerdict === "benar") {
        verdict = "benar";
        score = 100;
      } else if (rawVerdict === "hampir_benar") {
        verdict = "hampir_benar";
        score = 70;
      } else if (rawVerdict === "benar_sebagian") {
        verdict = "benar_sebagian";
        score = 50;
      } else if (rawVerdict === "benar_sedikit") {
        verdict = "benar_sedikit";
        score = 25;
      } else if (rawVerdict === "salah") {
        verdict = "salah";
        score = 0;
      } else {
        // Fallback defensif bila model mengirim angka bebas / verdict lama.
        // Semua skor tetap dipaksa masuk ke lima kategori resmi.
        if (rawScore >= 85 && result.correct === true) {
          verdict = "benar";
          score = 100;
        } else if (rawScore >= 60) {
          verdict = "hampir_benar";
          score = 70;
        } else if (rawScore >= 38) {
          verdict = "benar_sebagian";
          score = 50;
        } else if (rawScore > 0) {
          verdict = "benar_sedikit";
          score = 25;
        } else {
          verdict = "salah";
          score = 0;
        }
      }

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

    const aiUsage = ownGemini ? null : await finalizeAiCredits(supabase, gradingAction, aiMode);
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

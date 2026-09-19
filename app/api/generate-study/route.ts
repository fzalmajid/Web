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
    const sourceNodeId = String(body.sourceNodeId || body.scopeNodeId || "");
    const targetNodeId = String(body.targetNodeId || sourceNodeId || "");
    const mode = body.mode === "flashcards" || body.mode === "quiz" ? body.mode : "both";
    const aiMode = normalizeAiMode(body.aiMode);

    if (aiMode === "simple") {
      return NextResponse.json({ error: "Mode Simple diproses secara Local di perangkat dan tidak memanggil Gemini." }, { status: 400 });
    }

    if (!sourceNodeId || !targetNodeId) {
      return NextResponse.json({ error: "Scope materi belum dipilih." }, { status: 400 });
    }

    const supabase = createServerSupabase(token);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return NextResponse.json({ error: "Sesi tidak valid." }, { status: 401 });
    }

    const { data: target, error: targetError } = await supabase
      .from("study_nodes")
      .select("id,node_type")
      .eq("id", targetNodeId)
      .single();
    if (targetError || !target) {
      return NextResponse.json({ error: "Cabang tujuan tidak ditemukan." }, { status: 404 });
    }

    const sourceLimit = aiMode === "high" ? 60 : aiMode === "medium" ? 48 : 32;
    const sources = await getScopeKnowledge(supabase, sourceNodeId, sourceLimit);
    if (!sources.length) {
      return NextResponse.json({ error: "Database pada sumber materi ini masih kosong." }, { status: 400 });
    }

    const context = buildKnowledgeContext(sources, aiMode === "high" ? 46000 : aiMode === "medium" ? 36000 : 24000);

    const aiUsage = await consumeAiCredits(supabase, "study", aiMode);
    if (!aiUsage.allowed) {
      return NextResponse.json(aiQuotaError(aiUsage), { status: 429 });
    }

    const counts = aiMode === "high" ? { cards: 8, quiz: 5 } : aiMode === "medium" ? { cards: 6, quiz: 4 } : { cards: 4, quiz: 3 };
    const requested = mode === "flashcards"
      ? "Buat flashcards saja. quizzes harus berupa array kosong."
      : mode === "quiz"
        ? "Buat quizzes saja. flashcards harus berupa array kosong."
        : "Buat flashcards dan quizzes.";

    const raw = await geminiGenerate([{
      text: `Gunakan HANYA DATABASE berikut:

${context}

${requested}\n${aiModeInstruction(aiMode)}\n\nKeluarkan JSON valid tanpa markdown:
{
  "flashcards":[{"front":"...","back":"..."}],
  "quizzes":[{"question":"...","choices":["A","B","C","D"],"correct_answer":"...","explanation":"..."}]
}

Maksimal ${counts.cards} flashcard dan ${counts.quiz} soal. Semua pertanyaan, jawaban, dan penjelasan wajib dapat dibuktikan dari DATABASE.`,
    }], "Jangan gunakan pengetahuan di luar database yang diberikan.");

    const parsed = JSON.parse(cleanJsonText(raw));
    const uid = userData.user.id;

    const flashcards = mode === "quiz" ? [] : Array.isArray(parsed.flashcards)
      ? parsed.flashcards.slice(0, counts.cards).map((x: any) => ({
          front: String(x.front || "").trim(),
          back: String(x.back || "").trim(),
        })).filter((x: any) => x.front && x.back)
      : [];

    const quizzes = mode === "flashcards" ? [] : Array.isArray(parsed.quizzes)
      ? parsed.quizzes.slice(0, counts.quiz).map((x: any) => {
          const choices = Array.isArray(x.choices) ? x.choices.slice(0, 4).map((v: any) => String(v).trim()).filter(Boolean) : [];
          return {
            question: String(x.question || "").trim(),
            choices,
            correct_answer: String(x.correct_answer || "").trim(),
            explanation: String(x.explanation || "").trim(),
          };
        }).filter((x: any) => x.question && x.choices.length >= 2 && x.choices.includes(x.correct_answer))
      : [];

    if (flashcards.length) {
      const { error } = await supabase.from("flashcards").insert(
        flashcards.map((x:any) => ({
          user_id: uid,
          material_id: null,
          scope_node_id: targetNodeId,
          front: x.front,
          back: x.back,
        }))
      );
      if (error) throw error;
    }

    if (quizzes.length) {
      const { error } = await supabase.from("quizzes").insert(
        quizzes.map((x:any) => ({
          user_id: uid,
          material_id: null,
          scope_node_id: targetNodeId,
          question: x.question,
          choices: x.choices,
          correct_answer: x.correct_answer,
          explanation: x.explanation,
        }))
      );
      if (error) throw error;
    }

    return NextResponse.json({ flashcards: flashcards.length, quizzes: quizzes.length, aiUsage });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Gagal membuat latihan." }, { status: 500 });
  }
}

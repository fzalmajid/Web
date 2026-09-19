import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { cleanJsonText, geminiGenerate } from "@/lib/gemini";
import { buildKnowledgeContext, getScopeKnowledge } from "@/lib/knowledge";

function bearer(req: NextRequest) {
  const h = req.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

export async function POST(req: NextRequest) {
  try {
    const token = bearer(req);
    if (!token) return NextResponse.json({ error: "Belum login." }, { status: 401 });

    const { scopeNodeId } = await req.json();
    if (!scopeNodeId) return NextResponse.json({ error: "Scope materi belum dipilih." }, { status: 400 });

    const supabase = createServerSupabase(token);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return NextResponse.json({ error: "Sesi tidak valid." }, { status: 401 });
    }

    const sources = await getScopeKnowledge(supabase, String(scopeNodeId), 40);
    if (!sources.length) {
      return NextResponse.json({ error: "Database pada materi ini masih kosong." }, { status: 400 });
    }

    const context = buildKnowledgeContext(sources, 30000);
    const raw = await geminiGenerate([{
      text: `Gunakan HANYA DATABASE berikut:

${context}

Buat JSON valid tanpa markdown:
{
  "flashcards":[{"front":"...","back":"..."}],
  "quizzes":[{"question":"...","choices":["A","B","C","D"],"correct_answer":"...","explanation":"..."}]
}

Buat maksimal 5 flashcard dan 3 soal. Semua pertanyaan, jawaban, dan penjelasan wajib dapat dibuktikan dari DATABASE.`,
    }], "Jangan gunakan pengetahuan di luar database yang diberikan.");

    const parsed = JSON.parse(cleanJsonText(raw));
    const uid = userData.user.id;

    const flashcards = Array.isArray(parsed.flashcards)
      ? parsed.flashcards.slice(0, 5).map((x: any) => ({
          front: String(x.front || "").trim(),
          back: String(x.back || "").trim(),
        })).filter((x: any) => x.front && x.back)
      : [];

    const quizzes = Array.isArray(parsed.quizzes)
      ? parsed.quizzes.slice(0, 3).map((x: any) => {
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
          scope_node_id: scopeNodeId,
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
          scope_node_id: scopeNodeId,
          question: x.question,
          choices: x.choices,
          correct_answer: x.correct_answer,
          explanation: x.explanation,
        }))
      );
      if (error) throw error;
    }

    return NextResponse.json({ flashcards: flashcards.length, quizzes: quizzes.length });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Gagal membuat latihan." }, { status: 500 });
  }
}

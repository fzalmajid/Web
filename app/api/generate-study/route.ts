import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { cleanJsonText, geminiGenerate } from "@/lib/gemini";

function bearer(req: NextRequest) {
  const h = req.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

export async function POST(req: NextRequest) {
  try {
    const token = bearer(req);
    if (!token) return NextResponse.json({ error: "Belum login." }, { status: 401 });
    const { materialId } = await req.json();
    if (!materialId) return NextResponse.json({ error: "Materi belum dipilih." }, { status: 400 });

    const supabase = createServerSupabase(token);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return NextResponse.json({ error: "Sesi tidak valid." }, { status: 401 });
    }

    const { data: material, error } = await supabase
      .from("materials")
      .select("id,title,content")
      .eq("id", materialId)
      .single();
    if (error || !material) {
      return NextResponse.json({ error: "Materi tidak ditemukan." }, { status: 404 });
    }

    const raw = await geminiGenerate([{
      text: `Gunakan HANYA materi berikut:\n\nJUDUL: ${material.title}\n${material.content}\n\nBuat JSON valid tanpa markdown dengan bentuk:
{"flashcards":[{"front":"...","back":"..."}],"quizzes":[{"question":"...","choices":["A","B","C","D"],"correct_answer":"...","explanation":"..."}]}
Buat maksimal 5 flashcard dan 3 soal. Semua jawaban wajib berasal dari materi.`,
    }], "Jangan gunakan pengetahuan di luar materi yang diberikan.");

    const parsed = JSON.parse(cleanJsonText(raw));
    const uid = userData.user.id;

    const flashcards = Array.isArray(parsed.flashcards) ? parsed.flashcards.slice(0,5) : [];
    const quizzes = Array.isArray(parsed.quizzes) ? parsed.quizzes.slice(0,3) : [];

    if (flashcards.length) {
      const { error: e } = await supabase.from("flashcards").insert(
        flashcards.map((x:any) => ({
          user_id: uid, material_id: material.id, front: String(x.front||""), back: String(x.back||"")
        }))
      );
      if (e) throw e;
    }
    if (quizzes.length) {
      const { error: e } = await supabase.from("quizzes").insert(
        quizzes.map((x:any) => ({
          user_id: uid,
          material_id: material.id,
          question: String(x.question||""),
          choices: Array.isArray(x.choices) ? x.choices.slice(0,4).map(String) : [],
          correct_answer: String(x.correct_answer||""),
          explanation: String(x.explanation||"")
        }))
      );
      if (e) throw e;
    }

    return NextResponse.json({ flashcards: flashcards.length, quizzes: quizzes.length });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Gagal membuat latihan." }, { status: 500 });
  }
}

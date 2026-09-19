import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { geminiGenerate } from "@/lib/gemini";

function bearer(req: NextRequest) {
  const h = req.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

export async function POST(req: NextRequest) {
  try {
    const token = bearer(req);
    if (!token) return NextResponse.json({ error: "Belum login." }, { status: 401 });

    const { question } = await req.json();
    if (!question || typeof question !== "string" || question.trim().length < 3) {
      return NextResponse.json({ error: "Pertanyaan terlalu pendek." }, { status: 400 });
    }

    const supabase = createServerSupabase(token);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return NextResponse.json({ error: "Sesi tidak valid." }, { status: 401 });
    }

    const { data, error } = await supabase.rpc("search_materials", {
      search_query: question.trim(),
      result_limit: 5,
    });
    if (error) throw error;
    if (!data?.length) {
      return NextResponse.json({
        answer: "Materi ini belum tersedia di database.",
        sources: [],
        grounded: true,
      });
    }

    const context = data
      .map((m: any, i: number) => `[SUMBER ${i + 1}] ${m.title}\nKategori: ${m.category}\n${m.content}`)
      .join("\n\n");

    const answer = await geminiGenerate(
      [{
        text: `PERTANYAAN:\n${question.trim()}\n\nDATABASE:\n${context}\n\nJawab hanya berdasarkan DATABASE di atas. Jika isi database tidak cukup untuk menjawab bagian tertentu, katakan bagian itu tidak tersedia. Jangan menambahkan fakta dari pengetahuan umum.`,
      }],
      "Anda adalah tutor Ruang Belajar. Anda hanya boleh menggunakan materi yang diberikan sebagai DATABASE. Jangan memakai pengetahuan eksternal."
    );

    return NextResponse.json({
      answer,
      sources: data.map((m: any) => ({ id: m.id, title: m.title, category: m.category })),
      grounded: true,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Gagal menjawab." }, { status: 500 });
  }
}

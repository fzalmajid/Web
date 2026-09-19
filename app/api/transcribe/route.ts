import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { geminiGenerate } from "@/lib/gemini";

function bearer(req: NextRequest) {
  const h = req.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const token = bearer(req);
    if (!token) return NextResponse.json({ error: "Belum login." }, { status: 401 });
    const supabase = createServerSupabase(token);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return NextResponse.json({ error: "Sesi tidak valid." }, { status: 401 });
    }

    const form = await req.formData();
    const file = form.get("audio");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "File audio tidak ditemukan." }, { status: 400 });
    }
    if (file.size > 15 * 1024 * 1024) {
      return NextResponse.json({ error: "Rekaman maksimal 15 MB untuk versi awal." }, { status: 413 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const base64 = bytes.toString("base64");
    const mimeType = file.type || "audio/webm";

    const transcript = await geminiGenerate([
      { text: "Transkripsikan audio berikut secara lengkap ke Bahasa Indonesia sesuai ucapan. Jangan merangkum dan jangan menambahkan isi yang tidak terdengar. Keluarkan teks transkrip saja." },
      { inlineData: { mimeType, data: base64 } },
    ]);

    return NextResponse.json({ transcript });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Transkripsi gagal." }, { status: 500 });
  }
}

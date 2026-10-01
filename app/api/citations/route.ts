import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { processLibraryCitations, type ProcessorStyle } from "@/lib/citationFormatterServer";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Reads only the user's Library. Client-supplied bibliographic values are ignored. */
export async function POST(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "") || "";
  if (!req.headers.get("authorization")?.startsWith("Bearer ") || !token) {
    return NextResponse.json({ error: "Belum login ke Ruang Belajar." }, { status: 401 });
  }
  try {
    const supabase = createServerSupabase(token);
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return NextResponse.json({ error: "Sesi tidak valid." }, { status: 401 });
    const body = await req.json();
    const style = String(body?.style || "apa") as ProcessorStyle;
    if (!["apa", "vancouver", "mla", "harvard", "ieee", "chicago"].includes(style)) {
      return NextResponse.json({ error: "Gaya sitasi tidak didukung." }, { status: 400 });
    }
    const ids: string[] = [...new Set<string>((Array.isArray(body?.sourceFileIds) ? body.sourceFileIds : []).map(String))];
    if (!ids.length || ids.length > 100 || ids.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) {
      return NextResponse.json({ error: "Pilih 1–100 file Library yang valid." }, { status: 400 });
    }
    const { data, error } = await supabase.from("source_files")
      .select("id,bibliographic_metadata").eq("user_id", auth.user.id).in("id", ids);
    if (error) throw error;
    const files = new Map((data || []).map((file) => [file.id, file]));
    if (files.size !== ids.length) return NextResponse.json({ error: "File tidak ditemukan di Library Anda." }, { status: 404 });
    const result = processLibraryCitations(ids.map((id) => ({
      id, metadata: files.get(id)!.bibliographic_metadata || {},
    })), style);
    return NextResponse.json({ style, ...result, warning: result.excluded.length
      ? "File yang belum terverifikasi/perlu ditinjau tidak dimasukkan. Jalankan audit metadata." : null },
    { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Gagal memproses sitasi Library." }, { status: 500 });
  }
}

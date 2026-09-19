import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";

function bearer(req: NextRequest) {
  const h = req.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

export async function GET(req: NextRequest) {
  try {
    const token = bearer(req);
    if (!token) return NextResponse.json({ error: "Belum login." }, { status: 401 });

    const supabase = createServerSupabase(token);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) return NextResponse.json({ error: "Sesi tidak valid." }, { status: 401 });

    const key = String(process.env.GEMINI_API_KEY || "").trim();
    if (!key) return NextResponse.json({ error: "Gemini shared belum dikonfigurasi." }, { status: 503 });

    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", {
      headers: { "x-goog-api-key": key },
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return NextResponse.json({ error: "Daftar model Gemini shared belum dapat dimuat." }, { status: 502 });
    }

    const models = Array.isArray(data?.models)
      ? data.models
          .map((model: any) => ({
            id: String(model?.name || "").replace(/^models\//, ""),
            methods: Array.isArray(model?.supportedGenerationMethods)
              ? model.supportedGenerationMethods.map(String)
              : [],
          }))
          .filter((model: any) => model.id && model.methods.includes("generateContent"))
      : [];

    return NextResponse.json({ models });
  } catch {
    return NextResponse.json({ error: "Daftar model Gemini shared belum dapat dimuat." }, { status: 500 });
  }
}

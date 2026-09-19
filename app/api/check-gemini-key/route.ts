import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";

function bearer(req: NextRequest) {
  const h = req.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

export async function POST(req: NextRequest) {
  try {
    const token = bearer(req);
    if (!token) return NextResponse.json({ error: "Belum login." }, { status: 401 });

    const supabase = createServerSupabase(token);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return NextResponse.json({ error: "Sesi tidak valid." }, { status: 401 });
    }

    const key = String(req.headers.get("x-rb-gemini-key") || "").trim();
    if (!key) {
      return NextResponse.json({ error: "Masukkan Gemini API key." }, { status: 400 });
    }

    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
      headers: { "x-goog-api-key": key },
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const providerMessage = String(data?.error?.message || "");
      const invalid = response.status === 400 || response.status === 401 || response.status === 403;
      return NextResponse.json(
        {
          error: invalid
            ? "API key tidak valid atau project belum mengizinkan Gemini API."
            : /quota|rate.?limit|resource.?exhausted/i.test(providerMessage)
              ? "API key valid, tetapi project sedang terkena batas quota. Key tetap bisa disimpan untuk dicoba lagi."
              : "API key belum dapat diverifikasi.",
          valid: !invalid,
        },
        { status: invalid ? 400 : 200 }
      );
    }

    const available = Array.isArray(data?.models)
      ? data.models
          .map((model: any) => String(model?.name || "").replace(/^models\//, ""))
          .filter(Boolean)
      : [];

    return NextResponse.json({
      valid: true,
      modelCount: available.length,
      recommendedAvailable: [
        "gemini-3.8-flash",
        "gemini-3.7-flash",
        "gemini-3.6-flash",
        "gemini-3.5-flash",
        "gemini-3.5-flash-lite",
        "gemini-3.1-flash-lite",
        "gemini-2.5-pro",
        "gemini-2.5-flash",
        "gemini-2.5-flash-lite",
        "gemini-3.5-transcribe",
        "gemini-3.5-transcribe-live",
      ].filter((model) => available.includes(model)),
    });
  } catch (error: any) {
    console.error("[CHECK_USER_GEMINI_KEY_ERROR]", { name: error?.name });
    return NextResponse.json({ error: "Gagal memverifikasi API key." }, { status: 500 });
  }
}

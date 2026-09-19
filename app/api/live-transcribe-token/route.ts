import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { aiQuotaError, checkAiCredits, normalizeAiMode } from "@/lib/aiQuota";

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

    const body = await req.json().catch(() => ({}));
    const aiMode = normalizeAiMode(body.aiMode);
    const userGeminiKey = String(req.headers.get("x-rb-gemini-key") || "").trim() || undefined;
    const ownGemini = Boolean(userGeminiKey);
    if (aiMode === "simple") {
      return NextResponse.json({ error: "Mode Simple memakai transkrip browser." }, { status: 400 });
    }

    const preflight = ownGemini ? null : await checkAiCredits(supabase, "transcription", aiMode);
    if (preflight && !preflight.allowed) {
      return NextResponse.json(aiQuotaError(preflight), { status: 429 });
    }

    const key = userGeminiKey || process.env.GEMINI_API_KEY;
    if (!key) {
      return NextResponse.json({ error: "Gemini API belum dikonfigurasi." }, { status: 500 });
    }

    const expireTime = new Date(Date.now() + 20 * 60 * 1000).toISOString();
    const newSessionExpireTime = new Date(Date.now() + 60 * 1000).toISOString();

    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/auth_tokens", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": key,
      },
      body: JSON.stringify({
        uses: 1,
        expireTime,
        newSessionExpireTime,
        liveConnectConstraints: {
          model: "models/gemini-3.5-transcribe-live",
          config: {
            responseModalities: ["TEXT"],
            inputAudioTranscription: {
              languageCodes: ["id-ID"],
              mode: "VERBATIM",
            },
          },
        },
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.name) {
      const providerMessage = String(data?.error?.message || "");
      const highDemand = /high demand|overloaded|try again later|temporarily unavailable/i.test(providerMessage);
      const quota = response.status === 429 || /quota|resource.?exhausted|rate.?limit/i.test(providerMessage);
      return NextResponse.json(
        {
          error: highDemand
            ? "Live Transcribe sedang sibuk. Rekaman tetap dapat berjalan dengan fallback browser/final transcript."
            : quota
              ? "Quota Live Transcribe sedang tidak tersedia. Rekaman tetap dapat berjalan dengan fallback browser/final transcript."
              : "Live Transcribe belum dapat dibuka. Rekaman tetap dapat berjalan.",
        },
        { status: highDemand ? 503 : quota ? 429 : 502 }
      );
    }

    return NextResponse.json({
      token: data.name,
      model: "gemini-3.5-transcribe-live",
      expiresAt: expireTime,
      provider: ownGemini ? "user-api-key" : "shared-api-key",
    });
  } catch (error: any) {
    console.error("[LIVE_TRANSCRIBE_TOKEN_ERROR]", {
      name: error?.name,
      message: error?.message,
    });
    return NextResponse.json(
      { error: "Live Transcribe belum dapat dibuka. Rekaman tetap dapat berjalan." },
      { status: 500 }
    );
  }
}

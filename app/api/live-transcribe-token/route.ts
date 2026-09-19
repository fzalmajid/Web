import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { aiQuotaError, checkAiCredits, normalizeAiMode } from "@/lib/aiQuota";
import { geminiUserAuthFromHeaders } from "@/lib/geminiUserAuth";

function bearer(req: NextRequest) {
  const h = req.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}


async function createLiveToken(
  headers: Record<string, string>,
  expireTime: string,
  newSessionExpireTime: string
) {
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/auth_tokens", {
    method: "POST",
    headers,
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
  return { response, data };
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
    const geminiAuth = geminiUserAuthFromHeaders(req.headers);
    const ownGemini = geminiAuth.ownGemini;
    if (aiMode === "simple") {
      return NextResponse.json({ error: "Local memakai transkrip browser." }, { status: 400 });
    }

    const preflight = ownGemini ? null : await checkAiCredits(supabase, "transcription", aiMode);
    if (preflight && !preflight.allowed) {
      return NextResponse.json(aiQuotaError(preflight), { status: 429 });
    }

    const key = geminiAuth.apiKey || (!geminiAuth.accessToken ? process.env.GEMINI_API_KEY : undefined);
    if (!key && !geminiAuth.accessToken) {
      return NextResponse.json({ error: "Gemini belum dikonfigurasi." }, { status: 500 });
    }

    const expireTime = new Date(Date.now() + 20 * 60 * 1000).toISOString();
    const newSessionExpireTime = new Date(Date.now() + 60 * 1000).toISOString();

    let provider = geminiAuth.provider;
    let attempt = await createLiveToken(
      geminiAuth.accessToken
        ? {
            "Content-Type": "application/json",
            Authorization: "Bearer " + geminiAuth.accessToken,
            "x-goog-user-project": geminiAuth.projectId || "",
          }
        : {
            "Content-Type": "application/json",
            "x-goog-api-key": key || "",
          },
      expireTime,
      newSessionExpireTime
    );

    // If a user's own Gemini project does not expose Live Transcribe, keep the
    // recording experience seamless by falling back to the shared provider.
    const sharedKey = String(process.env.GEMINI_API_KEY || "").trim();
    if ((!attempt.response.ok || !attempt.data?.name) && ownGemini && sharedKey) {
      const sharedPreflight = await checkAiCredits(supabase, "transcription", aiMode);
      if (sharedPreflight.allowed) {
        attempt = await createLiveToken(
          {
            "Content-Type": "application/json",
            "x-goog-api-key": sharedKey,
          },
          expireTime,
          newSessionExpireTime
        );
        if (attempt.response.ok && attempt.data?.name) provider = "shared-api-key";
      }
    }

    if (!attempt.response.ok || !attempt.data?.name) {
      const providerMessage = String(attempt.data?.error?.message || "");
      const highDemand = /high demand|overloaded|try again later|temporarily unavailable/i.test(providerMessage);
      const quota = attempt.response.status === 429 || /quota|resource.?exhausted|rate.?limit/i.test(providerMessage);
      return NextResponse.json(
        {
          error: highDemand
            ? "Live Transcribe sedang sibuk."
            : quota
              ? "Live Transcribe sedang mencapai quota."
              : "Live Transcribe belum tersedia pada provider ini.",
          browserFallback: true,
        },
        { status: highDemand ? 503 : quota ? 429 : 502 }
      );
    }

    return NextResponse.json({
      token: attempt.data.name,
      model: "gemini-3.5-transcribe-live",
      expiresAt: expireTime,
      provider,
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

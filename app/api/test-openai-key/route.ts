import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { ExternalAiError } from "@/lib/externalAi";

function bearer(req: NextRequest) {
  const value = req.headers.get("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

function classify(providerStatus: number, data: any) {
  const code = String(data?.error?.code || "").toLowerCase();
  const type = String(data?.error?.type || "").toLowerCase();
  const raw = String(data?.error?.message || "").toLowerCase();
  const combined = [code, type, raw].join(" ");
  if (providerStatus === 401 || providerStatus === 403) {
    return new ExternalAiError("API key tidak valid atau model tidak diizinkan pada proyek ini.", providerStatus, "PROVIDER_AUTH");
  }
  if (/credit_balance_exhausted/.test(combined)) {
    return new ExternalAiError("Saldo kredit API OpenAI di organisasi ini habis. Periksa Billing API.", 429, "PROVIDER_CREDIT_EXHAUSTED");
  }
  if (/project_spend_limit_exceeded/.test(combined)) {
    return new ExternalAiError("Batas pengeluaran proyek OpenAI tercapai.", 429, "PROVIDER_PROJECT_SPEND_LIMIT");
  }
  if (/organization_spend_limit_exceeded|organization_usage_limit_exceeded/.test(combined)) {
    return new ExternalAiError("Batas penggunaan atau pengeluaran organisasi OpenAI tercapai.", 429, "PROVIDER_ORG_LIMIT");
  }
  if (/insufficient_quota|billing_hard_limit_reached|exceeded your current quota/.test(combined)) {
    return new ExternalAiError("API OpenAI menolak penggunaan karena billing/kuota proyek atau organisasi. Periksa saldo API dan limit, bukan kuota ChatGPT.", 429, "PROVIDER_INSUFFICIENT_QUOTA");
  }
  if (providerStatus === 429 || /rate.?limit|too many requests/.test(combined)) {
    const rate = /rate.?limit|requests per minute|tokens per minute|too many requests/.test(combined);
    return new ExternalAiError(
      rate
        ? "Rate limit sementara: batas permintaan atau token per menit pada model ini tercapai. Saldo belum tentu habis."
        : "OpenAI memberi HTTP 429 tanpa rincian yang cukup untuk memastikan apakah rate limit atau billing.",
      429, rate ? "PROVIDER_RATE_LIMIT" : "PROVIDER_429_UNCLASSIFIED"
    );
  }
  if (providerStatus === 404) {
    return new ExternalAiError("Model ini tidak tersedia pada proyek API key tersebut.", 404, "PROVIDER_MODEL_UNAVAILABLE");
  }
  if (providerStatus === 400) {
    return new ExternalAiError("Request tidak cocok dengan model yang diuji. Periksa model dan konfigurasi.", 400, "PROVIDER_REQUEST_INVALID");
  }
  return new ExternalAiError("Uji API OpenAI gagal dengan HTTP " + providerStatus + ".", providerStatus, "PROVIDER_TEST_FAILED");
}

export async function POST(req: NextRequest) {
  const jwt = bearer(req);
  if (!jwt) return NextResponse.json({ error: "Belum login." }, { status: 401 });
  try {
    const supabase = createServerSupabase(jwt);
    const { data: userData, error: authError } = await supabase.auth.getUser();
    if (authError || !userData.user) {
      return NextResponse.json({ error: "Sesi tidak valid." }, { status: 401 });
    }

    const key = String(req.headers.get("x-rb-openai-key") || "").trim();
    if (!key) return NextResponse.json({ error: "Hubungkan API key OpenAI dahulu." }, { status: 400 });
    const payload = await req.json().catch(() => ({}));
    const model = String(payload?.model || "").trim();
    if (!/^[a-zA-Z0-9._:-]{2,120}$/.test(model)) {
      return NextResponse.json({ error: "Pilih model GPT untuk diuji." }, { status: 400 });
    }

    // An actual, small generation request. /v1/models only validates the key
    // and model listing; it does not prove that API billing can process tokens.
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + key,
      },
      body: JSON.stringify({
        model,
        input: "Balas dengan satu kata: OK.",
        max_output_tokens: 64,
        store: false,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
    const data = await response.json().catch(() => ({}));
    const requestId = String(response.headers.get("x-request-id") || "").slice(0, 100);
    if (!response.ok) {
      const diagnosed = classify(response.status, data);
      const providerCode = String(data?.error?.code || "").replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 80);
      const providerType = String(data?.error?.type || "").replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 80);
      return NextResponse.json(
        {
          ok: false,
          error: diagnosed.message,
          classification: diagnosed.code,
          providerCode: providerCode || null,
          providerType: providerType || null,
          httpStatus: response.status,
          requestId: requestId || null,
          model,
        },
        { status: response.status }
      );
    }

    return NextResponse.json({
      ok: true,
      model,
      status: String(data?.status || "accepted"),
      requestId: requestId || null,
      message: "Permintaan generasi GPT diterima OpenAI. Koneksi dan billing model ini dapat memproses request.",
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return NextResponse.json({ error: "Uji OpenAI melebihi batas waktu. Coba lagi.", classification: "PROVIDER_TEST_TIMEOUT" }, { status: 504 });
    }
    return NextResponse.json({ error: "Gagal menjalankan uji GPT. Periksa koneksi dan coba lagi.", classification: "PROVIDER_TEST_FAILED" }, { status: 502 });
  }
}

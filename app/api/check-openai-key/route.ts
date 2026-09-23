import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";

function bearer(req: NextRequest) {
  const h = req.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

function diagnosticExplanation(status: number, code: string, type: string) {
  const detail = (code + " " + type).toLowerCase();
  if (/credit_balance_exhausted/.test(detail)) {
    return "Kredit prabayar API untuk organisasi/proyek key ini tidak tersedia. Periksa saldo Billing API.";
  }
  if (/project_spend_limit_exceeded/.test(detail)) {
    return "Batas pengeluaran proyek pemilik API key tercapai. Periksa Project → Limits.";
  }
  if (/organization_spend_limit_exceeded|organization_usage_limit_exceeded/.test(detail)) {
    return "Batas pengeluaran/penggunaan organisasi API tercapai. Periksa Organization → Limits.";
  }
  if (/insufficient_quota|billing_hard_limit_reached/.test(detail)) {
    return "OpenAI melaporkan insufficient_quota. Pemakaian masih nol tidak berarti proyek sudah memiliki kredit API; periksa saldo dan limit Billing API.";
  }
  if (status === 429 || /rate.?limit/.test(detail)) {
    return /rate.?limit|requests_per_minute|tokens_per_minute/.test(detail)
      ? "Batas kecepatan request/token sementara tercapai, bukan bukti saldo API habis."
      : "OpenAI mengembalikan HTTP 429. Kode detail dibutuhkan untuk membedakan rate limit, kredit, dan limit proyek.";
  }
  if (status === 401 || status === 403) return "API key atau izin model pada proyek ini tidak sesuai.";
  if (status === 404 || /model_not_found/.test(detail)) return "Model uji tidak tersedia pada proyek API ini.";
  if (status === 400) return "Request uji tidak cocok dengan model/izin proyek. Coba model lain.";
  if (status >= 500) return "Provider sedang mengalami gangguan atau belum dapat memproses permintaan uji.";
  return "OpenAI belum dapat memproses permintaan uji; periksa kode dan request ID.";
}

export async function POST(req: NextRequest) {
  try {
    const token = bearer(req);
    if (!token) return NextResponse.json({ error: "Belum login." }, { status: 401 });

    const supabase = createServerSupabase(token);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) return NextResponse.json({ error: "Sesi tidak valid." }, { status: 401 });

    // The key exists only in this request header and the user's browser session.
    // Never log it or persist it in the database, environment, or repository.
    const key = String(req.headers.get("x-rb-openai-key") || "").trim();
    if (!key) return NextResponse.json({ error: "OpenAI API key belum diisi." }, { status: 400 });

    const response = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: "Bearer " + key },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return NextResponse.json(
        {
          valid: false,
          error: response.status === 401 || response.status === 403
            ? "OpenAI API key tidak valid atau tidak punya izin."
            : "OpenAI belum dapat memverifikasi daftar model.",
        },
        { status: response.status === 401 || response.status === 403 ? response.status : 400 }
      );
    }

    const available: string[] = Array.isArray(data?.data)
      ? data.data.map((item: any) => String(item?.id || "")).filter(Boolean)
      : [];

    // GET /models proves authentication only. A tiny Responses call checks
    // whether the API project can actually complete a billable inference.
    const testModel = [
      "gpt-5.6-luna", "gpt-4.1-mini", "gpt-4o-mini", "gpt-5.6-terra",
      "gpt-5.5", "gpt-5.6-sol",
    ].find((id) => available.includes(id)) ||
      available.find((id) =>
        /^gpt-/i.test(id) &&
        !/audio|realtime|transcribe|tts|image|embedding|search-preview/i.test(id)
      );
    let diagnostic:
      | {
          tested: boolean;
          ok: boolean;
          model?: string;
          status?: number;
          code?: string;
          type?: string;
          requestId?: string;
          explanation: string;
        }
      | null = null;

    if (testModel) {
      try {
        const test = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + key,
          },
          body: JSON.stringify({
            model: testModel,
            input: "Balas satu kata: OK.",
            max_output_tokens: 64,
          }),
          cache: "no-store",
          signal: AbortSignal.timeout(25000),
        });
        const result = await test.json().catch(() => ({}));
        const code = String(result?.error?.code || "");
        const type = String(result?.error?.type || "");
        diagnostic = {
          tested: true,
          ok: test.ok,
          model: testModel,
          status: test.status,
          code,
          type,
          requestId: String(test.headers.get("x-request-id") || ""),
          explanation: test.ok
            ? "Permintaan GPT kecil berhasil. API key dan kredit/limit untuk model uji dapat dipakai."
            : diagnosticExplanation(test.status, code, type),
        };
        if (!test.ok) {
          // Safe metadata only. Never log API key, prompt, model output, or raw provider body.
          console.warn("[OPENAI_INFERENCE_CHECK]", {
            status: test.status,
            code: code || null,
            type: type || null,
            model: testModel,
            requestId: diagnostic.requestId || null,
          });
        }
      } catch {
        diagnostic = {
          tested: false,
          ok: false,
          model: testModel,
          explanation: "Pemeriksaan inferensi tidak selesai karena koneksi atau batas waktu; status kredit belum terverifikasi.",
        };
      }
    }

    return NextResponse.json({
      valid: true,
      availableModels: available,
      recommendedAvailable: [
        "gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5",
      ].filter((id) => available.includes(id)),
      diagnostic,
    });
  } catch {
    return NextResponse.json({ error: "Gagal memverifikasi OpenAI." }, { status: 500 });
  }
}

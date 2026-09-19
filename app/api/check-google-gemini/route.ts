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
      return NextResponse.json({ error: "Sesi Ruang Belajar tidak valid." }, { status: 401 });
    }

    const googleToken = String(req.headers.get("x-rb-google-access-token") || "").trim();
    const projectId = String(req.headers.get("x-rb-google-project") || "").trim();
    if (!googleToken || !projectId) {
      return NextResponse.json({ error: "Google token atau project belum dipilih." }, { status: 400 });
    }

    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", {
      headers: {
        Authorization: "Bearer " + googleToken,
        "x-goog-user-project": projectId,
      },
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const providerMessage = String(data?.error?.message || "");
      const apiDisabled = /SERVICE_DISABLED|has not been used|not enabled/i.test(providerMessage);
      return NextResponse.json(
        {
          valid: false,
          error: apiDisabled
            ? "Gemini API belum aktif pada project ini. Aktifkan Generative Language API lalu coba lagi."
            : response.status === 403
              ? "Project ini belum memberi akun tersebut izin memakai Gemini API/quota project."
              : response.status === 401
                ? "Izin Google sudah kedaluwarsa. Hubungkan ulang akun."
                : "Project belum dapat diverifikasi untuk Gemini API.",
        },
        { status: response.status === 401 ? 401 : response.status === 403 ? 403 : 400 }
      );
    }

    const available = Array.isArray(data?.models)
      ? data.models
          .map((model: any) => ({
            id: String(model?.name || "").replace(/^models\//, ""),
            methods: Array.isArray(model?.supportedGenerationMethods)
              ? model.supportedGenerationMethods.map(String)
              : [],
          }))
          .filter((model: any) => model.id)
      : [];

    return NextResponse.json({
      valid: true,
      projectId,
      availableModels: available,
      recommendedAvailable: [
        "gemini-3.8-flash",
        "gemini-3.7-flash",
        "gemini-3.6-flash",
        "gemini-3.5-flash",
        "gemini-3.5-flash-lite",
        "gemini-2.5-pro",
        "gemini-2.5-flash",
        "gemini-2.5-flash-lite",
        "gemini-3.5-transcribe",
        "gemini-3.5-transcribe-live",
      ].filter((id) => available.some((model: any) => model.id === id)),
    });
  } catch (error: any) {
    console.error("[CHECK_GOOGLE_GEMINI_ERROR]", { name: error?.name });
    return NextResponse.json({ error: "Gagal memverifikasi project Gemini." }, { status: 500 });
  }
}

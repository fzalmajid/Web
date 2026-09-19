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
    if (userError || !userData.user) return NextResponse.json({ error: "Sesi tidak valid." }, { status: 401 });

    const key = String(req.headers.get("x-rb-anthropic-key") || "").trim();
    if (!key) return NextResponse.json({ error: "Claude API key belum diisi." }, { status: 400 });

    const response = await fetch("https://api.anthropic.com/v1/models?limit=100", {
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return NextResponse.json(
        {
          valid: false,
          error:
            response.status === 401 || response.status === 403
              ? "Claude API key tidak valid atau tidak punya izin."
              : "Claude belum dapat diverifikasi.",
        },
        { status: response.status === 401 || response.status === 403 ? response.status : 400 }
      );
    }

    const available = Array.isArray(data?.data)
      ? data.data.map((item: any) => String(item?.id || "")).filter(Boolean)
      : [];

    return NextResponse.json({
      valid: true,
      availableModels: available,
      recommendedAvailable: [
        "claude-fable-5",
        "claude-opus-5",
        "claude-sonnet-5",
        "claude-haiku-4-5-20251001",
      ].filter((id) => available.includes(id)),
    });
  } catch {
    return NextResponse.json({ error: "Gagal memverifikasi Claude." }, { status: 500 });
  }
}

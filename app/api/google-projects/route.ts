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
    if (!googleToken) {
      return NextResponse.json({ error: "Google belum terhubung." }, { status: 400 });
    }

    const response = await fetch(
      "https://cloudresourcemanager.googleapis.com/v1/projects?pageSize=100&filter=lifecycleState:ACTIVE",
      { headers: { Authorization: "Bearer " + googleToken } }
    );
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const status = response.status === 401 ? 401 : response.status === 403 ? 403 : 502;
      return NextResponse.json(
        {
          error:
            status === 401
              ? "Izin Google sudah kedaluwarsa. Hubungkan ulang akun Google."
              : status === 403
                ? "Akun Google ini belum memberi izin melihat project Cloud."
                : "Daftar project Google Cloud belum dapat dimuat.",
        },
        { status }
      );
    }

    const projects = Array.isArray(data?.projects)
      ? data.projects
          .map((project: any) => ({
            projectId: String(project?.projectId || ""),
            name: String(project?.name || project?.projectId || ""),
            projectNumber: String(project?.projectNumber || ""),
          }))
          .filter((project: any) => project.projectId)
      : [];

    return NextResponse.json({ projects });
  } catch (error: any) {
    console.error("[GOOGLE_PROJECTS_ERROR]", { name: error?.name });
    return NextResponse.json({ error: "Gagal membaca project Google Cloud." }, { status: 500 });
  }
}

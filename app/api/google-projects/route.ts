import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";

function bearer(req: NextRequest) {
  const h = req.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

function googleReason(data: any) {
  const details = Array.isArray(data?.error?.details) ? data.error.details : [];
  for (const item of details) {
    const reason = String(item?.reason || item?.metadata?.reason || "").trim();
    if (reason) return reason;
  }
  return String(data?.error?.status || "").trim();
}


const OAUTH_APP_PROJECT_NUMBER = "42957287889";

async function searchProjects(googleToken: string) {
  const response = await fetch(
    "https://cloudresourcemanager.googleapis.com/v3/projects:search?pageSize=100&query=state%3AACTIVE",
    {
      headers: { Authorization: "Bearer " + googleToken },
      cache: "no-store",
    }
  );
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function tryEnableCloudResourceManager(googleToken: string) {
  const response = await fetch(
    "https://serviceusage.googleapis.com/v1/projects/" +
      OAUTH_APP_PROJECT_NUMBER +
      "/services/cloudresourcemanager.googleapis.com:enable",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + googleToken,
        "Content-Type": "application/json",
      },
      body: "{}",
    }
  );
  return response.ok;
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

    // Search projects the signed-in user can access. If the OAuth app project
    // has not enabled Cloud Resource Manager yet, try enabling it once for the
    // developer/owner account, then retry automatically.
    let { response, data } = await searchProjects(googleToken);

    if (!response.ok) {
      const initialReason = googleReason(data);
      const initialMessage = String(data?.error?.message || "");
      const serviceDisabled =
        /SERVICE_DISABLED/i.test(initialReason) ||
        /has not been used|is disabled|enable it by visiting/i.test(initialMessage);

      if (serviceDisabled) {
        const enabled = await tryEnableCloudResourceManager(googleToken);
        if (enabled) {
          await new Promise((resolve) => setTimeout(resolve, 1200));
          const retried = await searchProjects(googleToken);
          response = retried.response;
          data = retried.data;
        }
      }
    }

    if (!response.ok) {
      const reason = googleReason(data);
      const providerMessage = String(data?.error?.message || "");
      console.warn("[GOOGLE_PROJECTS_PROVIDER_ERROR]", {
        status: response.status,
        reason,
        message: providerMessage.slice(0, 300),
      });

      const status = response.status === 401 ? 401 : response.status === 403 ? 403 : 502;
      const serviceDisabled =
        /SERVICE_DISABLED/i.test(reason) ||
        /has not been used|is disabled|enable it by visiting/i.test(providerMessage);
      const scopeProblem =
        /ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficient.*scope/i.test(reason + " " + providerMessage);

      return NextResponse.json(
        {
          error:
            status === 401
              ? "Izin Google sudah kedaluwarsa. Hubungkan ulang akun Google."
              : serviceDisabled
                ? "Akun Google sudah terhubung, tetapi Cloud Resource Manager API belum aktif untuk aplikasi ini. Kamu tetap bisa memasukkan Project ID langsung."
                : scopeProblem
                  ? "Token Google belum memiliki izin Cloud yang diperlukan. Hubungkan ulang Google dan setujui semua izin."
                  : "Google tidak mengizinkan daftar project dibaca otomatis. Kamu tetap bisa memasukkan Project ID langsung.",
          code: serviceDisabled
            ? "CLOUD_RESOURCE_MANAGER_DISABLED"
            : scopeProblem
              ? "GOOGLE_SCOPE_INSUFFICIENT"
              : "GOOGLE_PROJECT_LIST_UNAVAILABLE",
          manualProjectAllowed: true,
        },
        { status }
      );
    }

    const projects = Array.isArray(data?.projects)
      ? data.projects
          .map((project: any) => ({
            projectId: String(project?.projectId || "").trim(),
            name: String(project?.displayName || project?.projectId || "").trim(),
            projectNumber: String(project?.name || "").replace(/^projects\//, "").trim(),
          }))
          .filter((project: any) => project.projectId)
      : [];

    return NextResponse.json({ projects, manualProjectAllowed: true });
  } catch (error: any) {
    console.error("[GOOGLE_PROJECTS_ERROR]", { name: error?.name });
    return NextResponse.json(
      {
        error: "Daftar project Google Cloud belum dapat dimuat. Kamu tetap bisa memasukkan Project ID langsung.",
        code: "GOOGLE_PROJECT_LIST_UNAVAILABLE",
        manualProjectAllowed: true,
      },
      { status: 500 }
    );
  }
}

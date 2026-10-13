import { DATA_BACKEND } from "@/lib/dataBackend";
import { getNeonAuthServer } from "@/lib/neonAuthServer";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, context: RouteContext) {
  if (DATA_BACKEND !== "neondb") return Response.json({ error: "Layanan login belum diaktifkan." }, { status: 404 });
  try { return await getNeonAuthServer().handler().GET(request, context); }
  catch { return Response.json({ error: "Login sedang tidak tersedia. Coba lagi." }, { status: 503 }); }
}

export async function POST(request: NextRequest, context: RouteContext) {
  if (DATA_BACKEND !== "neondb") return Response.json({ error: "Layanan login belum diaktifkan." }, { status: 404 });
  try { return await getNeonAuthServer().handler().POST(request, context); }
  catch { return Response.json({ error: "Login sedang tidak tersedia. Coba lagi." }, { status: 503 }); }
}

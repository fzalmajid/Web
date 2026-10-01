import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { normalizeDoi } from "@/lib/referenceMetadata";
import { findOpenPaper, paperConnections } from "@/lib/publicResearch";

export const runtime = "nodejs";
export const maxDuration = 30;
export async function GET(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "") || "";
  if (!token) return NextResponse.json({ error: "Login terlebih dahulu." }, { status: 401 });
  const { data } = await createServerSupabase(token).auth.getUser();
  if (!data.user) return NextResponse.json({ error: "Sesi tidak valid." }, { status: 401 });
  const doi = normalizeDoi(req.nextUrl.searchParams.get("doi"));
  if (!doi || doi.length > 240) return NextResponse.json({ error: "DOI tidak valid." }, { status: 400 });
  const [paper, connections] = await Promise.all([
    findOpenPaper(doi),
    req.nextUrl.searchParams.get("graph") === "1" ? paperConnections(doi) : Promise.resolve(null),
  ]);
  return NextResponse.json({ paper, connections }, { headers: { "Cache-Control": "private, no-store" } });
}

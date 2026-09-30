import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import type { ReferenceMetadata } from "@/lib/referenceMetadata";
import { mendeleyConfigured, resolveReferenceMetadata } from "@/lib/referenceMetadataServer";

function bearer(req: NextRequest) {
  const header = req.headers.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

function sanitizeMetadata(value: any): ReferenceMetadata {
  const safe: ReferenceMetadata = {};
  const stringFields = [
    "title","corporate_author","publisher","institution","edition","container_title",
    "volume","issue","pages","doi","isbn","url","mendeley_id"
  ];
  for (const key of stringFields) {
    const raw = value?.[key];
    if (raw === null || raw === undefined || raw === "") continue;
    (safe as any)[key] = String(raw).trim().slice(0, 500);
  }
  if (Array.isArray(value?.authors)) {
    safe.authors = value.authors.map((item: unknown) => String(item).trim().slice(0, 240)).filter(Boolean).slice(0, 30);
  }
  const year = Number(value?.year);
  if (Number.isInteger(year) && year >= 1000 && year <= 2200) safe.year = year;
  const allowedTypes = new Set(["book","report","journal_article","lecture_slides","webpage","thesis","chapter","other"]);
  if (allowedTypes.has(String(value?.type || ""))) safe.type = value.type;
  return safe;
}

async function frontMatterForFile(supabase: any, sourceFileId: string) {
  const { data } = await supabase
    .from("knowledge_entries")
    .select("title,raw_content,content,source_page_start,created_at")
    .eq("source_file_id", sourceFileId)
    .order("source_page_start", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true })
    .limit(8);
  return (data || [])
    .map((row: any) => String(row.raw_content || row.content || ""))
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 24000);
}

export const runtime = "nodejs";
export const maxDuration = 45;

export async function GET(req: NextRequest) {
  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "Belum login." }, { status: 401 });
  const supabase = createServerSupabase(token);
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return NextResponse.json({ error: "Sesi tidak valid." }, { status: 401 });
  const sourceFileId = String(req.nextUrl.searchParams.get("sourceFileId") || "").trim();
  if (!sourceFileId) return NextResponse.json({ error: "sourceFileId wajib." }, { status: 400 });
  const { data: file, error } = await supabase
    .from("source_files")
    .select("id,file_name,mime_type,source_url,bibliographic_metadata,bibliographic_metadata_status,bibliographic_metadata_updated_at")
    .eq("id", sourceFileId)
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (error || !file) return NextResponse.json({ error: "File tidak ditemukan." }, { status: 404 });
  return NextResponse.json({ file, mendeleyConfigured: mendeleyConfigured() });
}

export async function POST(req: NextRequest) {
  try {
    const token = bearer(req);
    if (!token) return NextResponse.json({ error: "Belum login." }, { status: 401 });
    const supabase = createServerSupabase(token);
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return NextResponse.json({ error: "Sesi tidak valid." }, { status: 401 });
    const body = await req.json();
    const sourceFileId = String(body?.sourceFileId || "").trim();
    const action = String(body?.action || "resolve");
    if (!sourceFileId) return NextResponse.json({ error: "sourceFileId wajib." }, { status: 400 });

    const { data: file, error: fileError } = await supabase
      .from("source_files")
      .select("id,file_name,mime_type,source_url,bibliographic_metadata,bibliographic_metadata_status")
      .eq("id", sourceFileId)
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (fileError || !file) return NextResponse.json({ error: "File tidak ditemukan." }, { status: 404 });

    if (action === "save") {
      const metadata = sanitizeMetadata(body?.metadata || {});
      metadata.provenance = Object.fromEntries(
        Object.keys(metadata)
          .filter((key) => key !== "provenance")
          .map((key) => [key, { source: "manual", confidence: 1, note: "Dikonfirmasi pengguna." }])
      ) as any;
      const { error } = await supabase.from("source_files").update({
        bibliographic_metadata: metadata,
        bibliographic_metadata_status: "manual",
        bibliographic_metadata_updated_at: new Date().toISOString(),
      }).eq("id", sourceFileId).eq("user_id", userData.user.id);
      if (error) throw error;
      return NextResponse.json({ metadata, status: "manual", mendeleyConfigured: mendeleyConfigured() });
    }

    const frontMatter = await frontMatterForFile(supabase, sourceFileId);
    const resolved = await resolveReferenceMetadata({
      fileName: file.file_name,
      mimeType: file.mime_type,
      sourceUrl: file.source_url,
      frontMatter,
      existing: file.bibliographic_metadata || {},
      preserveManual: file.bibliographic_metadata_status === "manual",
    });

    const highConfidence = Object.values(resolved.metadata.provenance || {})
      .filter((item: any) => Number(item?.confidence) >= 0.9).length;
    const status = file.bibliographic_metadata_status === "manual"
      ? "manual"
      : resolved.mendeleyMatched || highConfidence >= 3
        ? "verified"
        : "auto";

    const { error } = await supabase.from("source_files").update({
      bibliographic_metadata: resolved.metadata,
      bibliographic_metadata_status: status,
      bibliographic_metadata_updated_at: new Date().toISOString(),
    }).eq("id", sourceFileId).eq("user_id", userData.user.id);
    if (error) throw error;

    return NextResponse.json({
      metadata: resolved.metadata,
      status,
      confidence: resolved.confidence,
      mendeleyMatched: resolved.mendeleyMatched,
      mendeleySimilarity: resolved.mendeleySimilarity,
      mendeleyConfigured: mendeleyConfigured(),
    });
  } catch (error: any) {
    return NextResponse.json({ error: String(error?.message || "Gagal memeriksa metadata referensi.") }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { resolveReferenceMetadata } from "@/lib/referencePipelineServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

function bearer(req: NextRequest) {
  const header = req.headers.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

async function frontMatterForFile(supabase: any, sourceFileId: string) {
  const { data } = await supabase
    .from("knowledge_entries")
    .select("raw_content,content,source_page_start,created_at")
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

export async function POST(req: NextRequest) {
  try {
    const token = bearer(req);
    if (!token) return NextResponse.json({ error: "Belum login." }, { status: 401 });
    const supabase = createServerSupabase(token);
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return NextResponse.json({ error: "Sesi tidak valid." }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(2, Math.floor(Number(body?.limit) || 2)));
    const afterId = String(body?.afterId || "");

    let query = supabase
      .from("source_files")
      .select("id,file_name,mime_type,source_url,bibliographic_metadata,bibliographic_metadata_status,created_at")
      .eq("user_id", userData.user.id)
      .order("id", { ascending: true })
      .limit(limit);
    if (afterId) query = query.gt("id", afterId);
    const { data: files, error } = await query;

    if (error) throw error;
    const sourceFiles = files || [];
    const processed: Array<{ id: string; fileName: string; status: string }> = [];

    // Small batches protect public catalog rate limits while still making the
    // initial library audit substantially faster than one-file-at-a-time work.
    for (let offset = 0; offset < sourceFiles.length; offset += 2) {
      const slice = sourceFiles.slice(offset, offset + 2);
      const results = await Promise.all(slice.map(async (file: any) => {
        const frontMatter = await frontMatterForFile(supabase, file.id);
        const resolved = await resolveReferenceMetadata({
          fileName: file.file_name,
          mimeType: file.mime_type,
          sourceUrl: file.source_url,
          frontMatter,
          existing: file.bibliographic_metadata || {},
          preserveManual: file.bibliographic_metadata_status === "manual",
        });
        const status = resolved.status;
        const { error: updateError } = await supabase
          .from("source_files")
          .update({
            bibliographic_metadata: resolved.metadata,
            bibliographic_metadata_status: status,
            bibliographic_metadata_updated_at: new Date().toISOString(),
          })
          .eq("id", file.id)
          .eq("user_id", userData.user.id);
        if (updateError) throw updateError;
        return { id: file.id, fileName: file.file_name, status };
      }));
      processed.push(...results);
    }

    const { count: remaining, error: countError } = await supabase
      .from("source_files")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userData.user.id)
      .gt("id", sourceFiles.at(-1)?.id || afterId || "00000000-0000-0000-0000-000000000000");
    if (countError) throw countError;

    const response = NextResponse.json({
      processed,
      processedCount: processed.length,
      remainingUnreviewed: Number(remaining || 0),
      remainingFiles: Number(remaining || 0),
      nextCursor: sourceFiles.at(-1)?.id || null,
    }, {
      headers: { "Cache-Control": "no-store" },
    });
    return response;
  } catch (error: any) {
    return NextResponse.json({
      error: String(error?.message || "Gagal memeriksa metadata referensi secara massal."),
    }, { status: 500 });
  }
}

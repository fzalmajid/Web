import type { SupabaseClient } from "@supabase/supabase-js";

export type KnowledgeSource = {
  id: string;
  node_id: string;
  title: string;
  category: string;
  content: string;
  raw_content?: string | null;
  source_file_id?: string | null;
  source_type?: "manual" | "file" | "transcript" | "generated" | null;
  source_page_start?: number | null;
  source_page_end?: number | null;
};

async function hydrateRawContent(
  supabase: SupabaseClient,
  rows: KnowledgeSource[]
): Promise<KnowledgeSource[]> {
  const ids = rows.map((row) => row.id).filter(Boolean);
  if (!ids.length) return rows;

  const { data } = await supabase
    .from("knowledge_entries")
    .select("id,raw_content,content,source_file_id,source_type,source_page_start,source_page_end")
    .in("id", ids);

  const byId = new Map(
    (data || []).map((item: any) => [
      String(item.id),
      {
        raw: String(item.raw_content || item.content || "").trim(),
        sourceFileId: item.source_file_id ? String(item.source_file_id) : null,
        sourceType: item.source_type ? String(item.source_type) : null,
        pageStart: Number.isFinite(Number(item.source_page_start)) ? Number(item.source_page_start) : null,
        pageEnd: Number.isFinite(Number(item.source_page_end)) ? Number(item.source_page_end) : null,
      },
    ])
  );

  return rows.map((row) => {
    const hydrated = byId.get(row.id);
    return {
      ...row,
      raw_content: hydrated?.raw || row.raw_content || row.content,
      source_file_id: hydrated?.sourceFileId || row.source_file_id || null,
      source_type: (hydrated?.sourceType as KnowledgeSource["source_type"]) || row.source_type || null,
      source_page_start: hydrated?.pageStart ?? row.source_page_start ?? null,
      source_page_end: hydrated?.pageEnd ?? row.source_page_end ?? null,
    };
  });
}

export async function getScopeKnowledge(
  supabase: SupabaseClient,
  scopeNodeId: string | null,
  limit = 40
): Promise<KnowledgeSource[]> {
  const { data, error } = await supabase.rpc("get_scope_knowledge", {
    scope_node_id: scopeNodeId,
    result_limit: limit,
  });
  if (error) throw error;
  return hydrateRawContent(supabase, (data || []) as KnowledgeSource[]);
}

export async function searchScopeKnowledge(
  supabase: SupabaseClient,
  question: string,
  scopeNodeId: string | null,
  limit = 8
): Promise<KnowledgeSource[]> {
  const { data, error } = await supabase.rpc("search_knowledge", {
    search_query: question,
    result_limit: limit,
    scope_node_id: scopeNodeId,
  });
  if (error) throw error;
  return hydrateRawContent(supabase, (data || []) as KnowledgeSource[]);
}

export async function searchSelectedKnowledge(
  supabase: SupabaseClient,
  question: string,
  sourceNodeIds: string[],
  sourceFileIds: string[],
  limit = 12
): Promise<KnowledgeSource[]> {
  const { data, error } = await supabase.rpc("search_knowledge_selected", {
    search_query: question,
    result_limit: limit,
    source_node_ids: sourceNodeIds,
    source_file_ids: sourceFileIds,
  });
  if (error) throw error;
  return hydrateRawContent(supabase, (data || []) as KnowledgeSource[]);
}

export async function getSelectedKnowledge(
  supabase: SupabaseClient,
  sourceNodeIds: string[],
  sourceFileIds: string[],
  limit = 40
): Promise<KnowledgeSource[]> {
  const { data, error } = await supabase.rpc("get_selected_knowledge", {
    result_limit: limit,
    source_node_ids: sourceNodeIds,
    source_file_ids: sourceFileIds,
  });
  if (error) throw error;
  return hydrateRawContent(supabase, (data || []) as KnowledgeSource[]);
}

export function buildKnowledgeContext(rows: KnowledgeSource[], maxChars = 28000) {
  let used = 0;
  const parts: string[] = [];

  for (const row of rows) {
    if (used >= maxChars) break;

    // Rekaman dibaca dari file audio asli oleh /api/ask.
    // Transkrip disimpan untuk user, bukan dijadikan sumber fakta AI.
    if (row.source_type === "transcript") continue;

    const raw = String(row.raw_content || row.content || "").trim();
    if (!raw) continue;

    const remaining = maxChars - used;
    const body = raw.slice(0, Math.max(0, remaining));
    if (!body) break;

    const pageLabel =
      row.source_page_start && row.source_page_end
        ? row.source_page_start === row.source_page_end
          ? ` | HALAMAN PDF ${row.source_page_start}`
          : ` | HALAMAN PDF ${row.source_page_start}-${row.source_page_end}`
        : "";
    const part =
      `[${row.title}${row.category ? ` | ${row.category}` : ""}${pageLabel} | RAW/ORIGINAL]\n${body}`;

    parts.push(part);
    used += part.length;
  }

  return parts.join("\n\n---\n\n");
}

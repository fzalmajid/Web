import type { SupabaseClient } from "@supabase/supabase-js";

export type KnowledgeSource = {
  id: string;
  node_id: string;
  title: string;
  category: string;
  content: string;
  raw_content?: string | null;
  source_file_id?: string | null;
};

async function hydrateRawContent(
  supabase: SupabaseClient,
  rows: KnowledgeSource[]
): Promise<KnowledgeSource[]> {
  const ids = rows.map((row) => row.id).filter(Boolean);
  if (!ids.length) return rows;

  const { data } = await supabase
    .from("knowledge_entries")
    .select("id,raw_content,content,source_file_id")
    .in("id", ids);

  const byId = new Map(
    (data || []).map((item: any) => [
      String(item.id),
      {
        raw: String(item.raw_content || item.content || "").trim(),
        sourceFileId: item.source_file_id ? String(item.source_file_id) : null,
      },
    ])
  );

  return rows.map((row) => {
    const hydrated = byId.get(row.id);
    return {
      ...row,
      raw_content: hydrated?.raw || row.raw_content || row.content,
      source_file_id: hydrated?.sourceFileId || row.source_file_id || null,
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

export function buildKnowledgeContext(rows: KnowledgeSource[], maxChars = 28000) {
  let used = 0;
  const parts: string[] = [];

  for (const row of rows) {
    if (used >= maxChars) break;

    const raw = String(row.raw_content || row.content || "").trim();
    if (!raw) continue;

    const remaining = maxChars - used;
    const body = raw.slice(0, Math.max(0, remaining));
    if (!body) break;

    const part =
      `[${row.title}${row.category ? ` | ${row.category}` : ""} | RAW/ORIGINAL]\n${body}`;

    parts.push(part);
    used += part.length;
  }

  return parts.join("\n\n---\n\n");
}

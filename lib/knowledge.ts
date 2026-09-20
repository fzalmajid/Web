import type { SupabaseClient } from "@supabase/supabase-js";

export type KnowledgeSource = {
  id: string;
  node_id: string;
  title: string;
  category: string;
  content: string;
  raw_content?: string | null;
};

async function hydrateRawContent(
  supabase: SupabaseClient,
  rows: KnowledgeSource[]
): Promise<KnowledgeSource[]> {
  const ids = rows.map((row) => row.id).filter(Boolean);
  if (!ids.length) return rows;

  const { data } = await supabase
    .from("knowledge_entries")
    .select("id,raw_content,content")
    .in("id", ids);

  const rawById = new Map(
    (data || []).map((item: any) => [
      String(item.id),
      String(item.raw_content || item.content || "").trim(),
    ])
  );

  return rows.map((row) => ({
    ...row,
    raw_content: rawById.get(row.id) || row.raw_content || row.content,
  }));
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
    const body = raw.slice(0, 2400);
    const part = `[${row.title}${row.category ? ` | ${row.category}` : ""} | RAW/ORIGINAL]\n${body}`;
    parts.push(part);
    used += part.length;
  }
  return parts.join("\n\n");
}

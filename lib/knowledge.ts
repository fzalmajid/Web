import type { SupabaseClient } from "@supabase/supabase-js";

export type KnowledgeSource = {
  id: string;
  node_id: string;
  title: string;
  category: string;
  content: string;
};

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
  return (data || []) as KnowledgeSource[];
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
  return (data || []) as KnowledgeSource[];
}

export function buildKnowledgeContext(rows: KnowledgeSource[], maxChars = 28000) {
  let used = 0;
  const parts: string[] = [];
  for (const row of rows) {
    if (used >= maxChars) break;
    const body = row.content.slice(0, 1800);
    const part = `[${row.title}${row.category ? ` | ${row.category}` : ""}]\n${body}`;
    parts.push(part);
    used += part.length;
  }
  return parts.join("\n\n");
}

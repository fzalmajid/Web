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
  score?: number | null;
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

/**
 * Independent-source coverage comes before multiple excerpts from one book.
 * A file's per-page chunks are one bibliographic source, not separate citations.
 * This function never invents matches: it only reorders already retrieved rows.
 */
export function diversifyKnowledgeSources(
  rows: KnowledgeSource[],
  limit = 48,
  maxChunksPerSource = 3
): KnowledgeSource[] {
  const bySource = new Map<string, KnowledgeSource[]>();
  for (const row of rows) {
    if (!String(row.raw_content || row.content || "").trim()) continue;
    const sourceKey = row.source_file_id || "entry:" + row.id;
    const group = bySource.get(sourceKey) || [];
    if (!group.some((existing) => existing.id === row.id)) group.push(row);
    bySource.set(sourceKey, group);
  }
  const groups = [...bySource.values()];
  for (const group of groups) {
    group.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
  }
  groups.sort((a, b) => (Number(b[0]?.score) || 0) - (Number(a[0]?.score) || 0));
  const result: KnowledgeSource[] = [];
  for (let round = 0; round < Math.max(1, maxChunksPerSource); round++) {
    for (const group of groups) {
      if (result.length >= limit) return result;
      if (group[round]) result.push(group[round]);
    }
  }
  return result;
}

function rawRelevantExcerpt(raw: string, question: string, maxChars = 1900) {
  if (raw.length <= maxChars) return raw;
  const synonyms: Record<string, string[]> = {
    pct: ["paracetamol", "parasetamol", "acetaminophen", "acetaminofen"],
    paracetamol: ["parasetamol", "acetaminophen", "pct"],
    parasetamol: ["paracetamol", "acetaminophen", "pct"],
    acetaminophen: ["paracetamol", "parasetamol", "pct"],
  };
  const ignored = new Set([
    "carikan", "cari", "temukan", "tolong", "saya", "aku", "ingin", "yang", "dan",
    "dengan", "dari", "untuk", "dalam", "sumber", "file", "folder", "database",
    "monografi", "monograph", "halaman", "jelaskan", "materi", "tentang",
  ]);
  const seeds = (question.toLowerCase().match(/[a-z0-9À-ÿ]{3,}/gi) || [])
    .filter((term) => !ignored.has(term));
  const terms = [...new Set(seeds.flatMap((term) => [term, ...(synonyms[term] || [])]))];
  const normalized = raw.toLowerCase();
  let bestAt = -1;
  let bestScore = -1;
  for (const term of terms) {
    let at = normalized.indexOf(term);
    let checked = 0;
    while (at !== -1 && checked < 40) {
      const center = Math.max(0, at - 180);
      const window = normalized.slice(center, center + maxChars);
      const coverage = terms.filter((candidate) => window.includes(candidate)).length;
      const score = coverage * 100 + Math.min(term.length, 25);
      if (score > bestScore) { bestScore = score; bestAt = at; }
      at = normalized.indexOf(term, at + term.length);
      checked++;
    }
  }
  const start = Math.max(0, (bestAt < 0 ? 0 : bestAt) - 180);
  const excerpt = raw.slice(start, start + maxChars);
  return (start ? "…" : "") + excerpt + (start + maxChars < raw.length ? "…" : "");
}

export function buildKnowledgeContext(rows: KnowledgeSource[], maxChars = 28000, question = "") {
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
    const body = rawRelevantExcerpt(raw, question, Math.min(1900, Math.max(0, remaining - 300)));
    if (!body) break;

    const pageLabel =
      row.source_page_start && row.source_page_end
        ? row.source_page_start === row.source_page_end
          ? ` | HALAMAN PDF ${row.source_page_start}`
          : ` | HALAMAN PDF ${row.source_page_start}-${row.source_page_end}`
        : "";
    const sourceId = row.source_file_id || row.id;
    const part =
      `[SOURCE_ID: ${sourceId} | ${row.title}${row.category ? ` | ${row.category}` : ""}${pageLabel} | CUPLIKAN ISI RAW ASLI]\\n${body}`;

    parts.push(part);
    used += part.length;
  }

  return parts.join("\\n\\n---\\n\\n");
}

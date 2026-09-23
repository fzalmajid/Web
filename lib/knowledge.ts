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


export type SemanticRetrieval = {
  rows: KnowledgeSource[];
  model: string | null;
  status: "ready" | "index-pending" | "fallback";
};

/**
 * One low-cost query embedding; all book/page embeddings are cached in pgvector.
 * The user's JWT is forwarded to the Edge Function and the SQL RPC uses RLS.
 * Search remains fully functional through FTS when indexing/inference is down.
 */
export async function searchSemanticKnowledge(
  supabase: SupabaseClient,
  question: string,
  scopeNodeId: string | null,
  sourceNodeIds: string[],
  sourceFileIds: string[],
  explicitlySelected: boolean,
  limit = 80
): Promise<SemanticRetrieval> {
  const empty: SemanticRetrieval = { rows: [], model: null, status: "fallback" };
  try {
    const { data: available, error: availabilityError } = await supabase
      .from("knowledge_vector_chunks").select("id").limit(1);
    if (availabilityError || !available?.length) {
      return { ...empty, status: "index-pending" };
    }
    const { data: embedded, error: embeddingError } = await supabase.functions.invoke(
      "semantic-index", { body: { action: "query", text: question } }
    );
    if (embeddingError || !embedded || !Array.isArray(embedded.vector) ||
        embedded.vector.length !== 384 || !embedded.model) return empty;
    const model = String(embedded.model);
    const { data, error } = await supabase.rpc("match_knowledge_vectors", {
      p_vector: embedded.vector,
      p_model: model,
      p_scope_node_id: scopeNodeId,
      p_source_node_ids: sourceNodeIds,
      p_source_file_ids: sourceFileIds,
      p_use_selected: explicitlySelected,
      p_min_similarity: model === "intfloat/multilingual-e5-small" ? 0.82 : 0.75,
      p_limit: Math.min(120, Math.max(1, limit))
    });
    if (error) return empty;
    return { rows: (data || []) as KnowledgeSource[], model, status: "ready" };
  } catch {
    return empty;
  }
}

/**
 * Weighted reciprocal-rank fusion. An exact page match gets extra evidence when
 * semantic and lexical search independently agree on the same entry. Semantic
 * hits with weak absolute similarity or essentially empty text are excluded.
 */
export function fuseHybridKnowledge(
  lexical: KnowledgeSource[],
  semantic: KnowledgeSource[],
  limit = 80,
  question = "",
  semanticModel = ""
): KnowledgeSource[] {
  const merged = new Map<string, { row: KnowledgeSource; weight: number }>();
  for (let index = 0; index < lexical.length; index++) {
    const row = lexical[index];
    if (!String(row.raw_content || row.content || "").trim()) continue;
    const prior = merged.get(row.id);
    const weight = 1.2 / (60 + index + 1);
    merged.set(row.id, {
      row: prior?.row || row,
      weight: (prior?.weight || 0) + weight
    });
  }
  for (let index = 0; index < semantic.length; index++) {
    const row = semantic[index];
    const raw = String(row.raw_content || row.content || "").trim();
    if (raw.length < 70) continue;
    const prior = merged.get(row.id);
    // A vague semantic resemblance does not justify citing an unrelated book.
    // For explicitly named paracetamol/PCT, require evidence in the cited chunk.
    const namedPct = /\b(pct|paracetamol|parasetamol|acetaminophen|acetaminofen)\b/i.test(question);
    const chunkHasPct = /\b(pct|paracetamol|parasetamol|acetaminophen|acetaminofen)\b/i.test(raw);
    // "Eksipien potensial dalam tablet PCT" is a formulation question:
    // a relevant excipient monograph need not mention the active ingredient.
    const excipientIntent = /\b(eksipien|excipients?|binder|diluent|pengikat|pengisi|penghancur|pelicin)\b/i.test(question);
    if (!prior && namedPct && !chunkHasPct && !excipientIntent) continue;
    const minimumOnlySemantic = semanticModel === "intfloat/multilingual-e5-small" ? 0.85 : 0.82;
    if (!prior && (Number(row.score) || 0) < minimumOnlySemantic * 100000) continue;
    const weight = 1.0 / (60 + index + 1);
    merged.set(row.id, {
      // The vector chunk is the precise semantic evidence; preserve it instead
      // of hydrating the entire document, especially for multi-megabyte RAW.
      row: prior ? { ...prior.row, raw_content: raw } : row,
      weight: (prior?.weight || 0) + weight
    });
  }
  return [...merged.values()]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit)
    .map(({ row, weight }) => ({ ...row, score: Math.round(weight * 1_000_000) }));
}

/**
 * Rank by the user's *information need*, not the drug name alone. For tablet
 * excipient questions, HOPE and other substantive excipient monographs are
 * primary evidence; pharmacopoeial API pages provide complementary facts.
 * Never fabricate a source or boost a page whose body has no relevant text.
 */
export function prioritizeQuestionRelevantSources(
  rows: KnowledgeSource[],
  question: string
): KnowledgeSource[] {
  const needsExcipients =
    /\b(eksipien|excipients?|bahan tambahan|pengikat|pengisi|penghancur|pelicin)\b/i.test(question);
  if (!needsExcipients) return rows;

  const excipientEvidence =
    /\b(excipients?|pengisi|pengikat|penghancur|pelicin|diluent|binder|disintegrant|lubricant|glidant|filler|microcrystalline cellulose|lactose|povidone|starch|magnesium stearate|croscarmellose|crospovidone)\b/i;
  const apiEvidence = /\b(paracetamol|parasetamol|acetaminophen|acetaminofen|pct)\b/i;
  const scored = rows.map((row) => {
    const title = String(row.title || "").toLowerCase();
    const raw = String(row.raw_content || row.content || "");
    const excipientBook =
      /handbook of pharmaceutical excipients|\bexcipients?\b|\beksipien\b/i.test(title);
    const substantiveExcipient = excipientEvidence.test(raw);
    const apiPage = apiEvidence.test(raw);
    let relevance = Number(row.score) || 0;
    if (excipientBook && substantiveExcipient) relevance += 36000;
    else if (substantiveExcipient) relevance += 9500;
    if (apiPage && !substantiveExcipient) relevance -= 6000;
    return { ...row, score: relevance };
  });
  scored.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
  return scored;
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
    eksipien: ["excipient", "excipients", "binder", "diluent", "disintegrant", "lubricant"],
    excipient: ["eksipien", "excipients", "binder", "diluent", "disintegrant", "lubricant"],
    tablet: ["tablets", "tabletting", "tablet formulation"],
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
  const distinctSources = new Set(rows.filter((row) => row.source_type !== "transcript")
    .map((row) => row.source_file_id || "entry:" + row.id)).size;
  // Reserve a first-pass evidence excerpt from as many genuinely retrieved
  // sources as possible before allocating space to repeated book pages.
  const firstPassChars = Math.max(480, Math.min(1700,
    Math.floor((maxChars - distinctSources * 190) / Math.max(1, distinctSources))));
  const seenSources = new Set<string>();

  for (const row of rows) {
    if (used >= maxChars) break;

    // Rekaman dibaca dari file audio asli oleh /api/ask.
    // Transkrip disimpan untuk user, bukan dijadikan sumber fakta AI.
    if (row.source_type === "transcript") continue;

    const raw = String(row.raw_content || row.content || "").trim();
    if (!raw) continue;

    const sourceKey = row.source_file_id || "entry:" + row.id;
    const firstMention = !seenSources.has(sourceKey);
    const remaining = maxChars - used;
    const excerptBudget = firstMention ? firstPassChars : 1700;
    const body = rawRelevantExcerpt(raw, question,
      Math.min(excerptBudget, Math.max(0, remaining - 300)));
    seenSources.add(sourceKey);
    if (!body) break;

    const pageLabel =
      row.source_page_start && row.source_page_end
        ? row.source_page_start === row.source_page_end
          ? ` | HALAMAN PDF ${row.source_page_start}`
          : ` | HALAMAN PDF ${row.source_page_start}-${row.source_page_end}`
        : "";
    const sourceId = row.source_file_id || row.id;
    const part =
      `[SOURCE_ID: ${sourceId} | ${row.title}${row.category ? ` | ${row.category}` : ""}${pageLabel} | CUPLIKAN ISI RAW ASLI]\n${body}`;

    parts.push(part);
    used += part.length;
  }

  return parts.join("\n\n---\n\n");
}

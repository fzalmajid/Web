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
  bibliographic_work_id?: string;
  bibliographic_work_title?: string;
  bibliographic_edition?: string | null;
  bibliographic_year?: string | null;
};

type BibliographyHint = {
  source_file_id: string;
  file_name: string;
  front_matter: string | null;
  size_bytes: number | null;
};

function romanEdition(value: string): string {
  const numerals: Record<string, string> = {
    i: "1", ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7",
    viii: "8", ix: "9", x: "10", xi: "11", xii: "12"
  };
  return numerals[value.toLowerCase()] || String(Number(value) || value).toLowerCase();
}

function publicationEdition(fileName: string, firstPages: string): string {
  // OCR sometimes separates cover text: "S I X T H E D I T I O N".
  const cover = firstPages.replace(/\b(?:[A-Za-z]\s+){4,}[A-Za-z]\b/g,
    (match) => match.replace(/\s+/g, ""))
    .replace(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)(edition)\b/gi, "$1 $2");
  const ordinals: Record<string, string> = {
    first: "1", second: "2", third: "3", fourth: "4", fifth: "5",
    sixth: "6", seventh: "7", eighth: "8", ninth: "9", tenth: "10"
  };
  const spelled = /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+edition\b/i
    .exec(cover);
  if (spelled) return ordinals[spelled[1].toLowerCase()];
  const numeric = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:edition|edisi|ed\.)\b/i.exec(cover);
  if (numeric) return String(Number(numeric[1]));
  // Cover is authoritative; the filename is a fallback only.
  const roman = /\b(?:edisi|edition|ed\.?)(?:\s+ke\s*[-:]?)?\s+([ivxlcdm]{1,7}|\d{1,2})\b/i.exec(cover);
  if (roman) return romanEdition(roman[1]);
  const fileOrdinal = /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+edition\b/i.exec(fileName);
  if (fileOrdinal) return ordinals[fileOrdinal[1].toLowerCase()];
  const fileEdition = /\b(?:edisi|edition|ed\.?)(?:\s+ke\s*[-:]?)?\s+([ivxlcdm]{1,7}|\d{1,2})\b/i.exec(fileName);
  return fileEdition ? romanEdition(fileEdition[1]) : "";
}

function publicationYear(fileName: string, firstPages: string): string {
  const fromFile = /\b(19\d{2}|20\d{2})\b/.exec(fileName);
  if (fromFile) return fromFile[1];
  // Only explicit publication/copyright metadata, not arbitrary book years.
  const explicit = /\b(?:copyright|published\s+in|publication\s+year|Kementerian\s+Kesehatan\s+RI\.?|©)\s*[:.,-]?\s*(19\d{2}|20\d{2})\b/i.exec(firstPages);
  return explicit ? explicit[1] : "";
}

function normalizedPublicationTitle(fileName: string): string {
  let title = fileName.replace(/\.(?:pdf|docx?|pptx?|txt|md)$/i, "")
    .replace(/_original_pdf_pages_\d+-\d+/gi, "")
    .replace(/(?:[\s_-]+(?:pdf\s*)?pages?[\s_-]*\d+(?:\s*[-–]\s*\d+)?)$/gi, "")
    .replace(/(?:[\s_-]+(?:part|bagian|jilid|volume|vol\.?)[\s_-]*[a-z0-9]+)$/gi, "")
    .replace(/\b(?:edisi|edition|ed\.?)\s*(?:ke\s*[-:]?)?(?:[ivxlcdm]{1,7}|\d{1,2})(?:st|nd|rd|th)?\b/gi, "")
    .replace(/\b(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+edition\b/gi, "")
    .replace(/\b(?:19|20)\d{2}\b/g, "")
    .replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (/^analchem\s*2[. ]1$/i.test(title)) title = "Analytical Chemistry 2.1";
  // Farmakope A/B are file/volume labels, not necessarily different works.
  if (/^farmakope\s+indonesia\b/i.test(title)) {
    title = title.replace(/\s+\b(?:a|b|part\s*\d+)\b$/i, "").trim();
  }
  return title || fileName.replace(/\.[^.]+$/, "");
}

/** The same published work gets ONE bibliography identity across pages/files.
 * Different editions stay distinct, even when uploaded with identical names.
 * Unverifiable edition/identity never gets merged merely by filename. */
export async function annotateBibliographicWorks(
  supabase: SupabaseClient, rows: KnowledgeSource[]
): Promise<KnowledgeSource[]> {
  const ids = Array.from(new Set(rows.map((row) => row.source_file_id).filter(
    (id): id is string => Boolean(id)
  )));
  if (!ids.length) return rows.map((row) => ({
    ...row, bibliographic_work_id: "entry:" + row.id,
    bibliographic_work_title: row.title
  }));
  let hints: BibliographyHint[] = [];
  try {
    const { data, error } = await supabase.rpc("lookup_source_bibliography", {
      p_source_file_ids: ids.slice(0, 100)
    });
    if (error) throw error;
    hints = Array.isArray(data) ? data as BibliographyHint[] : [];
  } catch {
    // Bibliography lookup should never prevent answering a question.
  }
  const byId = new Map(hints.map((hint) => [hint.source_file_id, hint]));
  return rows.map((row) => {
    const fileId = row.source_file_id;
    const hint = fileId ? byId.get(fileId) : undefined;
    if (!hint) return {
      ...row,
      bibliographic_work_id: fileId ? "file:" + fileId : "entry:" + row.id,
      bibliographic_work_title: row.title.replace(/\s*·\s*Halaman\s+\d+(?:\s*[-–]\s*\d+)?/i, "")
    };
    const title = normalizedPublicationTitle(hint.file_name);
    const edition = publicationEdition(hint.file_name, hint.front_matter || "");
    const year = publicationYear(hint.file_name, hint.front_matter || "");
    const normalized = title.toLocaleLowerCase("en").replace(/[^a-z0-9À-ÿ]+/gi, " ").trim();
    // The edition is essential when two files have the same title.
    const workId = edition
      ? "work:" + normalized + "|edition:" + edition + (year ? "|year:" + year : "")
      : "file:" + fileId;
    const editionLabel = edition
      ? (/^farmakope\s+indonesia/i.test(title)
          ? "Edisi " + (["I","II","III","IV","V","VI","VII","VIII","IX","X"][Number(edition)-1] || edition)
          : "Edisi " + edition)
      : "";
    return {
      ...row,
      bibliographic_work_id: workId,
      bibliographic_work_title: title +
        (editionLabel ? " (" + editionLabel + (year ? ", " + year : "") + ")" : year ? " (" + year + ")" : ""),
      bibliographic_edition: edition || null,
      bibliographic_year: year || null
    };
  });
}

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
    // The opening HOPE pages contain a contents list and introduction, not
    // actual substance monographs; prefer chapters on starch, calcium
    // phosphate, magnesium stearate, etc. with substantive material data.
    const page = Number(row.source_page_start || 0);
    if (excipientBook && page >= 1 && page <= 21) relevance -= 26000;
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
    const sourceKey = row.bibliographic_work_id || row.source_file_id || "entry:" + row.id;
    const group = bySource.get(sourceKey) || [];
    // Copies or split PDF parts from the same edition must not consume two
    // bibliography slots for the very same source page/content.
    const duplicate = group.some((existing) =>
      existing.id === row.id ||
      (existing.source_page_start === row.source_page_start &&
       String(existing.raw_content || existing.content || "").slice(0, 240) ===
       String(row.raw_content || row.content || "").slice(0, 240))
    );
    if (!duplicate) group.push(row);
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
    .map((row) => row.bibliographic_work_id || row.source_file_id || "entry:" + row.id)).size;
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

    const sourceKey = row.bibliographic_work_id || row.source_file_id || "entry:" + row.id;
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
    const publication = row.bibliographic_work_title || row.title;
    const workId = row.bibliographic_work_id || sourceId;
    const part =
      `[WORK_ID: ${workId} | KARYA BIBLIOGRAFIS: ${publication} | SOURCE_ID: ${sourceId} | FILE/HALAMAN: ${row.title}${row.category ? ` | ${row.category}` : ""}${pageLabel} | CUPLIKAN ISI RAW ASLI]\n${body}`;

    parts.push(part);
    used += part.length;
  }

  return parts.join("\n\n---\n\n");
}

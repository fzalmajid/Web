import type { SupabaseClient } from "@supabase/supabase-js";
import {
  HF_EMBEDDING_MODEL,
  isMultilingualEmbeddingReady,
  multilingualEmbed,
  multilingualEmbedMany,
  preloadMultilingualEmbedding
} from "./hfEmbeddings";

const CHUNK_CHARS = 1350;
const OVERLAP_CHARS = 170;
const STEP = CHUNK_CHARS - OVERLAP_CHARS;
const EMBED_BATCH_SIZE = 24;

type PendingEntry = {
  entry_id: string;
  user_id: string;
  node_id: string;
  source_file_id: string | null;
  source_page_start: number | null;
  source_page_end: number | null;
  raw_text: string;
  entry_updated_at: string;
  next_chunk_index: number;
};

export type HfIndexStatus = {
  model: string;
  pendingEntries: number;
  indexedVectors: number;
  indexedEntries: number;
};
export type HfIndexProgress = HfIndexStatus & {
  createdThisBatch: number;
  completedThisBatch: number;
  message?: string;
};

let indexCacheUntil = 0;
let indexCacheHasVectors = false;

export function markHfIndexChanged() {
  indexCacheUntil = 0;
}

/**
 * OCR/PDF extraction can occasionally leave an unpaired UTF-16 surrogate.
 * JavaScript can hold it, but PostgreSQL's JSON parser correctly rejects it.
 * Replace only malformed surrogate code units; valid Unicode pairs are kept.
 */
function sanitizeJsonText(value: string): string {
  let result = "";
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        result += value[index] + value[index + 1];
        index++;
      } else {
        result += "\ufffd";
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      result += "\ufffd";
    } else {
      result += value[index];
    }
  }
  return result;
}

function chunksFromRaw(value: string): string[] {
  const clean = sanitizeJsonText(value.replace(/\r\n/g, "\n")).trim();
  const chunks: string[] = [];
  for (let start = 0; start < clean.length; start += STEP) {
    const snippet = clean.slice(start, start + CHUNK_CHARS).trim();
    if (snippet.length >= 60) chunks.push(snippet);
  }
  return chunks;
}

/**
 * Read-only state for the CURRENT logged-in user. Zero vectors means the
 * machine-learning model is not yet helping retrieval, even if the JS package
 * and Supabase function are deployed.
 */
export async function getHfIndexStatus(supabase: SupabaseClient): Promise<HfIndexStatus> {
  const [pending, vectors, entries] = await Promise.all([
    supabase.rpc("count_pending_knowledge_embeddings", { p_model: HF_EMBEDDING_MODEL }),
    supabase.from("knowledge_vector_chunks")
      .select("id", { count: "exact", head: true }).eq("model", HF_EMBEDDING_MODEL),
    supabase.from("knowledge_vector_state")
      .select("entry_id", { count: "exact", head: true })
      .eq("model", HF_EMBEDDING_MODEL).eq("complete", true)
  ]);
  if (pending.error) throw pending.error;
  if (vectors.error) throw vectors.error;
  if (entries.error) throw entries.error;

  const indexedVectors = Number(vectors.count || 0);
  indexCacheHasVectors = indexedVectors > 0;
  indexCacheUntil = Date.now() + 60_000;
  return {
    model: HF_EMBEDDING_MODEL,
    pendingEntries: Number(pending.data || 0),
    indexedVectors,
    indexedEntries: Number(entries.count || 0)
  };
}

async function hasHfIndex(supabase: SupabaseClient): Promise<boolean> {
  if (Date.now() < indexCacheUntil) return indexCacheHasVectors;
  const { count, error } = await supabase.from("knowledge_vector_chunks")
    .select("id", { count: "exact", head: true }).eq("model", HF_EMBEDDING_MODEL).limit(1);
  if (error) return false;
  indexCacheHasVectors = Number(count || 0) > 0;
  indexCacheUntil = Date.now() + 60_000;
  return indexCacheHasVectors;
}

/**
 * Fire-and-forget startup work. It warms the model/backend and vector
 * availability cache while the user is reading the page, not after they click
 * Send. Failures are intentionally non-blocking because lexical retrieval must
 * remain usable.
 */
export function prewarmHfRetrieval(supabase: SupabaseClient) {
  void preloadMultilingualEmbedding().catch(() => undefined);
  void hasHfIndex(supabase).catch(() => undefined);
}

/** Called BEFORE /api/ask, regardless of Local/Gemini/GPT/Claude selection.
 * This function is intentionally non-blocking while the model is still cold:
 * AI can answer immediately from lexical/RAW retrieval and semantic ranking
 * joins automatically once the browser model is warm.
 */
export async function maybeMultilingualQuery(
  supabase: SupabaseClient,
  question: string,
  onProgress?: (message: string) => void
): Promise<{ model: string; vector: number[] } | null> {
  if (!question.trim()) return null;

  if (!isMultilingualEmbeddingReady()) {
    prewarmHfRetrieval(supabase);
    onProgress?.("Semantic E5 sedang dipanaskan di belakang layar; pencarian isi tetap langsung berjalan.");
    return null;
  }

  // Never make Send wait for a fresh database count. Refresh it in background
  // and use lexical retrieval for this request if the cache is cold.
  if (Date.now() >= indexCacheUntil) {
    void hasHfIndex(supabase).catch(() => undefined);
    return null;
  }
  if (!indexCacheHasVectors) return null;

  try {
    const vector = await multilingualEmbed(question.slice(0, 1600), "query");
    return { model: HF_EMBEDDING_MODEL, vector };
  } catch {
    // Semantic retrieval is an enhancement, never a gate for answering.
    return null;
  }
}

/**
 * One large resumable batch of OFFLINE inference in a browser Web Worker.
 * Browser-side inference is batched (up to 24 passages per model call), while
 * writes remain idempotent through entry/model/chunk_index.
 */
export async function indexHfBatch(
  supabase: SupabaseClient,
  options: {
    maxVectors?: number;
    maxEntries?: number;
    shouldStop?: () => boolean;
    onProgress?: (message: string) => void;
  } = {}
): Promise<HfIndexProgress> {
  const maxVectors = Math.max(1, Math.min(96, Number(options.maxVectors || 72)));
  const maxEntries = Math.max(1, Math.min(12, Number(options.maxEntries || 8)));
  const { data, error } = await supabase.rpc("pending_knowledge_embeddings", {
    p_model: HF_EMBEDDING_MODEL,
    p_limit: maxEntries
  });
  if (error) throw error;

  const pending = (data || []) as PendingEntry[];
  let createdThisBatch = 0;
  let completedThisBatch = 0;

  await preloadMultilingualEmbedding((p) => {
    if (p.status === "initiate") {
      options.onProgress?.("Memuat model multilingual ke cache browser...");
    } else if (p.status === "progress" && p.total > 0) {
      options.onProgress?.("Memuat Hugging Face multilingual: " +
        Math.round(p.loaded / p.total * 100) + "%");
    }
  });

  for (const entry of pending) {
    if (options.shouldStop?.() || createdThisBatch >= maxVectors) break;

    const chunks = chunksFromRaw(entry.raw_text || "");
    const startAt = Math.max(0, Number(entry.next_chunk_index || 0));
    if (startAt === 0) {
      // Updated entries are reset only for this model; existing completed
      // entries never enter pending_knowledge_embeddings and are untouched.
      const removed = await supabase.from("knowledge_vector_chunks").delete()
        .eq("entry_id", entry.entry_id).eq("model", HF_EMBEDDING_MODEL);
      if (removed.error) throw removed.error;
    }

    const remainingBudget = maxVectors - createdThisBatch;
    const endAt = Math.min(chunks.length, startAt + remainingBudget, startAt + EMBED_BATCH_SIZE);
    let index = startAt;

    if (endAt > startAt) {
      options.onProgress?.(
        "Embedding " + entry.entry_id.slice(0, 8) + ": bagian " +
        (startAt + 1) + "–" + endAt + "/" + chunks.length
      );

      const texts = chunks.slice(startAt, endAt);
      const embeddings = await multilingualEmbedMany(texts, "passage");
      if (embeddings.length !== texts.length) {
        throw new Error("Jumlah hasil embedding tidak cocok dengan jumlah bagian.");
      }

      const records = embeddings.map((embedding, offset) => ({
        entry_id: entry.entry_id,
        user_id: entry.user_id,
        node_id: entry.node_id,
        source_file_id: entry.source_file_id,
        source_page_start: entry.source_page_start,
        source_page_end: entry.source_page_end,
        chunk_index: startAt + offset,
        snippet: texts[offset],
        model: HF_EMBEDDING_MODEL,
        embedding,
        entry_updated_at: entry.entry_updated_at
      }));

      const saved = await supabase.from("knowledge_vector_chunks")
        .upsert(records, { onConflict: "entry_id,model,chunk_index" });
      if (saved.error) {
        throw new Error(
          "Gagal menyimpan " + entry.entry_id.slice(0, 8) + " bagian " +
          (startAt + 1) + "–" + endAt + ": " + saved.error.message
        );
      }
      index = endAt;
      createdThisBatch += records.length;
      markHfIndexChanged();
    }

    const complete = index >= chunks.length;
    if (index !== startAt || complete) {
      const checkpoint = await supabase.from("knowledge_vector_state").upsert({
        entry_id: entry.entry_id,
        user_id: entry.user_id,
        model: HF_EMBEDDING_MODEL,
        entry_updated_at: entry.entry_updated_at,
        next_chunk_index: index,
        complete,
        indexed_at: new Date().toISOString()
      }, { onConflict: "entry_id,model" });
      if (checkpoint.error) throw checkpoint.error;
      if (complete) completedThisBatch++;
    }
  }

  const status = await getHfIndexStatus(supabase);
  return { ...status, createdThisBatch, completedThisBatch };
}

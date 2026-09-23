import type { SupabaseClient } from "@supabase/supabase-js";
import { HF_EMBEDDING_MODEL, multilingualEmbed } from "./hfEmbeddings";

const CHUNK_CHARS = 1350;
const OVERLAP_CHARS = 170;
const STEP = CHUNK_CHARS - OVERLAP_CHARS;

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

function chunksFromRaw(value: string): string[] {
  const clean = value.replace(/\r\n/g, "\n").trim();
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
  indexCacheUntil = Date.now() + 30_000;
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
  indexCacheUntil = Date.now() + 30_000;
  return indexCacheHasVectors;
}

/** Called BEFORE /api/ask, regardless of Local/Gemini/GPT/Claude selection.
 * Query vectors never use LLM credits and only exist for questions where
 * the user has already indexed at least one source passage with the same model.
 */
export async function maybeMultilingualQuery(
  supabase: SupabaseClient,
  question: string,
  onProgress?: (message: string) => void
): Promise<{ model: string; vector: number[] } | null> {
  if (!question.trim() || !(await hasHfIndex(supabase))) return null;
  const vector = await multilingualEmbed(question.slice(0, 1600), "query", (progress) => {
    if (progress.total > 0 && progress.status === "progress") {
      onProgress?.("Memuat model multilingual: " + Math.round(progress.loaded / progress.total * 100) + "%");
    } else if (progress.status === "initiate") {
      onProgress?.("Mengunduh model Hugging Face sekali ke cache browser...");
    }
  });
  return { model: HF_EMBEDDING_MODEL, vector };
}

/**
 * One bounded, resumable batch of OFFLINE inference in a browser Web Worker.
 * All writes use the caller's authenticated Supabase client and existing RLS.
 * Raw document text is never sent to HF Inference API, Gemini, or OpenAI.
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
  const maxVectors = Math.max(1, Math.min(12, Number(options.maxVectors || 6)));
  const maxEntries = Math.max(1, Math.min(4, Number(options.maxEntries || 2)));
  const { data, error } = await supabase.rpc("pending_knowledge_embeddings", {
    p_model: HF_EMBEDDING_MODEL,
    p_limit: maxEntries
  });
  if (error) throw error;
  const pending = (data || []) as PendingEntry[];
  let createdThisBatch = 0;
  let completedThisBatch = 0;

  for (const entry of pending) {
    if (options.shouldStop?.() || createdThisBatch >= maxVectors) break;
    const chunks = chunksFromRaw(entry.raw_text || "");
    const startAt = Math.max(0, Number(entry.next_chunk_index || 0));
    if (startAt === 0) {
      // The entry may have been updated since the last index; stale vectors
      // must not survive even when this new version has fewer text chunks.
      const removed = await supabase.from("knowledge_vector_chunks").delete()
        .eq("entry_id", entry.entry_id).eq("model", HF_EMBEDDING_MODEL);
      if (removed.error) throw removed.error;
    }
    const records: any[] = [];
    let index = startAt;
    for (; index < chunks.length && createdThisBatch + records.length < maxVectors; index++) {
      if (options.shouldStop?.()) break;
      options.onProgress?.("Embedding " + entry.entry_id.slice(0, 8) +
        ": bagian " + (index + 1) + "/" + chunks.length);
      const embedding = await multilingualEmbed(chunks[index], "passage", (p) => {
        if (p.status === "initiate") {
          options.onProgress?.("Mengunduh model publik ~118 MB sekali; setelah itu di-cache dalam browser.");
        } else if (p.status === "progress" && p.total > 0) {
          options.onProgress?.("Memuat Hugging Face multilingual: " +
            Math.round(p.loaded / p.total * 100) + "%");
        }
      });
      records.push({
        entry_id: entry.entry_id,
        user_id: entry.user_id,
        node_id: entry.node_id,
        source_file_id: entry.source_file_id,
        source_page_start: entry.source_page_start,
        source_page_end: entry.source_page_end,
        chunk_index: index,
        snippet: chunks[index],
        model: HF_EMBEDDING_MODEL,
        embedding,
        entry_updated_at: entry.entry_updated_at
      });
    }

    // Save all vectors first and only then advance the resumable cursor.
    // If a network request fails, reprocessing the same chunk is idempotent.
    if (records.length) {
      const saved = await supabase.from("knowledge_vector_chunks")
        .upsert(records, { onConflict: "entry_id,model,chunk_index" });
      if (saved.error) throw saved.error;
      createdThisBatch += records.length;
      markHfIndexChanged();
    }
    const complete = index >= chunks.length;
    if (records.length || complete) {
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
    if (options.shouldStop?.()) break;
  }
  const status = await getHfIndexStatus(supabase);
  return { ...status, createdThisBatch, completedThisBatch };
}

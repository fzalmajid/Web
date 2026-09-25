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
const INFERENCE_BATCH_SIZE = 24;
const MAX_CHUNKS_PER_ENTRY_PER_PASS = 24;

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
let lastIndexStatus: HfIndexStatus | null = null;

export function markHfIndexChanged() {
  indexCacheHasVectors = true;
  indexCacheUntil = Date.now() + 60_000;
}

/**
 * OCR/PDF extraction plus fixed-size UTF-16 slicing can leave an unpaired
 * surrogate at a chunk boundary. JavaScript can hold that code unit, but
 * PostgreSQL's JSON parser rejects it. Replace malformed units only.
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
    // Sanitize again after slicing because slice() operates on UTF-16 code
    // units and can split an otherwise-valid astral Unicode character.
    const snippet = sanitizeJsonText(clean.slice(start, start + CHUNK_CHARS)).trim();
    if (snippet.length >= 60) chunks.push(snippet);
  }
  return chunks;
}

/**
 * Read-only state for the CURRENT logged-in user.
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

  const status = {
    model: HF_EMBEDDING_MODEL,
    pendingEntries: Number(pending.data || 0),
    indexedVectors: Number(vectors.count || 0),
    indexedEntries: Number(entries.count || 0)
  };
  lastIndexStatus = status;
  indexCacheHasVectors = status.indexedVectors > 0;
  indexCacheUntil = Date.now() + 60_000;
  return status;
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
 * Fire-and-forget startup work. Model download/cache lookup and backend
 * compilation happen before the user clicks Send.
 */
export function prewarmHfRetrieval(supabase: SupabaseClient) {
  void preloadMultilingualEmbedding().catch(() => undefined);
  void hasHfIndex(supabase).catch(() => undefined);
}

/**
 * Semantic E5 is an enhancement, never a gate. If the worker or index cache is
 * still cold, return immediately and let lexical/RAW retrieval answer now.
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

  if (Date.now() >= indexCacheUntil) {
    void hasHfIndex(supabase).catch(() => undefined);
    return null;
  }
  if (!indexCacheHasVectors) return null;

  try {
    const vector = await multilingualEmbed(question.slice(0, 1600), "query");
    return { model: HF_EMBEDDING_MODEL, vector };
  } catch {
    return null;
  }
}

type PlannedEntry = {
  entry: PendingEntry;
  chunks: string[];
  startAt: number;
  endAt: number;
};

type PlannedChunk = {
  entry: PendingEntry;
  chunkIndex: number;
  snippet: string;
};

/**
 * Large resumable browser batch:
 * - one pending RPC
 * - one bulk stale-vector delete (when needed)
 * - batched WebGPU/WASM inference
 * - one bulk vector upsert
 * - one bulk checkpoint upsert
 * This removes the per-chunk/per-entry network waterfall.
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
  if (!pending.length) {
    const exact = await getHfIndexStatus(supabase);
    return { ...exact, createdThisBatch: 0, completedThisBatch: 0 };
  }

  await preloadMultilingualEmbedding((p) => {
    if (p.status === "initiate") {
      options.onProgress?.("Memuat model multilingual ke cache browser...");
    } else if (p.status === "progress" && p.total > 0) {
      options.onProgress?.("Memuat Hugging Face multilingual: " +
        Math.round(p.loaded / p.total * 100) + "%");
    }
  });

  const plans: PlannedEntry[] = [];
  const tasks: PlannedChunk[] = [];
  const resetEntryIds: string[] = [];
  let remainingBudget = maxVectors;

  for (const entry of pending) {
    if (options.shouldStop?.() || remainingBudget <= 0) break;

    const chunks = chunksFromRaw(entry.raw_text || "");
    const startAt = Math.max(0, Number(entry.next_chunk_index || 0));
    if (startAt === 0) resetEntryIds.push(entry.entry_id);

    const take = Math.max(0, Math.min(
      chunks.length - startAt,
      remainingBudget,
      MAX_CHUNKS_PER_ENTRY_PER_PASS
    ));
    const endAt = startAt + take;
    plans.push({ entry, chunks, startAt, endAt });

    for (let chunkIndex = startAt; chunkIndex < endAt; chunkIndex++) {
      tasks.push({ entry, chunkIndex, snippet: chunks[chunkIndex] });
    }
    remainingBudget -= take;
  }

  if (resetEntryIds.length) {
    const removed = await supabase.from("knowledge_vector_chunks").delete()
      .eq("model", HF_EMBEDDING_MODEL)
      .in("entry_id", resetEntryIds);
    if (removed.error) throw removed.error;
  }

  const vectors: number[][] = [];
  for (let offset = 0; offset < tasks.length; offset += INFERENCE_BATCH_SIZE) {
    if (options.shouldStop?.()) break;
    const end = Math.min(tasks.length, offset + INFERENCE_BATCH_SIZE);
    options.onProgress?.(
      "Embedding cepat: " + (offset + 1) + "–" + end + "/" + tasks.length + " bagian"
    );
    const batch = await multilingualEmbedMany(
      tasks.slice(offset, end).map((task) => task.snippet),
      "passage"
    );
    vectors.push(...batch);
  }

  // If the user stopped between inference batches, save exactly the completed
  // prefix and advance each affected entry only through those saved chunks.
  const completedTaskCount = vectors.length;
  const completedTasks = tasks.slice(0, completedTaskCount);
  const records = completedTasks.map((task, index) => ({
    entry_id: task.entry.entry_id,
    user_id: task.entry.user_id,
    node_id: task.entry.node_id,
    source_file_id: task.entry.source_file_id,
    source_page_start: task.entry.source_page_start,
    source_page_end: task.entry.source_page_end,
    chunk_index: task.chunkIndex,
    snippet: task.snippet,
    model: HF_EMBEDDING_MODEL,
    embedding: vectors[index],
    entry_updated_at: task.entry.entry_updated_at
  }));

  if (records.length) {
    const saved = await supabase.from("knowledge_vector_chunks")
      .upsert(records, { onConflict: "entry_id,model,chunk_index" });
    if (saved.error) {
      const first = completedTasks[0];
      const last = completedTasks[completedTasks.length - 1];
      throw new Error(
        "Gagal menyimpan batch " +
        String(first?.entry.entry_id || "").slice(0, 8) + ":" + String(first?.chunkIndex ?? "?") +
        " sampai " + String(last?.entry.entry_id || "").slice(0, 8) + ":" +
        String(last?.chunkIndex ?? "?") + ": " + saved.error.message
      );
    }
    markHfIndexChanged();
  }

  const savedNextByEntry = new Map<string, number>();
  for (const task of completedTasks) {
    savedNextByEntry.set(task.entry.entry_id, task.chunkIndex + 1);
  }

  const states = plans.flatMap(({ entry, chunks, startAt }) => {
    const next = savedNextByEntry.get(entry.entry_id) ?? startAt;
    // Entries with no chunks are immediately complete. Entries interrupted by
    // Stop remain resumable at their last successfully saved chunk.
    const complete = next >= chunks.length;
    if (next === startAt && !complete) return [];
    return [{
      entry_id: entry.entry_id,
      user_id: entry.user_id,
      model: HF_EMBEDDING_MODEL,
      entry_updated_at: entry.entry_updated_at,
      next_chunk_index: next,
      complete,
      indexed_at: new Date().toISOString()
    }];
  });

  if (states.length) {
    const checkpoint = await supabase.from("knowledge_vector_state")
      .upsert(states, { onConflict: "entry_id,model" });
    if (checkpoint.error) throw checkpoint.error;
  }

  const completedThisBatch = states.filter((state) => state.complete).length;
  const { data: remaining, error: remainingError } = await supabase.rpc(
    "count_pending_knowledge_embeddings", { p_model: HF_EMBEDDING_MODEL }
  );
  if (remainingError) throw remainingError;

  const pendingEntries = Number(remaining || 0);
  if (!lastIndexStatus) {
    const exact = await getHfIndexStatus(supabase);
    return {
      ...exact,
      createdThisBatch: records.length,
      completedThisBatch
    };
  }

  // Fast UI counters between exact refreshes. Final completion gets an exact
  // recount, while intermediate passes avoid three extra COUNT queries each.
  lastIndexStatus = {
    model: HF_EMBEDDING_MODEL,
    pendingEntries,
    indexedVectors: lastIndexStatus.indexedVectors + records.length,
    indexedEntries: lastIndexStatus.indexedEntries + completedThisBatch
  };

  if (pendingEntries === 0) {
    const exact = await getHfIndexStatus(supabase);
    return { ...exact, createdThisBatch: records.length, completedThisBatch };
  }

  return {
    ...lastIndexStatus,
    createdThisBatch: records.length,
    completedThisBatch
  };
}

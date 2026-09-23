"use client";

import { supabase } from "@/lib/supabase";

export const MULTILINGUAL_E5_MODEL = "intfloat/multilingual-e5-small";
const TRANSFORMERS_MODEL = "Xenova/multilingual-e5-small";
const CHUNK_CHARS = 1350;
const OVERLAP_CHARS = 170;

type Embedder = (text: string, options?: Record<string, unknown>) => Promise<any>;
let embedderPromise: Promise<Embedder> | null = null;

function normalizeVector(value: unknown): number[] {
  let raw: any = value;
  if (raw && typeof raw.tolist === "function") raw = raw.tolist();
  while (Array.isArray(raw) && raw.length === 1 && Array.isArray(raw[0])) raw = raw[0];
  if (!Array.isArray(raw) || raw.length !== 384) {
    throw new Error("Embedding multilingual-e5 tidak menghasilkan 384 dimensi.");
  }
  const vector = raw.map(Number);
  if (vector.some((n) => !Number.isFinite(n))) throw new Error("Embedding berisi nilai tidak valid.");
  const magnitude = Math.sqrt(vector.reduce((sum, n) => sum + n * n, 0));
  if (!magnitude) throw new Error("Embedding memiliki magnitudo nol.");
  return vector.map((n) => n / magnitude);
}

async function getEmbedder(): Promise<Embedder> {
  if (!embedderPromise) {
    embedderPromise = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      // Model is public and cached by the browser. No HF API token and no
      // Gemini/GPT credits are consumed. Remote code execution stays disabled.
      env.allowRemoteModels = true;
      env.allowLocalModels = false;
      const device = typeof navigator !== "undefined" && (navigator as any).gpu ? "webgpu" : "wasm";
      const extractor = await pipeline("feature-extraction", TRANSFORMERS_MODEL, {
        dtype: "q8",
        device: device as any,
      } as any);
      return extractor as unknown as Embedder;
    })().catch((error) => {
      embedderPromise = null;
      throw error;
    });
  }
  return embedderPromise;
}

export async function embedMultilingualE5(
  text: string,
  kind: "query" | "passage"
): Promise<{ model: string; vector: number[] }> {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) throw new Error("Teks embedding kosong.");
  const extractor = await getEmbedder();
  const output = await extractor(kind + ": " + clean.slice(0, 6000), {
    pooling: "mean",
    normalize: true,
  });
  return { model: MULTILINGUAL_E5_MODEL, vector: normalizeVector(output) };
}

export async function hasMultilingualVectorIndex(): Promise<boolean> {
  const { count, error } = await supabase
    .from("knowledge_vector_chunks")
    .select("id", { count: "exact", head: true })
    .eq("model", MULTILINGUAL_E5_MODEL);
  if (error) return false;
  return Number(count || 0) > 0;
}

export async function multilingualVectorStatus() {
  const [{ count, error: countError }, pending] = await Promise.all([
    supabase.from("knowledge_vector_chunks")
      .select("id", { count: "exact", head: true })
      .eq("model", MULTILINGUAL_E5_MODEL),
    supabase.rpc("count_pending_knowledge_embeddings", { p_model: MULTILINGUAL_E5_MODEL }),
  ]);
  if (countError) throw countError;
  if (pending.error) throw pending.error;
  return {
    model: MULTILINGUAL_E5_MODEL,
    indexedVectors: Number(count || 0),
    pendingEntries: Number(pending.data || 0),
  };
}

function contentChunks(value: string): string[] {
  const clean = String(value || "").replace(/\r\n/g, "\n").trim();
  const result: string[] = [];
  if (!clean) return result;
  const step = CHUNK_CHARS - OVERLAP_CHARS;
  for (let start = 0; start < clean.length; start += step) {
    const text = clean.slice(start, start + CHUNK_CHARS).trim();
    if (text.length >= 60) result.push(text);
  }
  return result;
}

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

export async function backfillMultilingualEmbeddings(options?: {
  maxVectors?: number;
  maxEntries?: number;
  shouldStop?: () => boolean;
  onProgress?: (status: { indexedVectors: number; pendingEntries: number; vectorsCreated: number }) => void;
}) {
  const maxVectors = Math.max(1, Math.min(40, Number(options?.maxVectors || 16)));
  const maxEntries = Math.max(1, Math.min(8, Number(options?.maxEntries || 5)));
  let created = 0;

  const { data: pending, error } = await supabase.rpc("pending_knowledge_embeddings", {
    p_model: MULTILINGUAL_E5_MODEL,
    p_limit: maxEntries,
  });
  if (error) throw error;

  for (const entry of (pending || []) as PendingEntry[]) {
    if (created >= maxVectors || options?.shouldStop?.()) break;
    const chunks = contentChunks(entry.raw_text);
    let index = Math.max(0, Number(entry.next_chunk_index || 0));

    if (index === 0) {
      const removed = await supabase.from("knowledge_vector_chunks")
        .delete().eq("entry_id", entry.entry_id).eq("model", MULTILINGUAL_E5_MODEL);
      if (removed.error) throw removed.error;
    }

    for (; index < chunks.length && created < maxVectors; index++) {
      if (options?.shouldStop?.()) break;
      const embedded = await embedMultilingualE5(chunks[index], "passage");
      const { error: upsertError } = await supabase.from("knowledge_vector_chunks").upsert({
        entry_id: entry.entry_id,
        user_id: entry.user_id,
        node_id: entry.node_id,
        source_file_id: entry.source_file_id,
        source_page_start: entry.source_page_start,
        source_page_end: entry.source_page_end,
        chunk_index: index,
        snippet: chunks[index],
        embedding: embedded.vector,
        model: MULTILINGUAL_E5_MODEL,
        entry_updated_at: entry.entry_updated_at,
      }, { onConflict: "entry_id,model,chunk_index" });
      if (upsertError) throw upsertError;
      created++;
    }

    const complete = index >= chunks.length;
    const { error: stateError } = await supabase.from("knowledge_vector_state").upsert({
      entry_id: entry.entry_id,
      user_id: entry.user_id,
      model: MULTILINGUAL_E5_MODEL,
      entry_updated_at: entry.entry_updated_at,
      next_chunk_index: index,
      complete,
      indexed_at: new Date().toISOString(),
    }, { onConflict: "entry_id,model" });
    if (stateError) throw stateError;
  }

  const status = await multilingualVectorStatus();
  options?.onProgress?.({ ...status, vectorsCreated: created });
  return { ...status, vectorsCreated: created };
}

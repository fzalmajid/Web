import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

// Never mix vectors created by different embedding models.
const HF_MODEL = "intfloat/multilingual-e5-small";
const LOCAL_MODEL = "Supabase/gte-small";
const localSession = new Supabase.ai.Session("gte-small");
const CHUNK_CHARS = 1350;
const OVERLAP_CHARS = 170;
// Browser calls send an OPTIONS preflight for Authorization and apikey.
// Without this response the index button never reached the function.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "Access-Control-Max-Age": "86400"
};
const jsonHeaders = { ...corsHeaders, "content-type": "application/json; charset=utf-8" };

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: jsonHeaders });
}
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
function normalizeVector(raw: unknown): number[] {
  let value: unknown = raw;
  if (value && typeof value === "object" && "data" in value) {
    value = (value as { data: unknown }).data;
  }
  if (value instanceof Float32Array || value instanceof Float64Array) {
    value = Array.from(value);
  }
  // Providers may wrap their pooled output in an outer batch dimension.
  while (Array.isArray(value) && value.length === 1 && Array.isArray(value[0])) value = value[0];
  if (Array.isArray(value) && value.length > 1 && Array.isArray(value[0])) {
    const vectors = value.filter((v) => Array.isArray(v) && v.length === 384) as number[][];
    if (!vectors.length) throw new Error("Embedding provider returned an unexpected shape.");
    value = Array.from({ length: 384 }, (_, i) =>
      vectors.reduce((sum, vector) => sum + Number(vector[i] || 0), 0) / vectors.length
    );
  }
  if (!Array.isArray(value) || value.length !== 384 ||
      value.some((v) => typeof v !== "number" || !Number.isFinite(v))) {
    throw new Error("Embedding dimension must be 384.");
  }
  const arr = value as number[];
  const magnitude = Math.sqrt(arr.reduce((sum, n) => sum + n * n, 0));
  if (!magnitude) throw new Error("Embedding has zero magnitude.");
  return arr.map((n) => n / magnitude);
}
function activeModel() {
  return Deno.env.get("HF_TOKEN")?.trim() ? HF_MODEL : LOCAL_MODEL;
}
async function embed(text: string, kind: "query" | "passage", model: string): Promise<number[]> {
  if (model === HF_MODEL) {
    const token = Deno.env.get("HF_TOKEN")?.trim();
    if (!token) throw new Error("HF_TOKEN belum disetel pada Edge Function.");
    const response = await fetch(
      "https://router.huggingface.co/hf-inference/models/intfloat/multilingual-e5-small",
      {
        method: "POST",
        headers: { authorization: "Bearer " + token, "content-type": "application/json" },
        body: JSON.stringify({
          inputs: kind + ": " + text,
          options: { wait_for_model: true },
          normalize: true,
          truncate: true
        }),
        signal: AbortSignal.timeout(25000)
      }
    );
    if (!response.ok) throw new Error("Hugging Face embedding HTTP " + response.status);
    return normalizeVector(await response.json());
  }
  return normalizeVector(await localSession.run(text, { mean_pool: true, normalize: true }));
}
function contentChunks(value: string) {
  const clean = value.replace(/\r\n/g, "\n").trim();
  const chunks: string[] = [];
  if (!clean) return chunks;
  const step = CHUNK_CHARS - OVERLAP_CHARS;
  for (let start = 0; start < clean.length; start += step) {
    const text = clean.slice(start, start + CHUNK_CHARS).trim();
    if (text.length >= 60) chunks.push(text);
  }
  return chunks;
}
type PendingEntry = {
  entry_id: string; user_id: string; node_id: string; source_file_id: string | null;
  source_page_start: number | null; source_page_end: number | null;
  title: string; raw_text: string; entry_updated_at: string; next_chunk_index: number;
};

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }
  if (request.method !== "POST") return json({ error: "POST only" }, 405);
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) return json({ error: "Login diperlukan." }, 401);
  const jwt = authorization.slice(7);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) return json({ error: "Supabase configuration missing." }, 503);

  const db = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false }
  });
  const { data: auth, error: authError } = await db.auth.getUser(jwt);
  if (authError || !auth.user) return json({ error: "Sesi tidak valid." }, 401);

  let payload: { action?: string; text?: string; maxVectors?: number; maxEntries?: number };
  try { payload = await request.json(); }
  catch { return json({ error: "JSON tidak valid." }, 400); }

  const model = activeModel();
  if (payload.action === "status") {
    const { data, error } = await db.rpc("count_pending_knowledge_embeddings", { p_model: model });
    if (error) return json({ error: error.message }, 500);
    const { count, error: countError } = await db
      .from("knowledge_vector_chunks")
      .select("id", { count: "exact", head: true })
      .eq("model", model);
    if (countError) return json({ error: countError.message }, 500);
    return json({
      model,
      provider: model === HF_MODEL ? "Hugging Face multilingual" : "Supabase local (English-oriented)",
      pendingEntries: Number(data || 0),
      indexedVectors: Number(count || 0),
      hfConfigured: Boolean(Deno.env.get("HF_TOKEN")?.trim())
    });
  }

  if (payload.action === "query") {
    const question = String(payload.text || "").trim().slice(0, 1900);
    if (!question) return json({ error: "Pertanyaan kosong." }, 400);
    try {
      const vector = await embed(question, "query", model);
      return json({ model, vector });
    } catch (error) {
      console.error("semantic query:", errorMessage(error));
      return json({ error: "Embedding sedang tidak tersedia; gunakan pencarian isi." }, 503);
    }
  }

  if (payload.action !== "backfill") return json({ error: "Unknown action." }, 400);
  const maxVectors = Math.max(1, Math.min(20, Number(payload.maxVectors) || 12));
  const maxEntries = Math.max(1, Math.min(8, Number(payload.maxEntries) || 5));
  const { data: pending, error: pendingError } = await db.rpc("pending_knowledge_embeddings", {
    p_model: model, p_limit: maxEntries
  });
  if (pendingError) return json({ error: pendingError.message }, 500);

  let vectorsCreated = 0;
  let entriesCompleted = 0;
  try {
    for (const entry of (pending || []) as PendingEntry[]) {
      if (vectorsCreated >= maxVectors) break;
      const chunks = contentChunks(String(entry.raw_text || ""));
      const nextIndex = Math.max(0, Number(entry.next_chunk_index || 0));
      if (nextIndex === 0) {
        const removed = await db.from("knowledge_vector_chunks").delete()
          .eq("entry_id", entry.entry_id).eq("model", model);
        if (removed.error) throw removed.error;
      }
      let index = nextIndex;
      for (; index < chunks.length && vectorsCreated < maxVectors; index++) {
        const snippet = chunks[index];
        const vector = await embed(snippet, "passage", model);
        const { error: insertError } = await db.from("knowledge_vector_chunks").upsert({
          entry_id: entry.entry_id,
          user_id: entry.user_id,
          node_id: entry.node_id,
          source_file_id: entry.source_file_id,
          source_page_start: entry.source_page_start,
          source_page_end: entry.source_page_end,
          chunk_index: index,
          snippet,
          embedding: vector,
          model,
          entry_updated_at: entry.entry_updated_at
        }, { onConflict: "entry_id,model,chunk_index" });
        if (insertError) throw insertError;
        vectorsCreated++;
      }
      const complete = index >= chunks.length;
      const { error: stateError } = await db.from("knowledge_vector_state").upsert({
        entry_id: entry.entry_id,
        user_id: entry.user_id,
        model,
        entry_updated_at: entry.entry_updated_at,
        next_chunk_index: index,
        complete,
        indexed_at: new Date().toISOString()
      }, { onConflict: "entry_id,model" });
      if (stateError) throw stateError;
      if (complete) entriesCompleted++;
    }
    const { data: remaining, error: remainingError } = await db.rpc(
      "count_pending_knowledge_embeddings", { p_model: model }
    );
    if (remainingError) throw remainingError;
    return json({ model, vectorsCreated, entriesCompleted, pendingEntries: Number(remaining || 0) });
  } catch (error) {
    console.error("semantic backfill:", errorMessage(error));
    return json({
      error: "Pengindeksan embedding tertunda. Pencarian isi tetap tersedia.",
      model, vectorsCreated, entriesCompleted
    }, 503);
  }
});

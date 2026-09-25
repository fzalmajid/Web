// Shared per-tab browser model: all modes (Local / GPT / Gemini / Claude)
// use the same multilingual retrieval vectors, independently of the LLM API.
export const HF_EMBEDDING_MODEL = "intfloat/multilingual-e5-small";

type ProgressInfo = { status: string; loaded: number; total: number };
type Pending = {
  kind: "warmup" | "embed";
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  onProgress?: (info: ProgressInfo) => void;
};

let worker: Worker | null = null;
let nextId = 0;
let workerReady = false;
let warmupPromise: Promise<void> | null = null;
const pending = new Map<number, Pending>();

function resetWorker(current: Worker) {
  for (const request of pending.values()) request.reject(new Error("Worker embedding gagal dimuat."));
  pending.clear();
  current.terminate();
  if (worker === current) worker = null;
  workerReady = false;
  warmupPromise = null;
}

function getWorker(): Worker {
  if (typeof window === "undefined") throw new Error("Embedding multilingual memerlukan browser.");
  if (worker) return worker;

  const current = new Worker(new URL("./hfEmbedding.worker.ts", import.meta.url), { type: "module" });
  current.onmessage = (event: MessageEvent<any>) => {
    const data = event.data;
    const id = Number(data?.id);
    const item = pending.get(id);
    if (!item) return;

    if (data?.type === "progress") {
      item.onProgress?.({
        status: String(data.status || ""),
        loaded: Number(data.loaded || 0),
        total: Number(data.total || 0)
      });
      return;
    }

    pending.delete(id);
    if (data?.type === "error") {
      item.reject(new Error(String(data.message || "Embedding gagal.")));
      return;
    }
    if (data?.type === "ready" && item.kind === "warmup") {
      workerReady = true;
      item.resolve(undefined);
      return;
    }
    if (data?.type === "result" && item.kind === "embed" && Array.isArray(data.vectors)) {
      const vectors = data.vectors as unknown[];
      const valid = vectors.every((vector) =>
        Array.isArray(vector) && vector.length === 384 && vector.every(
          (value) => typeof value === "number" && Number.isFinite(value)
        )
      );
      if (valid) item.resolve(vectors as number[][]);
      else item.reject(new Error("Hasil embedding tidak valid."));
      return;
    }
    item.reject(new Error("Respons worker embedding tidak dikenali."));
  };
  current.onerror = () => resetWorker(current);
  worker = current;
  return current;
}

export function isMultilingualEmbeddingReady() {
  return workerReady;
}

/**
 * Start downloading from browser cache/network and compile the inference
 * backend before the user asks a question. Safe to call repeatedly.
 */
export function preloadMultilingualEmbedding(
  onProgress?: (info: ProgressInfo) => void
): Promise<void> {
  if (workerReady) return Promise.resolve();
  if (warmupPromise) return warmupPromise;

  const current = getWorker();
  const id = ++nextId;
  warmupPromise = new Promise<void>((resolve, reject) => {
    pending.set(id, {
      kind: "warmup",
      resolve,
      reject,
      onProgress
    });
    current.postMessage({ id, type: "warmup" });
  }).catch((error) => {
    warmupPromise = null;
    throw error;
  });
  return warmupPromise;
}

export async function multilingualEmbedMany(
  texts: string[],
  kind: "query" | "passage",
  onProgress?: (info: ProgressInfo) => void
): Promise<number[][]> {
  const clean = texts.map((text) => String(text || "").trim()).filter(Boolean);
  if (!clean.length) throw new Error("Teks embedding kosong.");

  await preloadMultilingualEmbedding(onProgress);
  const current = getWorker();
  const id = ++nextId;
  return new Promise<number[][]>((resolve, reject) => {
    pending.set(id, { kind: "embed", resolve, reject, onProgress });
    current.postMessage({ id, type: "embed", texts: clean, kind });
  });
}

export async function multilingualEmbed(
  text: string,
  kind: "query" | "passage",
  onProgress?: (info: ProgressInfo) => void
): Promise<number[]> {
  const vectors = await multilingualEmbedMany([text], kind, onProgress);
  if (!vectors[0]) throw new Error("Hasil embedding kosong.");
  return vectors[0];
}

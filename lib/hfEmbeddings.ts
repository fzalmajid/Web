// Shared per-tab browser model: all modes (Local / GPT / Gemini / Claude)
// use the same multilingual retrieval vectors, independently of the LLM API.
export const HF_EMBEDDING_MODEL = "intfloat/multilingual-e5-small";

type ProgressInfo = { status: string; loaded: number; total: number };
type Pending = {
  resolve: (vector: number[]) => void;
  reject: (error: Error) => void;
  onProgress?: (info: ProgressInfo) => void;
};
let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, Pending>();

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
    if (data?.type === "error") item.reject(new Error(String(data.message || "Embedding gagal.")));
    else if (data?.type === "result" && Array.isArray(data.vector) &&
             data.vector.length === 384 && data.vector.every(Number.isFinite)) {
      item.resolve(data.vector);
    } else item.reject(new Error("Hasil embedding tidak valid."));
  };
  current.onerror = () => {
    for (const request of pending.values()) request.reject(new Error("Worker embedding gagal dimuat."));
    pending.clear();
    current.terminate();
    if (worker === current) worker = null;
  };
  worker = current;
  return current;
}

export function multilingualEmbed(
  text: string, kind: "query" | "passage",
  onProgress?: (info: ProgressInfo) => void
): Promise<number[]> {
  if (!text.trim()) return Promise.reject(new Error("Teks embedding kosong."));
  const current = getWorker();
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    current.postMessage({ id, text, kind });
  });
}

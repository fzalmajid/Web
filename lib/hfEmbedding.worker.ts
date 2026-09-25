// Runs fully in the user's browser. No Gemini, GPT, HF API token or paid
// inference endpoint is required; the public ONNX model is cached locally.
import { pipeline, env } from "@huggingface/transformers";

const MODEL = "Xenova/multilingual-e5-small";
const DIMENSIONS = 384;
env.allowLocalModels = false;
env.useBrowserCache = true;

let extractorPromise: Promise<any> | null = null;
let activeDevice: "webgpu" | "wasm" = "wasm";
let queue: Promise<void> = Promise.resolve();

type WorkerRequest =
  | { id: number; type: "warmup" }
  | { id: number; type: "embed"; kind: "query" | "passage"; texts: string[] };

function postProgress(id: number, event: any) {
  if (!event || !["progress", "initiate", "done"].includes(String(event.status || ""))) return;
  self.postMessage({
    id,
    type: "progress",
    status: String(event.status),
    loaded: Number(event.loaded || 0),
    total: Number(event.total || 0)
  });
}

async function createExtractor(id: number) {
  const canUseWebGpu = Boolean((self.navigator as any)?.gpu);
  const devices: Array<"webgpu" | "wasm"> = canUseWebGpu ? ["webgpu", "wasm"] : ["wasm"];
  let lastError: unknown = null;

  for (const device of devices) {
    try {
      const extractor = await pipeline("feature-extraction", MODEL, {
        dtype: "q8",
        device: device as any,
        progress_callback: (event: any) => postProgress(id, event)
      });
      activeDevice = device;
      return extractor;
    } catch (error) {
      lastError = error;
      // Some browsers expose navigator.gpu but cannot create a usable adapter.
      // Fall back to WASM without making the whole indexing job fail.
      if (device === "webgpu") continue;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Model multilingual gagal dimuat.");
}

function getExtractor(id: number) {
  extractorPromise ??= createExtractor(id).catch((error) => {
    extractorPromise = null;
    throw error;
  });
  return extractorPromise;
}

function normalizeVector(values: number[]) {
  if (values.length !== DIMENSIONS || values.some((n) => !Number.isFinite(n))) {
    throw new Error("Model multilingual tidak menghasilkan 384 dimensi.");
  }
  const magnitude = Math.hypot(...values);
  if (!magnitude) throw new Error("Vektor embedding kosong.");
  return values.map((n) => n / magnitude);
}

async function warmup(input: Extract<WorkerRequest, { type: "warmup" }>) {
  try {
    const extractor = await getExtractor(input.id);
    // Compile/initialize the backend now so the user's first real question does
    // not pay model startup cost. The result is discarded.
    await extractor("query: pemanasan model", { pooling: "mean", normalize: true });
    self.postMessage({ id: input.id, type: "ready", device: activeDevice });
  } catch (error) {
    self.postMessage({
      id: input.id,
      type: "error",
      message: error instanceof Error ? error.message.slice(0, 300) : "Gagal memuat model multilingual."
    });
  }
}

async function embedMany(input: Extract<WorkerRequest, { type: "embed" }>) {
  try {
    const extractor = await getExtractor(input.id);
    const texts = input.texts
      .map((text) => String(text || "").trim().slice(0, 1750))
      .filter(Boolean);
    if (!texts.length) throw new Error("Teks embedding kosong.");

    // Transformers.js feature-extraction accepts a string array, allowing one
    // batched tokenizer/inference pass instead of one model call per chunk.
    const prefixed = texts.map((text) => input.kind + ": " + text);
    const result = await extractor(prefixed, { pooling: "mean", normalize: true });
    const flat = Array.from(result.data, (n: number | bigint) => Number(n));
    if (flat.length !== texts.length * DIMENSIONS) {
      throw new Error("Bentuk hasil embedding multilingual tidak sesuai.");
    }

    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i++) {
      vectors.push(normalizeVector(flat.slice(i * DIMENSIONS, (i + 1) * DIMENSIONS)));
    }
    self.postMessage({ id: input.id, type: "result", vectors, device: activeDevice });
  } catch (error) {
    self.postMessage({
      id: input.id,
      type: "error",
      message: error instanceof Error ? error.message.slice(0, 300) : "Gagal menjalankan model multilingual."
    });
  }
}

self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const input = event.data;
  if (!input || typeof input.id !== "number") return;

  // One worker owns one model session. Inference jobs are serialized, while
  // each individual job can contain many passages and therefore uses the
  // model efficiently without duplicating RAM/VRAM sessions.
  queue = queue.then(async () => {
    if (input.type === "warmup") await warmup(input);
    else if (input.type === "embed" && ["query", "passage"].includes(input.kind) &&
      Array.isArray(input.texts)) await embedMany(input);
  }).catch(() => undefined);
});

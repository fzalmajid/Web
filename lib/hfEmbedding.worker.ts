// Runs fully in the user's browser. No Gemini, GPT, HF API token or paid
// inference endpoint is required; the public ONNX model is cached locally.
import { pipeline, env } from "@huggingface/transformers";

const MODEL = "Xenova/multilingual-e5-small";
env.allowLocalModels = false;
env.useBrowserCache = true;
let extractorPromise: Promise<any> | null = null;
let queue: Promise<void> = Promise.resolve();

type WorkerRequest = { id: number; kind: "query" | "passage"; text: string };
function getExtractor(id: number) {
  extractorPromise ??= pipeline("feature-extraction", MODEL, {
    dtype: "q8",
    device: "wasm",
    progress_callback: (event: any) => {
      if (event?.status === "progress" || event?.status === "initiate" || event?.status === "done") {
        self.postMessage({
          id,
          type: "progress",
          status: String(event.status),
          loaded: Number(event.loaded || 0),
          total: Number(event.total || 0)
        });
      }
    }
  }).catch((error) => {
    extractorPromise = null;
    throw error;
  });
  return extractorPromise;
}

async function embed(input: WorkerRequest) {
  try {
    const extractor = await getExtractor(input.id);
    // E5 is asymmetric: query and passage prefixes are necessary even when
    // the two languages differ (for example Indonesian query / English HOPE).
    const result = await extractor(input.kind + ": " + input.text.slice(0, 1750), {
      pooling: "mean",
      normalize: true
    });
    const values = Array.from(result.data, (n: number | bigint) => Number(n));
    if (values.length !== 384 || values.some((n) => !Number.isFinite(n))) {
      throw new Error("Model multilingual tidak menghasilkan 384 dimensi.");
    }
    const magnitude = Math.hypot(...values);
    if (!magnitude) throw new Error("Vektor embedding kosong.");
    self.postMessage({ id: input.id, type: "result", vector: values.map((n) => n / magnitude) });
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
  if (!input || typeof input.id !== "number" || !["query", "passage"].includes(input.kind) ||
      typeof input.text !== "string") return;
  // A single worker serializes inference so concurrent chat/index jobs cannot
  // exhaust device RAM or instantiate duplicate model sessions.
  queue = queue.then(() => embed(input)).catch(() => undefined);
});

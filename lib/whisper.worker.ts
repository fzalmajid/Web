import { env, pipeline } from "@huggingface/transformers";

env.allowLocalModels = false;
env.useBrowserCache = true;

let activeModel = "";
let transcriberPromise: Promise<any> | null = null;
let queue: Promise<void> = Promise.resolve();

type WhisperRequest = {
  id: number;
  type: "transcribe";
  model: string;
  device: "webgpu" | "wasm";
  samples: Float32Array;
  sampleRate: number;
};

function progress(id: number, event: any) {
  if (!event || !["initiate", "progress", "done"].includes(String(event.status || ""))) return;
  self.postMessage({
    id,
    type: "progress",
    status: String(event.status || ""),
    loaded: Number(event.loaded || 0),
    total: Number(event.total || 0),
  });
}

async function getTranscriber(id: number, model: string, device: "webgpu" | "wasm") {
  const key = model + ":" + device;
  if (activeModel !== key) {
    if (transcriberPromise) { const old = await transcriberPromise.catch(() => null); await old?.dispose(); }
    transcriberPromise = null;
    activeModel = key;
  }
  transcriberPromise ??= pipeline("automatic-speech-recognition", model, {
    device,
    dtype: device === "webgpu" ? "q4" : "q8",
    progress_callback: (event: any) => progress(id, event),
  } as any).catch((error) => {
    transcriberPromise = null;
    throw error;
  });
  return transcriberPromise;
}

async function run(input: WhisperRequest) {
  try {
    const transcriber = await getTranscriber(input.id, input.model, input.device);
    const result = await transcriber(input.samples, {
      sampling_rate: input.sampleRate,
      language: "indonesian",
      task: "transcribe",
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: true,
    });
    const text = String(result?.text || "").replace(/\s+/g, " ").trim();
    self.postMessage({ id: input.id, type: "result", text, chunks: result?.chunks || [], model: input.model, device: input.device });
  } catch (error) {
    self.postMessage({
      id: input.id,
      type: "error",
      message: error instanceof Error ? error.message.slice(0, 400) : "Whisper lokal gagal.",
    });
  }
}

self.addEventListener("message", (event: MessageEvent<WhisperRequest>) => {
  const input = event.data;
  if (!input || input.type !== "transcribe" || typeof input.id !== "number") return;
  queue = queue.then(() => run(input)).catch(() => undefined);
});

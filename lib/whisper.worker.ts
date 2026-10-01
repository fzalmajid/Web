// Local browser-only Whisper ASR. Model weights are downloaded from Hugging Face
// once and cached by the browser; no HF token or paid inference endpoint is used.
import { env, pipeline } from "@huggingface/transformers";

const MODEL = "Xenova/whisper-tiny";
env.allowLocalModels = false;
env.useBrowserCache = true;

type WorkerRequest =
  | { id: number; type: "warmup" }
  | { id: number; type: "transcribe"; audio: Float32Array; language?: string };

let transcriberPromise: Promise<any> | null = null;
let activeDevice: "webgpu" | "wasm" = "wasm";
let queue: Promise<void> = Promise.resolve();

function postProgress(id: number, event: any) {
  if (!event || !["progress", "initiate", "done"].includes(String(event.status || ""))) return;
  self.postMessage({
    id,
    type: "progress",
    status: String(event.status || ""),
    file: String(event.file || ""),
    loaded: Number(event.loaded || 0),
    total: Number(event.total || 0),
  });
}

async function createTranscriber(id: number) {
  const canUseWebGpu = Boolean((self.navigator as any)?.gpu);
  const devices: Array<"webgpu" | "wasm"> = canUseWebGpu ? ["webgpu", "wasm"] : ["wasm"];
  let lastError: unknown = null;

  for (const device of devices) {
    try {
      const pipe = await pipeline("automatic-speech-recognition", MODEL, {
        device: device as any,
        dtype: "q8",
        progress_callback: (event: any) => postProgress(id, event),
      });
      activeDevice = device;
      return pipe;
    } catch (error) {
      lastError = error;
      if (device === "webgpu") continue;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Whisper lokal gagal dimuat.");
}

function getTranscriber(id: number) {
  transcriberPromise ??= createTranscriber(id).catch((error) => {
    transcriberPromise = null;
    throw error;
  });
  return transcriberPromise;
}

async function warmup(id: number) {
  try {
    await getTranscriber(id);
    self.postMessage({ id, type: "ready", device: activeDevice, model: MODEL });
  } catch (error) {
    self.postMessage({
      id,
      type: "error",
      message: error instanceof Error ? error.message.slice(0, 400) : "Whisper lokal gagal dimuat.",
    });
  }
}

async function transcribe(input: Extract<WorkerRequest, { type: "transcribe" }>) {
  try {
    if (!(input.audio instanceof Float32Array) || input.audio.length < 1600) {
      throw new Error("Audio lokal terlalu pendek atau tidak valid.");
    }
    const pipe = await getTranscriber(input.id);
    const output = await pipe(input.audio, {
      language: input.language || "indonesian",
      task: "transcribe",
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: true,
    });
    const text = String(output?.text || "").replace(/\s+/g, " ").trim();
    if (!text) throw new Error("Whisper lokal tidak menghasilkan teks.");
    self.postMessage({
      id: input.id,
      type: "result",
      text,
      chunks: Array.isArray(output?.chunks) ? output.chunks : [],
      device: activeDevice,
      model: MODEL,
    });
  } catch (error) {
    self.postMessage({
      id: input.id,
      type: "error",
      message: error instanceof Error ? error.message.slice(0, 400) : "Transkripsi Whisper lokal gagal.",
    });
  }
}

self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const input = event.data;
  if (!input || typeof input.id !== "number") return;
  queue = queue.then(async () => {
    if (input.type === "warmup") await warmup(input.id);
    else if (input.type === "transcribe") await transcribe(input);
  }).catch(() => undefined);
});

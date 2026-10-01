export const LOCAL_WHISPER_MODEL = "Xenova/whisper-tiny";

export type WhisperProgress = {
  status: string;
  file: string;
  loaded: number;
  total: number;
};

type Pending = {
  kind: "warmup" | "transcribe";
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: WhisperProgress) => void;
};

let worker: Worker | null = null;
let nextId = 0;
let warmupPromise: Promise<void> | null = null;
let ready = false;
const pending = new Map<number, Pending>();

function resetWorker(current: Worker) {
  for (const item of pending.values()) item.reject(new Error("Worker Whisper lokal berhenti."));
  pending.clear();
  current.terminate();
  if (worker === current) worker = null;
  ready = false;
  warmupPromise = null;
}

function getWorker() {
  if (typeof window === "undefined") throw new Error("Whisper lokal memerlukan browser.");
  if (worker) return worker;

  const current = new Worker(new URL("./whisper.worker.ts", import.meta.url), { type: "module" });
  current.onmessage = (event: MessageEvent<any>) => {
    const data = event.data;
    const id = Number(data?.id);
    const item = pending.get(id);
    if (!item) return;

    if (data?.type === "progress") {
      item.onProgress?.({
        status: String(data.status || ""),
        file: String(data.file || ""),
        loaded: Number(data.loaded || 0),
        total: Number(data.total || 0),
      });
      return;
    }

    pending.delete(id);
    if (data?.type === "error") {
      item.reject(new Error(String(data.message || "Whisper lokal gagal.")));
      return;
    }
    if (data?.type === "ready" && item.kind === "warmup") {
      ready = true;
      item.resolve(undefined);
      return;
    }
    if (data?.type === "result" && item.kind === "transcribe") {
      item.resolve({
        text: String(data.text || "").trim(),
        chunks: Array.isArray(data.chunks) ? data.chunks : [],
        device: String(data.device || "wasm"),
        model: String(data.model || LOCAL_WHISPER_MODEL),
      });
      return;
    }
    item.reject(new Error("Respons Whisper lokal tidak dikenali."));
  };
  current.onerror = () => resetWorker(current);
  worker = current;
  return current;
}

export function isLocalWhisperReady() {
  return ready;
}

export function preloadLocalWhisper(onProgress?: (progress: WhisperProgress) => void) {
  if (ready) return Promise.resolve();
  if (warmupPromise) return warmupPromise;
  const current = getWorker();
  const id = ++nextId;
  warmupPromise = new Promise<void>((resolve, reject) => {
    pending.set(id, { kind: "warmup", resolve, reject, onProgress });
    current.postMessage({ id, type: "warmup" });
  }).catch((error) => {
    warmupPromise = null;
    throw error;
  });
  return warmupPromise;
}

function mixToMono(buffer: AudioBuffer) {
  const output = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i++) output[i] += data[i] / buffer.numberOfChannels;
  }
  return output;
}

function resampleLinear(input: Float32Array, sourceRate: number, targetRate = 16000) {
  if (sourceRate === targetRate) return input;
  const ratio = sourceRate / targetRate;
  const length = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const sourceIndex = i * ratio;
    const left = Math.floor(sourceIndex);
    const right = Math.min(input.length - 1, left + 1);
    const fraction = sourceIndex - left;
    output[i] = input[left] * (1 - fraction) + input[right] * fraction;
  }
  return output;
}

async function decodeBlob16k(blob: Blob) {
  const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextCtor) throw new Error("Web Audio tidak tersedia untuk Whisper lokal.");
  const context: AudioContext = new AudioContextCtor();
  try {
    const bytes = await blob.arrayBuffer();
    const decoded = await context.decodeAudioData(bytes.slice(0));
    if (decoded.duration > 20 * 60) {
      throw new Error("Whisper lokal dibatasi 20 menit per rekaman agar browser tetap responsif.");
    }
    return resampleLinear(mixToMono(decoded), decoded.sampleRate, 16000);
  } finally {
    if (context.state !== "closed") await context.close().catch(() => {});
  }
}

export async function transcribeBlobLocally(
  blob: Blob,
  onProgress?: (progress: WhisperProgress) => void
) {
  const audio = await decodeBlob16k(blob);
  await preloadLocalWhisper(onProgress);
  const current = getWorker();
  const id = ++nextId;
  return new Promise<{ text: string; chunks: any[]; device: string; model: string }>((resolve, reject) => {
    pending.set(id, { kind: "transcribe", resolve, reject, onProgress });
    current.postMessage({ id, type: "transcribe", audio, language: "indonesian" }, [audio.buffer]);
  });
}

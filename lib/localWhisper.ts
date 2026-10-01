import type { AiExperienceMode } from "@/lib/aiOrchestration";
import { remapTranscript, type SpeechTimeMap } from "./audioTimeline";

export type WhisperDevice = "webgpu" | "wasm";
export type WhisperModelTier = "tiny" | "base" | "small";

export type WhisperCapability = {
  device: WhisperDevice;
  tier: WhisperModelTier;
  model: string;
  hardwareConcurrency: number;
  deviceMemory: number | null;
  reason: string;
};

const WHISPER_MODELS: Record<WhisperModelTier, string> = {
  tiny: "onnx-community/whisper-tiny",
  base: "onnx-community/whisper-base",
  small: "onnx-community/whisper-small",
};

export function probeWhisperCapability(): WhisperCapability {
  if (typeof window === "undefined") {
    return { device: "wasm", tier: "tiny", model: WHISPER_MODELS.tiny, hardwareConcurrency: 1, deviceMemory: null, reason: "Browser belum aktif." };
  }
  const hardwareConcurrency = Math.max(1, Number(navigator.hardwareConcurrency || 1));
  const deviceMemory = Number.isFinite(Number((navigator as any).deviceMemory))
    ? Number((navigator as any).deviceMemory)
    : null;
  const webgpu = Boolean((navigator as any).gpu);
  // Unknown memory is not evidence of capacity; prefer Base over forcing Small.
  const strong = webgpu && hardwareConcurrency >= 8 && deviceMemory !== null && deviceMemory >= 8;
  const medium = webgpu && hardwareConcurrency >= 4 && (deviceMemory === null || deviceMemory >= 4);
  const tier: WhisperModelTier = strong ? "small" : medium ? "base" : "tiny";
  return {
    device: webgpu ? "webgpu" : "wasm",
    tier,
    model: WHISPER_MODELS[tier],
    hardwareConcurrency,
    deviceMemory,
    reason: strong
      ? "WebGPU dan kapasitas perangkat memadai untuk Small."
      : medium
        ? "WebGPU tersedia; Base dipilih agar tetap responsif."
        : "Perangkat belum cukup kuat; Tiny/WASM dipilih untuk mencegah beban berlebih.",
  };
}

export function whisperCapabilityForMode(mode: AiExperienceMode): WhisperCapability {
  const capability = probeWhisperCapability();
  if (mode === "simple" || capability.tier === "tiny") return capability;
  return capability;
}

type Pending = {
  resolve: (value: { text: string; chunks: any[]; model: string; device: WhisperDevice }) => void;
  reject: (error: Error) => void;
  onProgress?: (message: string) => void;
  timer?: ReturnType<typeof setTimeout>;
};

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, Pending>();

function resetWorker(current: Worker) {
  for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error("Worker Whisper berhenti atau batas waktu pemrosesan terlampaui.")); }
  pending.clear();
  current.terminate();
  if (worker === current) worker = null;
}

function getWorker() {
  if (typeof window === "undefined") throw new Error("Whisper lokal memerlukan browser.");
  if (worker) return worker;
  const current = new Worker(new URL("./whisper.worker.ts", import.meta.url), { type: "module" });
  current.onmessage = (event: MessageEvent<any>) => {
    const id = Number(event.data?.id);
    const item = pending.get(id);
    if (!item) return;
    if (event.data?.type === "progress") {
      const total = Number(event.data.total || 0);
      const loaded = Number(event.data.loaded || 0);
      item.onProgress?.(total > 0 ? `Memuat Whisper lokal: ${Math.round(loaded / total * 100)}%` : "Menyiapkan Whisper lokal...");
      return;
    }
    pending.delete(id);
    clearTimeout(item.timer);
    if (event.data?.type === "error") item.reject(new Error(String(event.data.message || "Whisper lokal gagal.")));
    else if (event.data?.type === "result") item.resolve({
      text: String(event.data.text || ""),
      chunks: Array.isArray(event.data.chunks) ? event.data.chunks : [],
      model: String(event.data.model || ""),
      device: event.data.device === "webgpu" ? "webgpu" : "wasm",
    });
    else item.reject(new Error("Respons Whisper lokal tidak dikenali."));
  };
  current.onerror = () => resetWorker(current);
  worker = current;
  return current;
}

async function decodeToMono(blob: Blob) {
  const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextCtor) throw new Error("Web Audio tidak tersedia untuk Whisper lokal.");
  const context: AudioContext = new AudioContextCtor();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    if(decoded.duration>1200)throw new Error("Transkripsi lokal dibatasi 20 menit per potongan untuk menjaga memori perangkat.");
    const length = Math.max(1, Math.ceil(decoded.duration * 16000));
    const mono = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      const sourceIndex = Math.min(decoded.length - 1, Math.floor(i * decoded.sampleRate / 16000));
      let sum = 0;
      for (let channel = 0; channel < decoded.numberOfChannels; channel++) sum += decoded.getChannelData(channel)[sourceIndex] || 0;
      mono[i] = sum / decoded.numberOfChannels;
    }
    return { samples: mono, sampleRate: 16000 };
  } finally {
    await context.close().catch(() => undefined);
  }
}

async function speechOnly(samples: Float32Array, sampleRate: number, onProgress?: (message: string) => void) {
  const timeMap: SpeechTimeMap[] = [];
  try {
    const { NonRealTimeVAD } = await import("@ricky0123/vad-web");
    const vad = await NonRealTimeVAD.new({
      modelURL: "/vad/silero_vad_legacy.onnx",
      ortConfig: (ort: any) => {
        ort.env.wasm.wasmPaths = "/vad/";
        ort.env.logLevel = "error";
      },
      positiveSpeechThreshold: 0.55,
      negativeSpeechThreshold: 0.35,
      redemptionMs: 700,
      preSpeechPadMs: 250,
      minSpeechMs: 180,
    });
    const chunks: Float32Array[] = [];
    let compact = 0;
    for await (const segment of vad.run(samples, sampleRate)) {
      const length = segment.audio.length / 16000;
      chunks.push(segment.audio);
      // VAD start excludes pre-speech padding; audio includes it. Derive its
      // actual beginning from end minus emitted sample duration.
      timeMap.push({ compactStart: compact, compactEnd: compact + length, originalStart: Math.max(0, segment.end / 1000 - length), originalEnd: Math.min(samples.length / sampleRate, segment.end / 1000) });
      compact += length;
    }
    if (typeof vad === "object" && "destroy" in vad) await (vad as any).destroy().catch(() => undefined);
    const size = chunks.reduce((total, chunk) => total + chunk.length, 0);
    if (!size) return { samples: new Float32Array(0), usedVad: true, timeMap: [] as SpeechTimeMap[] };
    const merged = new Float32Array(size);
    let offset = 0;
    for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.length; }
    onProgress?.("Silero VAD aktif · bagian hening/noise dipangkas.");
    return { samples: merged, usedVad: true, timeMap };
  } catch {
    onProgress?.("Silero VAD belum tersedia · audio utuh diteruskan ke Whisper.");
    return { samples, usedVad: false, timeMap: [] as SpeechTimeMap[] };
  }
}

export async function transcribeBrowserAudio(blob: Blob, options: {
  mode?: AiExperienceMode;
  onProgress?: (message: string) => void;
} = {}) {
  if (!blob.size) throw new Error("Audio kosong.");
  const capability = whisperCapabilityForMode(options.mode || "instant");
  options.onProgress?.(capability.reason);
  const decoded = await decodeToMono(blob);
  const speech = await speechOnly(decoded.samples, decoded.sampleRate, options.onProgress);
  if(speech.usedVad&&!speech.samples.length){options.onProgress?.("Tidak ada ucapan terdeteksi; audio hening tidak dikirim ke Whisper/cloud.");return {text:"",chunks:[] as ReturnType<typeof remapTranscript>,model:capability.model,device:capability.device,usedVad:true,tier:capability.tier,noSpeech:true};}
  async function runWorker(model: string, device: WhisperDevice) {
    const current = getWorker();
    const id = ++nextId;
    const transferableSamples = speech.samples.slice();
    return new Promise<{ text: string; chunks: any[]; model: string; device: WhisperDevice }>((resolve, reject) => {
      pending.set(id, { resolve, reject, onProgress: options.onProgress, timer: setTimeout(()=>resetWorker(current),300_000) });
      current.postMessage({
        id,
        type: "transcribe",
        model,
        device,
        samples: transferableSamples,
        sampleRate: decoded.sampleRate,
      }, [transferableSamples.buffer]);
    });
  }

  let result: { text: string; chunks: any[]; model: string; device: WhisperDevice };
  try {
    result = await runWorker(capability.model, capability.device);
  } catch (error) {
    if (capability.device !== "webgpu") throw error;
    options.onProgress?.("WebGPU tidak dapat menjalankan Whisper · fallback ke WASM/Tiny...");
    result = await runWorker(WHISPER_MODELS.tiny, "wasm");
  }
  return { ...result, chunks: remapTranscript(result.chunks, speech.timeMap, decoded.samples.length / decoded.sampleRate), usedVad: speech.usedVad, tier: result.model === WHISPER_MODELS.tiny ? "tiny" : capability.tier };
}

// Compatibility shims for the existing Record UI. New callers should use
// transcribeBrowserAudio so they can select the adaptive device/model policy.
export const LOCAL_WHISPER_MODEL = WHISPER_MODELS.tiny;
export type WhisperProgress = { status: string; file: string; loaded: number; total: number };

export function isLocalWhisperReady() {
  return false;
}

export async function preloadLocalWhisper(onProgress?: (progress: WhisperProgress) => void) {
  onProgress?.({ status: "ready", file: "", loaded: 0, total: 0 });
}

export async function transcribeBlobLocally(
  blob: Blob,
  onProgress?: (progress: WhisperProgress) => void
) {
  const result = await transcribeBrowserAudio(blob, {
    mode: "instant",
    onProgress: (message) => onProgress?.({ status: "progress", file: message, loaded: 0, total: 0 }),
  });
  return { text: result.text, chunks: result.chunks, device: result.device, model: result.model };
}

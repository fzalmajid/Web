import type { AiExperienceMode } from "@/lib/aiOrchestration";
import { remapTranscript, type SpeechTimeMap } from "./audioTimeline";
import { decodeBrowserAudio } from "./audioDecode";
import { WHISPER_MODELS, selectWhisperCapability, audioAbortError, checkAudioAbort, validateLocalAudio, isDigitalSilence, type WhisperCapability, type WhisperDevice } from "./audioPolicy";
export type { WhisperCapability, WhisperDevice, WhisperModelTier } from "./audioPolicy";

export function probeWhisperCapability(): WhisperCapability {
  if (typeof window === "undefined") {
    return { device: "wasm", tier: "tiny", model: WHISPER_MODELS.tiny, hardwareConcurrency: 1, deviceMemory: null, reason: "Browser belum aktif." };
  }
  return selectWhisperCapability({ webgpu: Boolean((navigator as any).gpu), hardwareConcurrency: navigator.hardwareConcurrency, deviceMemory: (navigator as any).deviceMemory });
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
  cleanup?: () => void;
};

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, Pending>();
let idleTimer: ReturnType<typeof setTimeout> | undefined;

function resetWorker(current: Worker, error = new Error("Worker Whisper berhenti atau batas waktu pemrosesan terlampaui.")) {
  clearTimeout(idleTimer);
  for (const item of pending.values()) { clearTimeout(item.timer); item.cleanup?.(); item.reject(error); }
  pending.clear();
  current.terminate();
  if (worker === current) worker = null;
}

function getWorker() {
  if (typeof window === "undefined") throw new Error("Whisper lokal memerlukan browser.");
  clearTimeout(idleTimer);
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
    item.cleanup?.();
    if (event.data?.type === "error") item.reject(new Error(String(event.data.message || "Whisper lokal gagal.")));
    else if (event.data?.type === "result") item.resolve({
      text: String(event.data.text || ""),
      chunks: Array.isArray(event.data.chunks) ? event.data.chunks : [],
      model: String(event.data.model || ""),
      device: event.data.device === "webgpu" ? "webgpu" : "wasm",
    });
    else item.reject(new Error("Respons Whisper lokal tidak dikenali."));
    if (!pending.size) idleTimer = setTimeout(() => resetWorker(current), 30000);
  };
  current.onerror = () => resetWorker(current);
  worker = current;
  return current;
}

async function speechOnly(samples: Float32Array, sampleRate: number, onProgress?: (message: string) => void, signal?: AbortSignal) {
  checkAudioAbort(signal);
  try {
    onProgress?.("Memisahkan ucapan dan hening di perangkat...");
    const result = await new Promise<{ samples: Float32Array; timeMap: SpeechTimeMap[] }>((resolve, reject) => {
      const current = new Worker(new URL("./speechVad.worker.ts", import.meta.url), { type: "module" });
      const finish = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); current.terminate(); };
      const abort = () => { finish(); reject(audioAbortError()); };
      const timer = setTimeout(() => { finish(); reject(new Error("Batas waktu VAD terlampaui.")); }, 180000);
      signal?.addEventListener("abort", abort, { once: true });
      current.onmessage = event => {
        finish();
        if (event.data?.type === "result" && event.data.samples instanceof Float32Array && Array.isArray(event.data.timeMap)) resolve(event.data);
        else reject(new Error("VAD lokal belum tersedia."));
      };
      current.onerror = () => { finish(); reject(new Error("Worker VAD lokal gagal.")); };
      try {
        checkAudioAbort(signal);
        const copy = samples.slice();
        current.postMessage({ samples: copy, sampleRate }, [copy.buffer]);
      } catch (error) { finish(); reject(error); }
    });
    onProgress?.("Silero VAD aktif · bagian hening/noise dipangkas.");
    return { ...result, usedVad: true };
  } catch (error) {
    checkAudioAbort(signal);
    if (error instanceof Error && error.name === "AbortError") throw error;
    onProgress?.("Silero VAD belum tersedia · audio utuh diteruskan ke Whisper.");
    return { samples, usedVad: false, timeMap: [] as SpeechTimeMap[] };
  }
}

export async function transcribeBrowserAudio(blob: Blob, options: {
  mode?: AiExperienceMode;
  onProgress?: (message: string) => void;
  signal?: AbortSignal;
} = {}) {
  validateLocalAudio(blob.size);
  checkAudioAbort(options.signal);
  let capability = whisperCapabilityForMode(options.mode || "instant");
  if (capability.device === "webgpu") {
    const gpu = (navigator as any).gpu;
    const adapter = await Promise.race([Promise.resolve().then(() => gpu.requestAdapter()).catch(() => null), new Promise<null>(resolve => setTimeout(() => resolve(null), 4000))]);
    checkAudioAbort(options.signal);
    if (!adapter) capability = selectWhisperCapability({ webgpu: false, hardwareConcurrency: capability.hardwareConcurrency, deviceMemory: capability.deviceMemory });
  }
  options.onProgress?.(capability.reason);
  const decoded = await decodeBrowserAudio(blob, options.signal);
  if (isDigitalSilence(decoded.samples)) {
    options.onProgress?.("Audio hening; tidak ada model transkripsi yang dijalankan.");
    return { text: "", chunks: [] as ReturnType<typeof remapTranscript>, model: capability.model, device: capability.device, usedVad: false, tier: capability.tier, noSpeech: true };
  }
  const speech = await speechOnly(decoded.samples, decoded.sampleRate, options.onProgress, options.signal);
  if(speech.usedVad&&!speech.samples.length){options.onProgress?.("Tidak ada ucapan terdeteksi; audio hening tidak dikirim ke Whisper/cloud.");return {text:"",chunks:[] as ReturnType<typeof remapTranscript>,model:capability.model,device:capability.device,usedVad:true,tier:capability.tier,noSpeech:true};}
  async function runWorker(model: string, device: WhisperDevice) {
    checkAudioAbort(options.signal);
    const current = getWorker();
    const id = ++nextId;
    const transferableSamples = speech.samples.slice();
    return new Promise<{ text: string; chunks: any[]; model: string; device: WhisperDevice }>((resolve, reject) => {
      const abort = () => resetWorker(current, audioAbortError());
      pending.set(id, { resolve, reject, onProgress: options.onProgress, timer: setTimeout(()=>resetWorker(current),300_000), cleanup: () => options.signal?.removeEventListener("abort", abort) });
      options.signal?.addEventListener("abort", abort, { once: true });
      try { current.postMessage({
        id,
        type: "transcribe",
        model,
        device,
        samples: transferableSamples,
        sampleRate: decoded.sampleRate,
      }, [transferableSamples.buffer]); } catch (error) { resetWorker(current, error instanceof Error ? error : new Error("Audio tidak dapat dikirim ke worker lokal.")); }
    });
  }

  let result: { text: string; chunks: any[]; model: string; device: WhisperDevice };
  try {
    result = await runWorker(capability.model, capability.device);
  } catch (error) {
    checkAudioAbort(options.signal);
    if (error instanceof Error && error.name === "AbortError") throw error;
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

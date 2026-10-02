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

export const WHISPER_MODELS: Record<WhisperModelTier, string> = {
  tiny: "onnx-community/whisper-tiny",
  base: "onnx-community/whisper-base",
  small: "onnx-community/whisper-small",
};
export const MAX_LOCAL_AUDIO_BYTES = 40 * 1024 * 1024;
export const MAX_LOCAL_AUDIO_SECONDS = 1200;

export function selectWhisperCapability(input: {
  webgpu: boolean;
  hardwareConcurrency?: number;
  deviceMemory?: number | null;
}): WhisperCapability {
  const cores = Number(input.hardwareConcurrency);
  const hardwareConcurrency = Number.isFinite(cores) ? Math.max(1, Math.floor(cores)) : 1;
  const memory = input.deviceMemory;
  const deviceMemory = typeof memory === "number" && Number.isFinite(memory) && memory > 0 ? memory : null;
  const strong = input.webgpu && hardwareConcurrency >= 8 && deviceMemory !== null && deviceMemory >= 8;
  const medium = input.webgpu && hardwareConcurrency >= 4 && (deviceMemory === null || deviceMemory >= 4);
  const tier: WhisperModelTier = strong ? "small" : medium ? "base" : "tiny";
  return {
    device: input.webgpu ? "webgpu" : "wasm", tier, model: WHISPER_MODELS[tier], hardwareConcurrency, deviceMemory,
    reason: strong ? "Akselerasi grafis tersedia · kualitas lokal lebih teliti."
      : medium ? "Akselerasi grafis tersedia · kualitas lokal seimbang."
        : "Mode lokal ringan dipilih untuk menjaga memori perangkat.",
  };
}

export function validateLocalAudio(size: number, duration?: number) {
  if (!Number.isFinite(size) || size <= 0) throw new Error("Audio kosong.");
  if (size > MAX_LOCAL_AUDIO_BYTES) throw new Error("Audio lokal dibatasi 40 MB. Potong audio menjadi bagian yang lebih kecil.");
  if (duration !== undefined && (!Number.isFinite(duration) || duration <= 0 || duration > MAX_LOCAL_AUDIO_SECONDS)) {
    throw new Error("Transkripsi lokal dibatasi 20 menit per potongan. Potong audio menjadi bagian yang lebih pendek.");
  }
}

export function audioAbortError() { return new DOMException("Pemrosesan audio dibatalkan.", "AbortError"); }
export function checkAudioAbort(signal?: AbortSignal) { if (signal?.aborted) throw audioAbortError(); }
export function isDigitalSilence(samples: Float32Array) { return samples.length > 0 && samples.every(value => value === 0); }

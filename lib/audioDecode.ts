import { checkAudioAbort, validateLocalAudio } from "./audioPolicy";

/** Native Web Audio resampling applies low-pass filtering before downsampling. */
export async function decodeBrowserAudio(blob: Blob, signal?: AbortSignal) {
  validateLocalAudio(blob.size);
  checkAudioAbort(signal);
  const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextCtor) throw new Error("Web Audio tidak tersedia untuk transkripsi lokal.");
  const context: AudioContext = new AudioContextCtor();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    checkAudioAbort(signal);
    validateLocalAudio(blob.size, decoded.duration);
    const sampleRate = 16000;
    const length = Math.max(1, Math.ceil(decoded.duration * sampleRate));
    if (decoded.sampleRate === sampleRate) {
      const samples = new Float32Array(length);
      for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
        const channelData = decoded.getChannelData(channel);
        for (let i = 0; i < length; i++) samples[i] += (channelData[i] || 0) / decoded.numberOfChannels;
      }
      return { samples, sampleRate };
    }
    const OfflineContextCtor = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
    if (!OfflineContextCtor) throw new Error("Resampling audio lokal belum didukung browser ini.");
    const offline: OfflineAudioContext = new OfflineContextCtor(1, length, sampleRate);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    try {
      const rendered = await offline.startRendering();
      checkAudioAbort(signal);
      return { samples: rendered.getChannelData(0).slice(), sampleRate };
    } finally { source.disconnect(); }
  } finally { await context.close().catch(() => undefined); }
}

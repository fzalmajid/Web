import { NonRealTimeVAD } from "@ricky0123/vad-web";
import type { SpeechTimeMap } from "./audioTimeline";

// One owned worker per job: termination releases the ONNX session even though
// this pinned NonRealTimeVAD version does not expose a public destroy method.
self.addEventListener("message", async (event: MessageEvent<{ samples: Float32Array; sampleRate: number }>) => {
  try {
    const { samples, sampleRate } = event.data;
    const base = self.location.origin + "/vad/";
    const vad = await NonRealTimeVAD.new({
      modelURL: base + "silero_vad_legacy.onnx",
      modelFetcher: async path => {
        const response = await fetch(path, { signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error("Aset VAD belum tersedia.");
        return response.arrayBuffer();
      },
      ortConfig: (ort: any) => { ort.env.wasm.wasmPaths = base; ort.env.wasm.numThreads = 1; ort.env.logLevel = "error"; },
      positiveSpeechThreshold: 0.55, negativeSpeechThreshold: 0.35,
      redemptionMs: 700, preSpeechPadMs: 250, minSpeechMs: 180,
    });
    const chunks: Float32Array[] = [], timeMap: SpeechTimeMap[] = [];
    let compact = 0;
    for await (const segment of vad.run(samples, sampleRate)) {
      const length = segment.audio.length / 16000;
      chunks.push(segment.audio);
      timeMap.push({ compactStart: compact, compactEnd: compact + length, originalStart: Math.max(0, segment.end / 1000 - length), originalEnd: Math.min(samples.length / sampleRate, segment.end / 1000) });
      compact += length;
    }
    const merged = new Float32Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.length; }
    (self as any).postMessage({ type: "result", samples: merged, timeMap }, [merged.buffer]);
  } catch { self.postMessage({ type: "error", message: "Pemisahan ucapan lokal belum tersedia." }); }
});

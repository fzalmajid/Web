import path from "node:path";
import { access } from "node:fs/promises";

type LocalOcrResult = {
  text: string;
  confidence: number;
  accepted: boolean;
  reason: string;
};

let workerPromise: Promise<any> | null = null;
let queue: Promise<void> = Promise.resolve();

async function bounded<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([work, new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error("LOCAL_OCR_TIMEOUT")), ms);
    })]);
  } finally { clearTimeout(timer!); }
}

async function getWorker() {
  if (!workerPromise) {
    const workerPath = path.join(process.cwd(), "node_modules/tesseract.js/src/worker-script/node/index.js");
    // Fail before spawning if deployment tracing omitted the worker.
    let expired = false;
    const creation = access(workerPath).then(() => import("tesseract.js"))
      .then(({ createWorker }) => createWorker(["eng", "ind"], 1, { workerPath, cachePath: process.env.VERCEL ? "/tmp" : undefined }))
      .then(async worker => { if (expired) { await worker.terminate(); throw new Error("LOCAL_OCR_TIMEOUT"); } return worker; });
    workerPromise = bounded(creation, 20000)
      .catch((error) => {
        expired = true;
        workerPromise = null;
        throw error;
      });
  }
  return workerPromise;
}

function quality(text: string, confidence: number) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (clean.length < 28) return { accepted: false, reason: "too-short" };
  if (!Number.isFinite(confidence) || confidence < 86) return { accepted: false, reason: "low-confidence" };
  const words = clean.match(/[A-Za-zÀ-ÿ]{2,}/g) || [];
  if (words.length < 4) return { accepted: false, reason: "too-few-words" };

  const symbols = clean.match(/[^A-Za-zÀ-ÿ0-9\s.,;:!?()'"\-/%]/g)?.length || 0;
  const symbolRatio = symbols / Math.max(1, clean.length);
  const numeric = clean.match(/\d/g)?.length || 0;
  const numericRatio = numeric / Math.max(1, clean.length);

  // Dense equations, tables, spectra, chemical diagrams, and similar visual
  // content stay on the multimodal Gemini fallback even if OCR confidence looks high.
  if (symbolRatio > 0.08 || numericRatio > 0.24) {
    return { accepted: false, reason: "complex-layout" };
  }
  return { accepted: true, reason: "simple-text" };
}

export async function recognizeRasterLocally(
  bytes: Buffer,
  mimeType: string
): Promise<LocalOcrResult> {
  if (!/^image\/(?:png|jpe?g|webp|bmp|tiff?)$/i.test(mimeType) || bytes.length > 10 * 1024 * 1024) {
    return { text: "", confidence: 0, accepted: false, reason: "unsupported" };
  }

  let release!: () => void;
  const turn = queue;
  queue = new Promise<void>((resolve) => { release = resolve; });
  await turn.catch(() => undefined);

  try {
    const worker = await getWorker();
    const result = await bounded<any>(worker.recognize(bytes), 20000);
    const text = String(result?.data?.text || "").trim();
    const confidence = Number(result?.data?.confidence || 0);
    const check = quality(text, confidence);
    return { text, confidence, ...check };
  } catch {
    const failed = workerPromise;
    workerPromise = null;
    if (failed) void failed.then(worker => worker.terminate()).catch(() => undefined);
    // Local OCR is an optimization only. Never let it block the existing
    // multimodal OCR path when the worker/core/language files cannot load.
    return { text: "", confidence: 0, accepted: false, reason: "local-error" };
  } finally {
    release();
  }
}

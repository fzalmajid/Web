type LocalOcrResult = {
  text: string;
  confidence: number;
  accepted: boolean;
  reason: string;
};

let workerPromise: Promise<any> | null = null;
let queue: Promise<void> = Promise.resolve();

async function getWorker() {
  if (!workerPromise) {
    workerPromise = import("tesseract.js")
      .then(({ createWorker }) => createWorker(["eng", "ind"]))
      .catch((error) => {
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
    const result = await worker.recognize(bytes);
    const text = String(result?.data?.text || "").trim();
    const confidence = Number(result?.data?.confidence || 0);
    const check = quality(text, confidence);
    return { text, confidence, ...check };
  } catch {
    // Local OCR is an optimization only. Never let it block the existing
    // multimodal OCR path when the worker/core/language files cannot load.
    return { text: "", confidence: 0, accepted: false, reason: "local-error" };
  } finally {
    release();
  }
}

let worker: Worker | null = null, engine: any = null, loading: Promise<any> | null = null;
let cancelLoad: (() => void) | null = null, revision = 0, inferenceBusy = false;
export function localQwenReady() { return Boolean(engine); }
export async function prepareLocalQwen(progress?: (message: string) => void) {
  if (typeof window === "undefined" || !(navigator as any).gpu) throw new Error("WebGPU belum tersedia; helper heuristik lokal tetap aktif.");
  const memory = Number((navigator as any).deviceMemory || 4);
  if (memory < 4 || navigator.hardwareConcurrency < 4) throw new Error("Perangkat terlalu terbatas; helper ringan digunakan.");
  if (engine) return engine;
  if (loading) return loading;
  const id = ++revision;
  let timer: ReturnType<typeof setTimeout>;
  const cancelled = new Promise((_, reject) => { cancelLoad = () => reject(new Error("Pemuatan helper dihentikan; heuristik lokal tetap aktif.")); });
  const task = async () => {
    const llm = await import("@mlc-ai/web-llm");
    if (id !== revision) throw new Error("Pemuatan dibatalkan.");
    worker = new Worker(new URL("./qwen.worker.ts", import.meta.url), { type: "module" });
    const loaded = await llm.CreateWebWorkerMLCEngine(worker, "Qwen2.5-0.5B-Instruct-q4f32_1-MLC", { initProgressCallback: event => { if (id === revision) progress?.(event.text); } });
    if (id !== revision) throw new Error("Pemuatan dibatalkan.");
    engine = loaded; return engine;
  };
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Pemuatan melebihi 3 menit; coba lagi atau gunakan helper ringan.")), 180_000); });
  loading = Promise.race([task(), cancelled, timeout]).catch(error => { if (id === revision) { worker?.terminate(); worker = null; engine = null; loading = null; revision++; } throw error; }).finally(() => { clearTimeout(timer); if (id === revision) cancelLoad = null; });
  return loading;
}
export async function unloadLocalQwen() {
  revision++; cancelLoad?.(); cancelLoad = null;
  worker?.terminate(); engine = null; worker = null; loading = null; inferenceBusy = false;
}
export async function qwenHelper(query: string) {
  if (!engine || inferenceBusy) return null;
  inferenceBusy = true; const active = engine;
  let timer: ReturnType<typeof setTimeout>;
  try {
    const task = active.chat.completions.create({ messages: [{ role: "system", content: "Return JSON: intent (research-and-citation, explain-or-summarize, practice, tutor-question), rewrittenQuery, sourceTerms, notes. Preserve original intent and language. Never turn a request to find references into an explanation. Never invent facts/citations." }, { role: "user", content: query.slice(0, 1600) }], temperature: 0, max_tokens: 200 });
    const result: any = await Promise.race([task, new Promise(resolve => { timer = setTimeout(() => { active.interruptGenerate(); resolve(null); }, 10_000); })]);
    return result ? String(result.choices[0]?.message.content || "") : null;
  } finally { clearTimeout(timer!); inferenceBusy = false; }
}

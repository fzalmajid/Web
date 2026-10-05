import type { GeminiDetailedResult } from "./gemini";
import type { AiUsageProvider } from "./aiQuota";

export type PrimaryGeneration = Omit<GeminiDetailedResult, "finishReason"> & {
  finishReason?: string; provider?: AiUsageProvider;
  usageRecords?: Array<{ model: string; provider: AiUsageProvider; usage: GeminiDetailedResult["usage"] }>;
  primaryRoute?: { path: string[]; combined: boolean; fallback: boolean };
};

/** Server-only configuration. Never serialize this object into client responses. */
export function sharedOpenAiConfig() {
  return { apiKey: String(process.env.OPENAI_API_KEY || "").trim(),
    model: String(process.env.OPENAI_MODEL || "gpt-4.1-mini").trim() };
}

export function primaryFallbackAllowed(error: unknown) {
  const code = String((error as any)?.code || "");
  return ["GEMINI_QUOTA", "WEB_SEARCH_QUOTA", "GEMINI_UNAVAILABLE", "GEMINI_MODEL_UNAVAILABLE",
    "GEMINI_NO_AVAILABLE_MODEL", "GEMINI_AUTH_MISSING", "GEMINI_CONFIG_INCOMPATIBLE", "GEMINI_EMPTY_RESPONSE"].includes(code);
}

/** At most two authorized primary paths. Council helpers remain free-only. */
export async function routePrimary(options: {
  gemini: () => Promise<PrimaryGeneration>;
  openai?: (draft?: PrimaryGeneration) => Promise<PrimaryGeneration>;
  combine?: boolean;
}): Promise<PrimaryGeneration> {
  const receipts: NonNullable<PrimaryGeneration["usageRecords"]> = [];
  const paths: string[] = [];
  const track = (result: PrimaryGeneration) => {
    paths.push(result.model);
    receipts.push(...(result.usageRecords || (result.provider ? [{ model: result.model, provider: result.provider, usage: result.usage }] : [])));
    return result;
  };
  let draft: PrimaryGeneration;
  try { draft = track(await options.gemini()); }
  catch (error) {
    if (!options.openai || !primaryFallbackAllowed(error)) throw error;
    try {
      const result = track(await options.openai());
      return { ...result, usageRecords: receipts, primaryRoute: { path: paths, combined: false, fallback: true } };
    } catch (secondaryError) {
      const billing = ["PROVIDER_CREDIT_EXHAUSTED", "PROVIDER_INSUFFICIENT_QUOTA", "PROVIDER_PROJECT_SPEND_LIMIT", "PROVIDER_ORG_LIMIT"].includes(String((secondaryError as any)?.code || ""));
      if (!billing) throw secondaryError;
      // Do not hide the primary failure behind an unrelated secondary billing
      // error or keep retrying a provider whose credits cannot serve this request.
      const unavailable = new Error("Kedua jalur AI belum dapat melayani permintaan ini: jalur utama sedang tidak tersedia, sedangkan jalur cadangan terhalang saldo/limit Billing API OpenAI. Pertanyaan tidak perlu dikirim ulang. Coba setelah layanan utama pulih atau pengelola memulihkan kredit API; Simple dapat dipakai untuk bahan lokal.");
      Object.assign(unavailable, {code:"PRIMARY_PROVIDERS_UNAVAILABLE",statusCode:503,
        providerCodes:[String((error as any)?.code || ""),String((secondaryError as any)?.code || "")]});
      throw unavailable;
    }
  }
  if (!options.combine || !options.openai) return { ...draft, usageRecords: receipts, primaryRoute: { path: paths, combined: false, fallback: false } };
  try {
    const final = track(await options.openai(draft));
    const seen = new Set<string>();
    return { ...final, webSources: [...draft.webSources, ...final.webSources].filter(source => !seen.has(source.uri) && Boolean(seen.add(source.uri))),
      usageRecords: receipts, primaryRoute: { path: paths, combined: true, fallback: false } };
  } catch {
    // Extra synthesis must not discard a successful Gemini answer, nor create
    // a retry loop when the additional provider has a billing/rate limit.
    return { ...draft, usageRecords: receipts, primaryRoute: { path: paths, combined: false, fallback: true } };
  }
}

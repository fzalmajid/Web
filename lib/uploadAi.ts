import { geminiGenerateDetailed, type GeminiPart, GeminiUnavailableError } from "./gemini";

/** Extraction is literal, not High-mode reasoning; no preview/Pro routing.
 * Restrict discovered fallbacks too, so outages do not consume every attempt on
 * experimental chat models. Existing credentials and accounting are preserved.
 */
export const UPLOAD_MODELS = ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash", "gemini-2.5-flash-lite"];
export async function generateUploadText(parts: GeminiPart[], system: string | undefined,
  options: { apiKey?: string; accessToken?: string; projectId?: string; audio?: boolean; deadlineAt?: number }) {
  const remaining = (options.deadlineAt || Date.now() + 60000) - Date.now();
  if (remaining < 2000) throw new GeminiUnavailableError("Pembacaan file belum selesai. File asli tetap tersimpan; coba proses ulang saat layanan tersedia.");
  const models = options.audio ? ["gemini-3.5-transcribe", ...UPLOAD_MODELS] : UPLOAD_MODELS;
  return geminiGenerateDetailed(parts, system, {
    models, allowedFallbackModels: models, maxAttempts: 3,
    effort: "none", maxThinkingTokens: 512, maxOutputTokens: 12288,
    outputBudgetMultiplier: 1, requestTimeoutMs: Math.min(20000, Math.floor(remaining / 3)),
    apiKey: options.apiKey, accessToken: options.accessToken, projectId: options.projectId,
  });
}

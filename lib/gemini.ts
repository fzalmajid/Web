import { GEMINI_MODEL } from "./config";
import { thinkingConfigForModel, type AiEffort } from "./aiModels";

type GeminiPart = { text?: string; inlineData?: { mimeType: string; data: string } };
export type GeminiWebSource = { title: string; uri: string };
export type GeminiUsage = {
  inputTokens: number;
  outputTokens: number;
  thoughtsTokens: number;
  totalTokens: number;
};

export type GeminiTask = "standard" | "web" | "audio";

export const WHATSAPP_FORMAT_INSTRUCTION =
  "Untuk teks yang akan dibaca user: bold WAJIB memakai *teks*, italic WAJIB memakai _teks_. Setiap penanda * untuk bold harus punya pasangan penutup pada baris yang sama. Untuk daftar/poin WAJIB gunakan '- ' di awal baris, JANGAN gunakan '* ' sebagai bullet. Jangan memakai **teks** atau __teks__. Jangan gunakan markdown heading dengan #.";

export class GeminiApiError extends Error {
  code: string;
  statusCode: number;

  constructor(message: string, statusCode = 500, code = "GEMINI_API_ERROR") {
    super(message);
    this.name = "GeminiApiError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class GeminiQuotaError extends GeminiApiError {
  constructor(message = "Batas penggunaan Gemini API sedang tercapai. Coba lagi setelah quota provider tersedia.") {
    super(message, 429, "GEMINI_QUOTA");
    this.name = "GeminiQuotaError";
  }
}

export class GeminiWebSearchQuotaError extends GeminiApiError {
  constructor(message = "Public Web belum tersedia karena quota Google Search Grounding sedang tidak tersedia atau tercapai.") {
    super(message, 429, "WEB_SEARCH_QUOTA");
    this.name = "GeminiWebSearchQuotaError";
  }
}

export class GeminiUnavailableError extends GeminiApiError {
  constructor(message = "Model Gemini yang dipilih sedang sibuk. Sistem sudah mencoba model fallback yang tersedia, tetapi belum berhasil. Coba lagi sebentar.") {
    super(message, 503, "GEMINI_UNAVAILABLE");
    this.name = "GeminiUnavailableError";
  }
}

export function geminiModelsForMode(
  mode: string,
  task: GeminiTask = "standard"
): string[] {
  if (task === "web") {
    if (mode === "instant") return ["gemini-2.5-flash-lite", "gemini-2.5-flash"];
    return ["gemini-2.5-flash", "gemini-2.5-flash-lite"];
  }

  if (task === "audio") {
    if (mode === "instant") return ["gemini-3.5-flash-lite", "gemini-2.5-flash-lite", "gemini-2.5-flash"];
    if (mode === "medium") return ["gemini-3.5-flash-lite", "gemini-2.5-flash", "gemini-2.5-flash-lite"];
    return ["gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash"];
  }

  if (mode === "instant") return ["gemini-2.5-flash-lite", "gemini-3.5-flash-lite", "gemini-2.5-flash"];
  if (mode === "medium") return ["gemini-2.5-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash-lite"];
  if (mode === "high") return ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-2.5-flash"];
  return [GEMINI_MODEL];
}

function normalizeProviderError(
  response: Response,
  data: any,
  googleSearch: boolean
): GeminiApiError {
  const providerMessage = String(data?.error?.message || "");
  const quotaLike =
    response.status === 429 ||
    /quota|rate.?limit|resource.?exhausted/i.test(providerMessage);
  const busyLike =
    response.status === 502 ||
    response.status === 503 ||
    response.status === 504 ||
    /high demand|overloaded|temporarily unavailable|try again later/i.test(providerMessage);

  if (quotaLike && googleSearch) return new GeminiWebSearchQuotaError();
  if (quotaLike) return new GeminiQuotaError();
  if (busyLike) return new GeminiUnavailableError();

  return new GeminiApiError(
    "Gemini API gagal memproses permintaan ini.",
    response.status >= 400 && response.status < 600 ? response.status : 500
  );
}

export async function geminiGenerateDetailed(
  parts: GeminiPart[],
  systemInstruction?: string,
  options?: { googleSearch?: boolean; models?: string[]; apiKey?: string; effort?: AiEffort }
) {
  const key = String(options?.apiKey || process.env.GEMINI_API_KEY || "").trim();
  if (!key) throw new GeminiApiError("Gemini API key belum tersedia.", 500, "GEMINI_KEY_MISSING");

  const models = Array.from(new Set((options?.models?.length ? options.models : [GEMINI_MODEL]).filter(Boolean)));
  let lastError: GeminiApiError | null = null;

  for (let index = 0; index < models.length; index++) {
    const model = models[index];

    let response: Response;
    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": key,
          },
          body: JSON.stringify({
            systemInstruction: systemInstruction
              ? { parts: [{ text: systemInstruction }] }
              : undefined,
            contents: [{ role: "user", parts }],
            tools: options?.googleSearch ? [{ google_search: {} }] : undefined,
            generationConfig: {
              temperature: model === "gemini-3.5-transcribe" ? undefined : 0.2,
              maxOutputTokens: 8192,
              thinkingConfig: thinkingConfigForModel(model, options?.effort || "none"),
              audioTranscriptionConfig:
                model === "gemini-3.5-transcribe"
                  ? { languageCodes: ["id-ID"], mode: "VERBATIM" }
                  : undefined,
            },
          }),
        }
      );
    } catch {
      lastError = new GeminiUnavailableError();
      if (index < models.length - 1) continue;
      throw lastError;
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = normalizeProviderError(response, data, Boolean(options?.googleSearch));
      lastError = error;
      if (
        index < models.length - 1 &&
        (error.code === "GEMINI_QUOTA" ||
          error.code === "GEMINI_UNAVAILABLE" ||
          error.code === "WEB_SEARCH_QUOTA")
      ) {
        continue;
      }
      throw error;
    }

    const candidate = data?.candidates?.[0];
    const text =
      candidate?.content?.parts
        ?.map((p: { text?: string }) => p.text || "")
        .join("")
        .trim() || "";

    if (!text) {
      lastError = new GeminiApiError("Gemini tidak mengembalikan teks.", 502, "GEMINI_EMPTY_RESPONSE");
      if (index < models.length - 1) continue;
      throw lastError;
    }

    const usageMetadata = data?.usageMetadata || {};
    const usage: GeminiUsage = {
      inputTokens: Number(usageMetadata.promptTokenCount || 0),
      outputTokens: Number(usageMetadata.candidatesTokenCount || usageMetadata.responseTokenCount || 0),
      thoughtsTokens: Number(usageMetadata.thoughtsTokenCount || 0),
      totalTokens: Number(usageMetadata.totalTokenCount || 0),
    };

    const webSources: GeminiWebSource[] = [];
    const seen = new Set<string>();
    const chunks = candidate?.groundingMetadata?.groundingChunks || [];
    for (const chunk of chunks) {
      const web = chunk?.web;
      const uri = String(web?.uri || "").trim();
      const title = String(web?.title || uri || "Sumber web").trim();
      if (!uri || seen.has(uri)) continue;
      seen.add(uri);
      webSources.push({ title, uri });
    }

    return { text, webSources, usage, model };
  }

  throw lastError || new GeminiUnavailableError();
}

export async function geminiGenerate(parts: GeminiPart[], systemInstruction?: string) {
  const result = await geminiGenerateDetailed(parts, systemInstruction);
  return result.text;
}

export function cleanJsonText(value: string) {
  return value.replace(/^\`\`\`json\s*/i, "").replace(/^\`\`\`\s*/i, "").replace(/\s*\`\`\`$/i, "").trim();
}

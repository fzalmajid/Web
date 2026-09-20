import { GEMINI_MODEL } from "./config";
import {
  responseLengthInstruction,
  thinkingConfigForModel,
  type AiEffort,
  type AiResponseLength,
} from "./aiModels";

export type GeminiPart = { text?: string; inlineData?: { mimeType: string; data: string } };
export type GeminiWebSource = { title: string; uri: string };
export type GeminiUsage = {
  inputTokens: number;
  outputTokens: number;
  thoughtsTokens: number;
  totalTokens: number;
};

export type GeminiTask = "standard" | "web" | "audio";

export const WHATSAPP_FORMAT_INSTRUCTION =
  "Untuk teks yang akan dibaca user: bold WAJIB memakai *teks*, italic WAJIB memakai _teks_. Setiap penanda * untuk bold harus punya pasangan penutup pada baris yang sama. Untuk daftar/poin WAJIB gunakan '- ' di awal baris, JANGAN gunakan '* ' sebagai bullet. Jangan memakai **teks** atau __teks__. Jangan gunakan markdown heading dengan #. Untuk rumus, JANGAN bungkus dengan $...$, $...$, \\( ... \\), atau \\[ ... \\] karena UI sudah punya formatter sendiri. JANGAN gunakan * sebagai operator perkalian; gunakan simbol ×. Gunakan subscript ilmiah dengan underscore pada variabel tanpa spasi, misalnya D_oral, AUC_iv, C_2, k_e, atau t_{1/2}. JANGAN escape underscore atau caret dengan backslash: tulis C_1 dan t_2, bukan C\\_1 atau t\\_2; tulis e^{...}, bukan e\\^{...}. Gunakan pangkat dengan ^{...} atau ^(...), misalnya e^{−k_e × Δt}; jangan biarkan tanda ^ berdiri sebagai teks biasa jika maksudnya pangkat.";

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

export class GeminiModelUnavailableError extends GeminiApiError {
  constructor(message = "Model Gemini ini tidak tersedia pada project tersebut.") {
    super(message, 404, "GEMINI_MODEL_UNAVAILABLE");
    this.name = "GeminiModelUnavailableError";
  }
}

const SAFE_GENERATE_FALLBACKS = [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-pro-preview",
  "gemini-3.1-flash-lite",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
];

function geminiAuthHeaders(
  accessToken: string,
  projectId: string,
  key: string
): Record<string, string> {
  return accessToken
    ? {
        "Content-Type": "application/json",
        Authorization: "Bearer " + accessToken,
        "x-goog-user-project": projectId,
      }
    : {
        "Content-Type": "application/json",
        "x-goog-api-key": key,
      };
}

async function listGenerateModels(
  accessToken: string,
  projectId: string,
  key: string
): Promise<string[]> {
  try {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
      {
        headers: geminiAuthHeaders(accessToken, projectId, key),
        cache: "no-store",
      }
    );
    if (!response.ok) return [];

    const data = await response.json().catch(() => ({}));
    if (!Array.isArray(data?.models)) return [];

    return data.models
      .filter((item: any) => {
        const methods = Array.isArray(item?.supportedGenerationMethods)
          ? item.supportedGenerationMethods.map(String)
          : [];
        return methods.includes("generateContent");
      })
      .map((item: any) => String(item?.name || "").replace(/^models\//, "").trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function prioritizeAvailableModels(
  requested: string[],
  available: string[],
  audio = false
) {
  if (!available.length) return requested;

  const availableSet = new Set(available);
  const safeFallbacks = audio
    ? ["gemini-3.5-transcribe", ...SAFE_GENERATE_FALLBACKS]
    : SAFE_GENERATE_FALLBACKS;

  const providerFallbacks = safeFallbacks.filter((model) => availableSet.has(model));
  const otherTextModels = available.filter(
    (model) =>
      /^gemini-/i.test(model) &&
      !/image|embedding|tts|live|robotics|omni/i.test(model) &&
      (audio || !/transcribe/i.test(model))
  );

  return Array.from(
    new Set([
      ...requested.filter((model) => availableSet.has(model)),
      ...providerFallbacks,
      ...otherTextModels,
    ])
  );
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
  const modelUnavailable =
    response.status === 404 ||
    /model.*not found|model.*not available|not supported.*model|unsupported model/i.test(providerMessage);
  const modelConfigInvalid =
    response.status === 400 &&
    /thinking|temperature|generation.?config|unsupported.*parameter|invalid argument/i.test(providerMessage);

  if (modelUnavailable || modelConfigInvalid) return new GeminiModelUnavailableError(
    modelConfigInvalid
      ? "Konfigurasi model ini tidak cocok untuk request tersebut. Sistem mencoba model fallback."
      : undefined
  );
  if (quotaLike && googleSearch) return new GeminiWebSearchQuotaError();
  if (quotaLike) return new GeminiQuotaError();
  if (busyLike) return new GeminiUnavailableError();

  return new GeminiApiError(
    response.status === 400
      ? "Request tidak kompatibel dengan model yang dipilih. Coba model lain atau ubah tingkat penalaran."
      : "Gemini belum dapat memproses permintaan ini. Coba model lain.",
    response.status >= 400 && response.status < 600 ? response.status : 500
  );
}

export async function geminiGenerateDetailed(
  parts: GeminiPart[],
  systemInstruction?: string,
  options?: {
    googleSearch?: boolean;
    models?: string[];
    apiKey?: string;
    accessToken?: string;
    projectId?: string;
    effort?: AiEffort;
    responseLength?: AiResponseLength;
    responseMimeType?: "application/json";
    maxOutputTokens?: number;
    outputBudgetMultiplier?: number;
  }
) {
  const lengthInstruction = options?.responseLength
    ? responseLengthInstruction(options.responseLength)
    : "";
  const effectiveSystemInstruction = [systemInstruction, lengthInstruction]
    .filter(Boolean)
    .join("\n\n");
  const requestedOutputBudget = Number(options?.maxOutputTokens || 8192);
  const outputBudgetMultiplier = Math.max(
    0.25,
    Math.min(2, Number(options?.outputBudgetMultiplier ?? 1.5))
  );
  const boostedOutputBudget = Math.ceil(requestedOutputBudget * outputBudgetMultiplier);
  const minimumOutputBudget = outputBudgetMultiplier < 1 ? 512 : 1536;

  const accessToken = String(options?.accessToken || "").trim();
  const projectId = String(options?.projectId || "").trim();
  const key = String(options?.apiKey || (!accessToken ? process.env.GEMINI_API_KEY : "") || "").trim();

  if (accessToken && !projectId) {
    throw new GeminiApiError("Google Cloud project belum dipilih.", 400, "GOOGLE_PROJECT_MISSING");
  }
  if (!accessToken && !key) {
    throw new GeminiApiError("Gemini belum terhubung.", 500, "GEMINI_AUTH_MISSING");
  }

  const requestedModels = Array.from(
    new Set((options?.models?.length ? options.models : [GEMINI_MODEL]).filter(Boolean))
  );
  const availableModels = await listGenerateModels(accessToken, projectId, key);
  const models = prioritizeAvailableModels(
    requestedModels,
    availableModels,
    requestedModels.some((model) => model === "gemini-3.5-transcribe")
  );

  if (!models.length) {
    throw new GeminiApiError(
      "Project Gemini ini belum memiliki model generateContent yang bisa dipakai. Pilih project Google Cloud lain atau gunakan provider bersama.",
      503,
      "GEMINI_NO_AVAILABLE_MODEL"
    );
  }

  let lastError: GeminiApiError | null = null;

  for (let index = 0; index < models.length; index++) {
    const model = models[index];

    let response: Response;
    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: geminiAuthHeaders(accessToken, projectId, key),
          body: JSON.stringify({
            systemInstruction: effectiveSystemInstruction
              ? { parts: [{ text: effectiveSystemInstruction }] }
              : undefined,
            contents: [{ role: "user", parts }],
            tools: options?.googleSearch ? [{ google_search: {} }] : undefined,
            generationConfig: {
              temperature:
                model === "gemini-3.5-transcribe" || model.startsWith("gemini-3")
                  ? undefined
                  : 0.2,
              maxOutputTokens: Math.max(minimumOutputBudget, Math.min(boostedOutputBudget, 32768)),
              responseMimeType: options?.responseMimeType,
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
          error.code === "GEMINI_MODEL_UNAVAILABLE" ||
          error.code === "WEB_SEARCH_QUOTA")
      ) {
        continue;
      }
      if (error.code === "GEMINI_MODEL_UNAVAILABLE" && index === models.length - 1) {
        throw new GeminiApiError(
          "Tidak ada model Gemini yang tersedia untuk credential/project ini. Pilih model/provider lain atau hubungkan project Google Cloud lain.",
          503,
          "GEMINI_NO_AVAILABLE_MODEL"
        );
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


export function parseJsonSafely(value: string) {
  const cleaned = cleanJsonText(value);
  try {
    return JSON.parse(cleaned);
  } catch {}

  const firstObject = cleaned.indexOf("{");
  const firstArray = cleaned.indexOf("[");
  const start =
    firstObject < 0
      ? firstArray
      : firstArray < 0
        ? firstObject
        : Math.min(firstObject, firstArray);

  if (start < 0) throw new Error("AI tidak mengembalikan JSON.");

  let inString = false;
  let escaped = false;
  let depthCurly = 0;
  let depthSquare = 0;

  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depthCurly++;
    if (ch === "}") depthCurly--;
    if (ch === "[") depthSquare++;
    if (ch === "]") depthSquare--;

    if (depthCurly === 0 && depthSquare === 0) {
      const candidate = cleaned.slice(start, i + 1);
      try {
        return JSON.parse(candidate);
      } catch {}
    }
  }

  throw new Error("AI mengembalikan JSON yang belum lengkap.");
}

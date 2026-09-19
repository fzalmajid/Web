import { GEMINI_MODEL } from "./config";

type GeminiPart = { text?: string; inlineData?: { mimeType: string; data: string } };
export type GeminiWebSource = { title: string; uri: string };
export type GeminiUsage = {
  inputTokens: number;
  outputTokens: number;
  thoughtsTokens: number;
  totalTokens: number;
};

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
  constructor(message = "Layanan Gemini sedang sibuk atau sementara tidak tersedia. Coba lagi sebentar.") {
    super(message, 503, "GEMINI_UNAVAILABLE");
    this.name = "GeminiUnavailableError";
  }
}

export async function geminiGenerateDetailed(
  parts: GeminiPart[],
  systemInstruction?: string,
  options?: { googleSearch?: boolean }
) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY belum tersedia di server.");

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
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
          temperature: 0.2,
          maxOutputTokens: 8192,
        },
      }),
    }
  );

  const data = await response.json();
  if (!response.ok) {
    const providerMessage = String(data?.error?.message || "");
    const quotaLike =
      response.status === 429 ||
      /quota|rate.?limit|resource.?exhausted/i.test(providerMessage);

    if (quotaLike && options?.googleSearch) {
      throw new GeminiWebSearchQuotaError();
    }
    if (quotaLike) {
      throw new GeminiQuotaError();
    }
    if (response.status === 503 || response.status === 502 || response.status === 504) {
      throw new GeminiUnavailableError();
    }

    throw new GeminiApiError(
      "Gemini API gagal memproses permintaan ini.",
      response.status >= 400 && response.status < 600 ? response.status : 500
    );
  }

  const candidate = data?.candidates?.[0];
  const text =
    candidate?.content?.parts
      ?.map((p: { text?: string }) => p.text || "")
      .join("")
      .trim() || "";

  if (!text) throw new Error("Gemini tidak mengembalikan teks.");

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

  return { text, webSources, usage };
}

export async function geminiGenerate(parts: GeminiPart[], systemInstruction?: string) {
  const result = await geminiGenerateDetailed(parts, systemInstruction);
  return result.text;
}

export function cleanJsonText(value: string) {
  return value.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
}

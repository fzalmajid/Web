import { GEMINI_MODEL } from "./config";

type GeminiPart = { text?: string; inlineData?: { mimeType: string; data: string } };
export type GeminiWebSource = { title: string; uri: string };

export const WHATSAPP_FORMAT_INSTRUCTION =
  "Untuk teks yang akan dibaca user: bold WAJIB memakai *teks*, italic WAJIB memakai _teks_. Jangan memakai **teks** atau __teks__. Jangan gunakan markdown heading dengan #.";

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
    throw new Error(data?.error?.message || "Gemini API gagal merespons.");
  }

  const candidate = data?.candidates?.[0];
  const text =
    candidate?.content?.parts
      ?.map((p: { text?: string }) => p.text || "")
      .join("")
      .trim() || "";

  if (!text) throw new Error("Gemini tidak mengembalikan teks.");

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

  return { text, webSources };
}

export async function geminiGenerate(parts: GeminiPart[], systemInstruction?: string) {
  const result = await geminiGenerateDetailed(parts, systemInstruction);
  return result.text;
}

export function cleanJsonText(value: string) {
  return value.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
}

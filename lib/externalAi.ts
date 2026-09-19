import type { AiEffort } from "./aiModels";
import type { GeminiUsage, GeminiWebSource } from "./gemini";

export class ExternalAiError extends Error {
  code: string;
  statusCode: number;

  constructor(message: string, statusCode = 500, code = "EXTERNAL_AI_ERROR") {
    super(message);
    this.name = "ExternalAiError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function normalizeExternalError(provider: "OpenAI" | "Claude", status: number, data: any) {
  const raw = String(data?.error?.message || data?.message || "");
  if (status === 401 || status === 403) {
    return new ExternalAiError(
      provider + " credential tidak valid atau tidak punya izin untuk model tersebut.",
      status,
      "PROVIDER_AUTH"
    );
  }
  if (status === 429 || /quota|rate.?limit|insufficient_quota|too many requests/i.test(raw)) {
    return new ExternalAiError(
      "Quota " + provider + " user sedang tercapai. Coba lagi setelah quota tersedia.",
      429,
      "PROVIDER_QUOTA"
    );
  }
  if (status === 404 || /model.*not found|model.*not available|does not exist/i.test(raw)) {
    return new ExternalAiError(
      "Model " + provider + " ini tidak tersedia pada account/API user tersebut.",
      404,
      "PROVIDER_MODEL_UNAVAILABLE"
    );
  }
  if (status === 502 || status === 503 || status === 504 || /overload|high demand|temporarily unavailable/i.test(raw)) {
    return new ExternalAiError(
      provider + " sedang sibuk atau sementara tidak tersedia. Coba lagi sebentar.",
      503,
      "PROVIDER_UNAVAILABLE"
    );
  }
  return new ExternalAiError(
    status === 400
      ? "Konfigurasi request tidak cocok dengan model " + provider + " yang dipilih."
      : provider + " belum dapat memproses permintaan ini.",
    status >= 400 && status < 600 ? status : 500
  );
}

function uniqueSources(items: GeminiWebSource[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (!item.uri || seen.has(item.uri)) return false;
    seen.add(item.uri);
    return true;
  });
}

export async function openaiGenerateDetailed(options: {
  apiKey: string;
  model: string;
  prompt: string;
  system?: string;
  effort?: AiEffort;
  web?: boolean;
}) {
  const key = String(options.apiKey || "").trim();
  if (!key) throw new ExternalAiError("OpenAI belum terhubung.", 400, "OPENAI_KEY_MISSING");

  const effort =
    options.effort === "none" ||
    options.effort === "low" ||
    options.effort === "medium" ||
    options.effort === "high" ||
    options.effort === "xhigh" ||
    options.effort === "max"
      ? options.effort
      : "medium";

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + key,
    },
    body: JSON.stringify({
      model: options.model,
      instructions: options.system || undefined,
      input: options.prompt,
      reasoning: { effort },
      tools: options.web ? [{ type: "web_search" }] : undefined,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw normalizeExternalError("OpenAI", response.status, data);

  const texts: string[] = [];
  const webSources: GeminiWebSource[] = [];

  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    texts.push(data.output_text.trim());
  }

  for (const item of Array.isArray(data?.output) ? data.output : []) {
    if (item?.type !== "message") continue;
    for (const part of Array.isArray(item?.content) ? item.content : []) {
      if (part?.type === "output_text" && typeof part?.text === "string") {
        if (!texts.includes(part.text.trim())) texts.push(part.text.trim());
        for (const annotation of Array.isArray(part?.annotations) ? part.annotations : []) {
          if (annotation?.type !== "url_citation") continue;
          const uri = String(annotation?.url || "").trim();
          if (!uri) continue;
          webSources.push({
            uri,
            title: String(annotation?.title || uri).trim(),
          });
        }
      }
    }
  }

  const text = texts.filter(Boolean).join("\n\n").trim();
  if (!text) throw new ExternalAiError("OpenAI tidak mengembalikan teks.", 502, "OPENAI_EMPTY");

  const usageData = data?.usage || {};
  const input = Number(usageData?.input_tokens || 0);
  const output = Number(usageData?.output_tokens || 0);
  const thoughts = Number(usageData?.output_tokens_details?.reasoning_tokens || 0);
  const total = Number(usageData?.total_tokens || input + output);
  const usage: GeminiUsage = {
    inputTokens: input,
    outputTokens: output,
    thoughtsTokens: thoughts,
    totalTokens: total,
  };

  return {
    text,
    webSources: uniqueSources(webSources),
    usage,
    model: options.model,
  };
}

export async function anthropicGenerateDetailed(options: {
  apiKey: string;
  model: string;
  prompt: string;
  system?: string;
  effort?: AiEffort;
  web?: boolean;
}) {
  const key = String(options.apiKey || "").trim();
  if (!key) throw new ExternalAiError("Claude belum terhubung.", 400, "ANTHROPIC_KEY_MISSING");

  const supportsEffort =
    options.effort === "low" ||
    options.effort === "medium" ||
    options.effort === "high" ||
    options.effort === "xhigh" ||
    options.effort === "max";

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: options.model,
      max_tokens: supportsEffort && (options.effort === "xhigh" || options.effort === "max") ? 32768 : 8192,
      system: options.system || undefined,
      messages: [{ role: "user", content: options.prompt }],
      output_config: supportsEffort ? { effort: options.effort } : undefined,
      tools: options.web
        ? [{ type: "web_search_20260318", name: "web_search", max_uses: 5 }]
        : undefined,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw normalizeExternalError("Claude", response.status, data);

  const textParts: string[] = [];
  const webSources: GeminiWebSource[] = [];

  for (const block of Array.isArray(data?.content) ? data.content : []) {
    if (block?.type === "text" && typeof block?.text === "string") {
      textParts.push(block.text);
      for (const citation of Array.isArray(block?.citations) ? block.citations : []) {
        const uri = String(citation?.url || "").trim();
        if (!uri) continue;
        webSources.push({
          uri,
          title: String(citation?.title || uri).trim(),
        });
      }
    }

    if (block?.type === "web_search_tool_result" && Array.isArray(block?.content)) {
      for (const result of block.content) {
        if (result?.type !== "web_search_result") continue;
        const uri = String(result?.url || "").trim();
        if (!uri) continue;
        webSources.push({
          uri,
          title: String(result?.title || uri).trim(),
        });
      }
    }
  }

  const text = textParts.join("").trim();
  if (!text) throw new ExternalAiError("Claude tidak mengembalikan teks.", 502, "CLAUDE_EMPTY");

  const usageData = data?.usage || {};
  const input = Number(usageData?.input_tokens || 0);
  const output = Number(usageData?.output_tokens || 0);
  const usage: GeminiUsage = {
    inputTokens: input,
    outputTokens: output,
    thoughtsTokens: 0,
    totalTokens: input + output,
  };

  return {
    text,
    webSources: uniqueSources(webSources),
    usage,
    model: options.model,
  };
}

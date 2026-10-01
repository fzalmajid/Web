export type FreeAgentUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type FreeAgentResult = {
  text: string;
  model: string;
  usage: FreeAgentUsage | null;
};

function configuredModel() {
  return String(process.env.OPENROUTER_FREE_MODEL || "openrouter/free").trim();
}
export function isZeroCostModel(model:string){return model==="openrouter/free"||model.endsWith(":free");}
let unavailableUntil=0;

export function openRouterFreeConfigured() {
  return Boolean(String(process.env.OPENROUTER_API_KEY || "").trim() && isZeroCostModel(configuredModel()) && Date.now()>=unavailableUntil);
}

export function openRouterFreeStatus() {
  return {
    configured: openRouterFreeConfigured(),
    model: openRouterFreeConfigured() ? configuredModel() : null,
    zeroCostGuard: true,
    required: false,
  };
}

export async function openRouterFreeGenerate(options: {
  prompt: string;
  system?: string;
  maxTokens?: number;
}): Promise<FreeAgentResult> {
  const apiKey = String(process.env.OPENROUTER_API_KEY || "").trim();
  const model = configuredModel();
  if (!apiKey || !isZeroCostModel(model) || Date.now()<unavailableUntil) {
    throw Object.assign(new Error("OpenRouter free helper belum dikonfigurasi."), {
      code: "OPENROUTER_FREE_UNAVAILABLE",
      statusCode: 503,
    });
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + apiKey,
      "HTTP-Referer": "https://web-fzalmajid.vercel.app",
      "X-Title": "Ruang Belajar",
    },
    body: JSON.stringify({
      model,
      provider:{max_price:{prompt:0,completion:0},data_collection:"deny"},
      messages: [
        {
          role: "system",
          content: options.system || "Anda adalah helper internal gratis. Beri catatan singkat dan jangan mengarang sumber.",
        },
        { role: "user", content: options.prompt.slice(0, 18000) },
      ],
      temperature: 0.1,
      max_tokens: Math.min(1600, Math.max(256, Math.floor(options.maxTokens || 900))),
    }),
    signal: AbortSignal.timeout(18000),
    cache: "no-store",
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    unavailableUntil=Date.now()+(response.status===429?15*60_000:60_000);
    throw Object.assign(new Error(String(data?.error?.message || "OpenRouter free helper tidak tersedia.")), {
      code: response.status === 429 ? "OPENROUTER_FREE_RATE_LIMIT" : "OPENROUTER_FREE_ERROR",
      statusCode: response.status,
    });
  }

  const text = String(data?.choices?.[0]?.message?.content || "").trim();
  if (!text) throw new Error("OpenRouter free helper mengembalikan jawaban kosong.");
  const usage = data?.usage
    ? {
        inputTokens: Number(data.usage.prompt_tokens || 0),
        outputTokens: Number(data.usage.completion_tokens || 0),
        totalTokens: Number(data.usage.total_tokens || 0),
      }
    : null;
  return { text, model: "openrouter-free:" + model, usage };
}

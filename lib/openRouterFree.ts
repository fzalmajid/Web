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

export function isZeroCostModel(model:string){return model==="openrouter/free"||/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.:-]+:free$/.test(model)||/^[a-zA-Z0-9_.-]+:free$/.test(model);}
export function freeModelsForStage(stage="", avoid:readonly string[]=[]){
  let roles:Record<string,unknown>={};
  try{const parsed=JSON.parse(process.env.OPENROUTER_FREE_STAGE_MODELS||"{}");if(parsed&&typeof parsed==="object"&&!Array.isArray(parsed))roles=parsed;}catch{}
  const role=Array.isArray(roles[stage])?roles[stage] as unknown[]:[];
  const global=String(process.env.OPENROUTER_FREE_MODELS||process.env.OPENROUTER_FREE_MODEL||"openrouter/free").split(",");
  const models=[...new Set([...role,...global].filter((v):v is string=>typeof v==="string").map(v=>v.trim()).filter(isZeroCostModel))].slice(0,8);
  return [...models.filter(m=>!avoid.includes(m)),...models.filter(m=>avoid.includes(m))];
}
let unavailableUntil=0;
const modelCooldown=new Map<string,number>();
function configuredCandidates(){return [...new Set(["","planner","web-researcher","database-scholar","independent-tutor","evidence-auditor","verifier","critic"].flatMap(stage=>freeModelsForStage(stage)))];}

export function openRouterFreeConfigured() {
  return Boolean(String(process.env.OPENROUTER_API_KEY || "").trim() && configuredCandidates().length && Date.now()>=unavailableUntil);
}

export function openRouterFreeStatus() {
  return {
    configured: openRouterFreeConfigured(),
    model: openRouterFreeConfigured() ? configuredCandidates()[0] : null,
    candidateCount: configuredCandidates().length,
    perRoleRouting: true,
    cooldownScope: "per-model failures; provider-wide authentication/rate-limit cooldown (warm instance)",
    zeroCostGuard: true,
    required: false,
  };
}

export async function openRouterFreeGenerate(options: {
  prompt: string;
  system?: string;
  maxTokens?: number;
  stage?: string;
  avoidModels?: readonly string[];
  deadline?: number;
}): Promise<FreeAgentResult> {
  const apiKey = String(process.env.OPENROUTER_API_KEY || "").trim();
  const candidates=freeModelsForStage(options.stage,options.avoidModels).filter(m=>Date.now()>=(modelCooldown.get(m)||0)).slice(0,3);
  if (!apiKey || !candidates.length || Date.now()<unavailableUntil) {
    throw Object.assign(new Error("OpenRouter free helper belum dikonfigurasi."), {
      code: "OPENROUTER_FREE_UNAVAILABLE",
      statusCode: 503,
    });
  }

  const deadline=Math.min(options.deadline||Infinity,Date.now()+18000);
  for(const model of candidates){
  if(Date.now()>=deadline)break;
  try{
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
    signal: AbortSignal.timeout(Math.max(1,Math.min(6000,deadline-Date.now()))),
    cache: "no-store",
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    modelCooldown.set(model,Date.now()+60_000);
    if([401,402,403,429].includes(response.status)){
      const seconds=Number(response.headers.get("retry-after"));
      unavailableUntil=Date.now()+(Number.isFinite(seconds)&&seconds>0?Math.min(900,seconds)*1000:15*60_000);
    }
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
  }catch{
    modelCooldown.set(model,Date.now()+60_000);
    // Account-wide quota/auth errors are not bypassed by trying another model.
    if(Date.now()<unavailableUntil)break;
  }
  }
  throw Object.assign(new Error("Agen gratis tidak tersedia; gunakan fallback lokal."),{code:"OPENROUTER_FREE_UNAVAILABLE",statusCode:503});
}

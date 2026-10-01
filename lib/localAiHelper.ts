export type LocalHelperConfig = {
  endpoint?: string;
  apiKey?: string;
  model?: string;
};

export type LocalHelperHints = {
  intent: string;
  rewrittenQuery: string;
  sourceTerms: string[];
  notes: string;
  runtime: "heuristic-browser" | "local-openai-compatible" | "webllm-browser";
};

function terms(query: string) {
  const stop = new Set(["yang", "dan", "atau", "untuk", "dari", "dengan", "apa", "ini", "itu", "the", "and", "for", "with"]);
  return Array.from(new Set((query.toLowerCase().match(/[a-z0-9À-ÿ]{3,}/gi) || []).map((value) => value.toLowerCase())))
    .filter((value) => !stop.has(value)).slice(0, 18);
}

function heuristic(query: string): LocalHelperHints {
  const sourceTerms = terms(query);
  const intent = /\b(cari|carikan|temukan|referensi|sumber|citation|sitasi|paper|jurnal|doi)\b/i.test(query)
    ? "research-and-citation"
    : /\b(ringkas|rangkum|summary|jelaskan|apa itu|bedakan|bandingkan)\b/i.test(query)
      ? "explain-or-summarize"
      : /\b(soal|quiz|latihan|uji|flashcard)\b/i.test(query)
        ? "practice"
        : "tutor-question";
  return {
    intent,
    rewrittenQuery: query.trim().replace(/\s+/g, " ").slice(0, 1200),
    sourceTerms,
    notes: "Heuristik lokal dipakai sebagai petunjuk retrieval saja; bukan sumber fakta.",
    runtime: "heuristic-browser",
  };
}

function parseJson(value: string) {
  const clean = value.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try { return JSON.parse(clean); } catch { return null; }
}

export function guardHelperRewrite(query: string, proposed: unknown) {
  const original = query.trim().replace(/\s+/g, " ").slice(0, 1200);
  const rewrite = String(proposed || "").trim().slice(0, 1200);
  const keywords = terms(original);
  const overlap = keywords.filter(word => rewrite.toLowerCase().includes(word)).length;
  const research = /\b(cari|carikan|referensi|sumber|paper|jurnal|doi)\b/i.test(original);
  if (!rewrite || overlap < Math.ceil(keywords.length / 2) || (research && !/\b(cari|carikan|referensi|sumber|paper|jurnal|doi|references?|sources?|find)\b/i.test(rewrite))) return original;
  if ((rewrite.match(/https?:\/\/\S+|10\.\d{4,9}\/\S+/g) || []).some(value => !original.includes(value))) return original;
  return rewrite;
}

export async function buildLocalHelperHints(query: string, config: LocalHelperConfig = {}) {
  const fallback = heuristic(query);
  const endpoint = String(config.endpoint || "").trim().replace(/\/+$/, "");
  if(typeof window!=="undefined"&&localStorage.getItem("rb-local-qwen-enabled")==="1"){
    try{const local=await import("./localQwen");if(!local.localQwenReady()){void local.prepareLocalQwen().catch(()=>undefined);return fallback;}const parsed=parseJson(await local.qwenHelper(query)||"");if(parsed&&typeof parsed==="object")return {intent:["research-and-citation","explain-or-summarize","practice","tutor-question"].includes(parsed.intent)?parsed.intent:fallback.intent,rewrittenQuery:guardHelperRewrite(query,parsed.rewrittenQuery),sourceTerms:Array.from(new Set([...fallback.sourceTerms,...(Array.isArray(parsed.sourceTerms)?parsed.sourceTerms.map((term:unknown)=>String(term).slice(0,80)):[])])).slice(0,18),notes:String(parsed.notes||fallback.notes).slice(0,800),runtime:"webllm-browser" as const};}catch{return fallback;}
  }
  if (!endpoint) return fallback;
  // The local helper must not silently turn into a paid remote API.
  try{const host=new URL(endpoint).hostname;if(!/^(localhost|127\.[0-9.]+|\[::1\])$/i.test(host))return fallback;}catch{return fallback;}
  try {
    const response = await fetch(endpoint + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.apiKey ? { Authorization: "Bearer " + config.apiKey } : {}),
      },
      body: JSON.stringify({
        model: config.model || undefined,
        temperature: 0,
        max_tokens: 240,
        messages: [
          { role: "system", content: "You are a local-only helper. Return JSON with intent, rewrittenQuery, sourceTerms, notes. Never invent facts or citations." },
          { role: "user", content: query.trim().slice(0, 1600) },
        ],
      }),
      signal: AbortSignal.timeout(3000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return fallback;
    const content = String(data?.choices?.[0]?.message?.content || "");
    const parsed = parseJson(content);
    if (!parsed || typeof parsed !== "object") return fallback;
    return {
      intent: String(parsed.intent || fallback.intent).slice(0, 120),
      rewrittenQuery: guardHelperRewrite(query, parsed.rewrittenQuery),
      sourceTerms: Array.isArray(parsed.sourceTerms) ? parsed.sourceTerms.map(String).slice(0, 18) : fallback.sourceTerms,
      notes: String(parsed.notes || fallback.notes).slice(0, 800),
      runtime: "local-openai-compatible" as const,
    };
  } catch {
    return fallback;
  }
}

export function localHelperContext(hints: LocalHelperHints) {
  return JSON.stringify(hints);
}

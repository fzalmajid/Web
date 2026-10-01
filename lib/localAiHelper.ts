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
  runtime: "heuristic-browser" | "local-openai-compatible";
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

export async function buildLocalHelperHints(query: string, config: LocalHelperConfig = {}) {
  const fallback = heuristic(query);
  const endpoint = String(config.endpoint || "").trim().replace(/\/+$/, "");
  if (!endpoint) return fallback;
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
      rewrittenQuery: String(parsed.rewrittenQuery || fallback.rewrittenQuery).slice(0, 1200),
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

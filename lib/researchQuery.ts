/** Remove output-format instructions from search, without asking a paid model or inventing identifiers. */
export function researchQuery(question: string) {
  const clean = question.trim().replace(/\s+/g, " ");
  if (/https?:\/\/|\b10\.\d{4,9}\//i.test(clean)) return clean.slice(0, 1200);
  const topic = /\b(?:tentang|mengenai|about)\s+(.+?)(?=[.!?]|$)/i.exec(clean)?.[1];
  const candidate = (topic || clean).split(/\b(?:buat(?:kan)?|tampilkan|sertakan|verifikasi|jangan|format|berikan|include|return|formatting)\b/i)[0]
    .replace(/\b(?:cari(?:kan)?|temukan|tolong|sumber|primer|referensi|paper|jurnal|artikel|studi|penelitian|terbaru|untuk|belajar|find|sources?|primary|references?|papers?|please|about)\b/gi, " ")
    .replace(/[/:;,]+/g, " ").replace(/\s+/g, " ").trim();
  return candidate.length >= 3 ? candidate.slice(0, 240) : clean.slice(0, 240);
}

export function rankResearchHits<T extends {title:string;abstract?:string|null}>(hits:T[],query:string) {
  const terms=Array.from(new Set(query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)||[]));
  if(!terms.length)return hits;
  return hits.map(hit=>{
    const title=hit.title.toLowerCase(),body=(hit.abstract||"").toLowerCase();
    const titleMatches=terms.filter(term=>title.includes(term)).length;
    const bodyMatches=terms.filter(term=>body.includes(term)).length;
    return {hit,score:titleMatches*6+bodyMatches,keep:terms.length<3||titleMatches>0||bodyMatches>=Math.ceil(terms.length*.8)};
  }).filter(item=>item.keep).sort((a,b)=>b.score-a.score).map(item=>item.hit);
}

/** Small deterministic search plan, not a model-generated drug/DOI guess. */
export function scientificQueryPlan(question: string) {
  const original = researchQuery(question);
  const formulation = /\b(?:formulasi|formulation|resep|eksipien|excipients?|cocrystals?|kokristal)\b/i.test(question);
  if (!formulation) return { query: original, broadQuery: original, requiredTerm: "" };
  const stop = new Set("carikan cari resep formulasi formulation tablet tablets konvensional conventional dari jurnal tervalidasi tervalidai validated baik modifikasi modification maupun bukan minimal model formula bahan aktif active eksipien excipients jumlah disebutkan cocrystal cocrystals kokristal dan atau dengan untuk dalam yang mg obat drug ingredient ingredients dari jurnal journal public access publik terbuka immediate release".split(" "));
  stop.add("juga");stop.add("disebutkan");
  const words = question.toLowerCase().match(/[a-z][a-z-]{3,}/g) || [];
  // Only constrain a single unambiguous chemical/topic supplied by the user.
  const candidates = [...new Set(words.filter(word => !stop.has(word)))];
  const requiredTerm = candidates.length === 1 ? candidates[0] : "";
  const normalized = original.toLowerCase()
    .replace(/\bformulasi\b/g, "formulation").replace(/\b(?:kokristal|cocrystals?)\b/g, "cocrystal")
    .replace(/\bdisolusi\b/g, "dissolution").replace(/\beksipien\b/g, "excipients");
  const query = requiredTerm ? `${requiredTerm} tablet ${/cocrystal|kokristal/i.test(question) ? "cocrystal" : "formulation"}` : normalized;
  return { query: query.slice(0, 240), broadQuery: requiredTerm ? `${requiredTerm} tablet formulation` : query.slice(0, 240), requiredTerm };
}

export function matchesRequiredTopic(title: string, requiredTerm: string) {
  return !requiredTerm || title.toLowerCase().includes(requiredTerm.toLowerCase());
}

export function indexedAbstract(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const words = new Map<number, string>();
  for (const [word, positions] of Object.entries(value).slice(0, 1500)) {
    if (!Array.isArray(positions)) continue;
    for (const position of positions.slice(0, 100)) if (Number.isInteger(position) && position >= 0 && position < 1500) words.set(position, word.slice(0, 200));
  }
  return [...words].sort((a,b)=>a[0]-b[0]).map(([,word])=>word).join(" ").slice(0, 2200) || null;
}

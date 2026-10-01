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

export function indexedAbstract(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const words = new Map<number, string>();
  for (const [word, positions] of Object.entries(value).slice(0, 1500)) {
    if (!Array.isArray(positions)) continue;
    for (const position of positions.slice(0, 100)) if (Number.isInteger(position) && position >= 0 && position < 1500) words.set(position, word.slice(0, 200));
  }
  return [...words].sort((a,b)=>a[0]-b[0]).map(([,word])=>word).join(" ").slice(0, 2200) || null;
}

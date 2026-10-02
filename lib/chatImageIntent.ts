export function chatImageIntent(question:string){
  if(!/\b(?:gambar|image|picture|ilustrasi|monografi|monograph|struktur|2d)\b/i.test(question))return null;
  const names:[[RegExp,string],...[RegExp,string][]]=[[/\b(?:pct|parasetamol|paracetamol|acetaminophen)\b/i,"paracetamol"],[/\bdipyridamole\b/i,"dipyridamole"],[/\b(?:aspirin|asam asetilsalisilat)\b/i,"aspirin"],[/\b(?:ibuprofen)\b/i,"ibuprofen"],[/\b(?:kafein|caffeine)\b/i,"caffeine"]];
  const name=names.find(([pattern])=>pattern.test(question))?.[1];
  if(name)return {kind:"pubchem" as const,query:name,requestedDocument:/farmakope|\bfi\s*6\b/i.test(question)};
  const query=/\b(?:gambar|image|picture|ilustrasi)\s+(?:tentang\s+|of\s+)?([^.!?\n]+)/i.exec(question)?.[1]?.trim().slice(0,150);
  return query?{kind:"openverse" as const,query,requestedDocument:false}:null;
}

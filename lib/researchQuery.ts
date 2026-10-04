import { researchScope, scopeSearchText } from "./researchScope";
/** Remove output-format instructions from search, without asking a paid model or inventing identifiers. */
export function researchQuery(question: string) {
  let clean = question.trim().replace(/\s+/g, " ");
  if (/https?:\/\/|\b10\.\d{4,9}\//i.test(clean)) return clean.slice(0, 1200);
  clean=clean.replace(/\b(spp?)\.(?=\s|$|["”])/gi,"$1");
  const quoted = Array.from(clean.matchAll(/["“]([^"”]{8,})["”]/g), match => match[1]).sort((a,b)=>b.length-a.length)[0];
  const topic = /\b(?:tentang|mengenai|about)\s+(.+?)(?=[.!?]|$)/i.exec(clean)?.[1];
  let subject = topic || quoted || clean;
  // Practical-report titles can name the course before the actual experiment.
  if (/\b(?:laporan|praktikum|report)\b/i.test(subject) && subject.includes(":")) subject = subject.slice(subject.indexOf(":")+1);
  subject = subject.replace(/^(?:(?:tolong|please|buat(?:kan)?|susun(?:kan)?|tulis(?:kan)?|berikan|write|create|prepare)\s+)+/i, "")
    .replace(/\b(?:dasar teori|landasan teori|laporan praktikum|laporan|praktikum|literature review|theoretical background|presentation|presentasi|ppt)\b/gi," ");
  const candidate = subject.split(/\b(?:buat(?:kan)?|tampilkan|sertakan|verifikasi|jangan|format|berikan|include|return|formatting|doi|tautan penerbit|(?:dengan|beserta)\s+referensi|referensi\s+lengkap|\d{1,2}\s*(?:jurnal|artikel|papers?|tahun|years?)\s*(?:terbaik|terakhir|last|recent)?)\b/i)[0]
    .replace(/\b(?:cari(?:kan)?|temukan|tolong|sumber|primer|referensi|paper|jurnal|artikel|studi|penelitian|terbaru|untuk|belajar|find|sources?|primary|references?|papers?|please|about)\b/gi, " ")
    .replace(/["“”/:;,]+/g, " ").replace(/[.!?]+$/g, "").replace(/\s+/g, " ").trim();
  return candidate.length >= 3 ? candidate.slice(0, 240) : clean.slice(0, 240);
}

export function rankResearchHits<T extends {title:string;abstract?:string|null}>(hits:T[],query:string) {
  const terms=researchTerms(query);
  if(!terms.length)return hits;
  return hits.map(hit=>{
    const title=new Set(researchTerms(hit.title)),body=new Set(researchTerms(hit.abstract||""));
    const titleMatches=terms.filter(term=>title.has(term)).length;
    const bodyMatches=terms.filter(term=>body.has(term)).length;
    const coverage=terms.filter(term=>title.has(term)||body.has(term)).length;
    const entity=researchEntity(query);
    const methods=terms.filter(term=>["drying","purification","formulation","dissolution","calibration"].includes(term));
    const methodMatch=!methods.length||methods.some(term=>title.has(term)||body.has(term));
    return {hit,score:titleMatches*6+bodyMatches,keep:methodMatch&&(titleMatches>0||bodyMatches>=Math.ceil(terms.length*.8))&&coverage>=Math.min(terms.length,Math.max(2,Math.ceil(terms.length*.3)))&&(!entity||entity.test(hit.title+" "+(hit.abstract||"")))};
  }).filter(item=>item.keep).sort((a,b)=>b.score-a.score).map(item=>item.hit);
}

/** Canonical bilingual concepts, not substring matches or generated identities. */
export function researchTerms(text:string) {
  const normalized=topicSearchTerms(text).toLowerCase()
    .replace(/\b(?:pengeringan|kering|dried|dry|dehydration)\b/g,"drying")
    .replace(/\b(?:simplisia|medicinal plant|herbal material)\b/g,"botanical")
    .replace(/\b(?:penyiapan|preparasi|preparing)\b/g,"preparation")
    .replace(/\b(?:sampel|samples)\b/g,"sample")
    .replace(/\b(?:bahan alam|natural products?)\b/g,"botanical")
    .replace(/\b(?:pemurnian|purifying)\b/g,"purification");
  const ignored=new Set("buatkan buat dasar teori laporan praktikum report background theory terbaik best lengkap complete referensi references jurnal journal journals paper papers bahan material materials senyawa compound compounds untuk preparation sample".split(" "));
  return [...new Set((normalized.match(/[\p{L}]{3,}/gu)||[]).filter(term=>!ignored.has(term)))];
}

function researchEntity(query:string):RegExp|null {
  const scope=researchScope(query);
  return scope?new RegExp("\\b"+scope.genus+(scope.species?"\\s+"+scope.species:"")+"\\b","i"):null;
}

/** Automatic topic-context gate; selected documents are not excluded by this. */
export function relevantResearchContext(body:string,question:string) {
  const terms=researchTerms(researchQuery(question));
  if(terms.length<2)return true;
  const actual=new Set(researchTerms(body));
  return terms.filter(term=>actual.has(term)).length>=Math.min(terms.length,Math.max(2,Math.ceil(terms.length*.3)));
}

/** Small deterministic search plan, not a model-generated drug/DOI guess. */
export function scientificQueryPlan(question: string) {
  const doi=/\b10\.\d{4,9}\/[^\s<>"\]]+/i.exec(question)?.[0]?.replace(/[.,;)]+$/g,"");
  if(doi)return {query:doi,broadQuery:doi,requiredTerm:""};
  const original = researchQuery(question);
  const formulation = /\b(?:formulasi|formulation|formula|resep|komposisi|composition|eksipien|excipients?|cocrystals?|kokristal)\b/i.test(question);
  if (!formulation) {
    const translated=topicSearchTerms(original);
    const scope=researchScope(translated);
    if(scope){
      const methods=researchTerms(translated).filter(term=>["drying","purification","storage","sorting","extraction"].includes(term));
      const identity=scope.genus+(scope.species?" "+scope.species:"");
      return {query:translated.replace(/\bspp?\b/g," ").replace(/\s+/g," ").trim(),broadQuery:[identity,...methods].join(" "),requiredTerm:""};
    }
    return { query: translated, broadQuery: original, requiredTerm: "" };
  }
  const stop = new Set("carikan cari resep formulasi formulation formula komposisi composition tablet tablets konvensional conventional dari jurnal tervalidasi tervalidai validated baik modifikasi modification maupun bukan minimal model bahan zat aktif active eksipien excipients jumlah disebutkan cocrystal cocrystals kokristal dan atau dengan untuk dalam yang mg obat drug ingredient ingredients public access publik terbuka immediate immidiate release membahas bahas hingga sampai massa mass nya tiap setiap unit per".split(" "));
  for(const term of "juga disebutkan relevan relevant konteks context paragraf paragraph singkat short".split(" "))stop.add(term);
  const core=topicSearchTerms(original).split(/\b(?:dasar teori|usulan|perhitungan|monografi bahan|alat (?:dan )?bahan|cara kerja|daftar pustaka)\b/i)[0];
  for(const term of "buatkan buat susun ppt presentasi presentation slides laporan report tab pcs batch jumlah per untuk berisi lengkap".split(" "))stop.add(term);
  const words = core.toLowerCase().match(/[a-z][a-z-]{3,}/g) || [];
  // Only constrain a single unambiguous chemical/topic supplied by the user.
  const candidates = [...new Set(words.filter(word => !stop.has(word)))];
  const requiredTerm = candidates.length === 1 ? candidates[0] : "";
  const normalized = core.toLowerCase()
    .replace(/\bformulasi\b/g, "formulation").replace(/\b(?:kokristal|cocrystals?)\b/g, "cocrystal")
    .replace(/\bdisolusi\b/g, "dissolution").replace(/\beksipien\b/g, "excipients")
    .replace(/\bimmidiate\b/g, "immediate");
  const immediateRelease = /\b(?:konvensional|conventional|lepas\s+segera|immediate(?:[\s-]+release)?|immidiate(?:[\s-]+release)?)\b/i.test(question);
  const query = requiredTerm
    ? `${requiredTerm} tablet ${/cocrystal|kokristal/i.test(question) ? "cocrystal" : immediateRelease ? "immediate release formulation" : "formulation"}`
    : normalized;
  return { query: query.slice(0, 240), broadQuery: requiredTerm ? `${requiredTerm} tablet formulation` : query.slice(0, 240), requiredTerm };
}

export function matchesRequiredTopic(title: string, requiredTerm: string) {
  return !requiredTerm || title.toLowerCase().includes(requiredTerm.toLowerCase());
}

/** Identity matching alone does not satisfy the user's scope. */
export function withinResearchScope(hit:{title:string;abstract?:string|null;year?:number|null;workType?:string},question:string,nowYear=new Date().getFullYear()){
  const plan=scientificQueryPlan(question);
  if(!matchesRequiredTopic(hit.title,plan.requiredTerm))return false;
  const journalOnly=/\b\d+\s*(?:jurnal|journal articles?|papers?)\b/i.test(question)&&! /\b(?:buku|books?|thesis|tesis|prosiding)\b/i.test(question);
  if(journalOnly&&hit.workType&&hit.workType!=="journal_article")return false;
  const conventional=/\b(?:konvensional|conventional|lepas\s+segera|immediate(?:[\s.-]+release)?|immidiate(?:[\s.-]+release)?)\b/i.test(question);
  if(conventional&&/sustained.release|controlled.release|extended.release|biphasic.release|floating|gastro.retenti|mucoadhesive/i.test(hit.title))return false;
  const years=/\b(\d{1,2})\s*(?:tahun|years?)\s*(?:terakhir|last|recent)\b/i.exec(question)?.[1];
  const book=hit.workType==="book"||hit.workType==="chapter";
  // In mixed requests journal recency must not exclude the requested books.
  // An explicit book-specific age requirement still applies.
  const bookYears=/\b(?:buku|books?|bab buku|chapters?)\s+(?:(?:terbit(?:an)?|published|dalam|within|terbaru)\s+)*(\d{1,2})\s*(?:tahun|years?)\s*(?:terakhir|last|recent)\b/i.exec(question)?.[1];
  const age=book?bookYears:years;
  if(age&&(!hit.year||hit.year<nowYear-Number(age)||hit.year>nowYear))return false;
  return true;
}

/** Conservative topic vocabulary; never invent a chemical, author, title, or identifier. */
export function topicSearchTerms(text:string) {
  if (/https?:\/\/|\b10\.\d{4,9}\//i.test(text)) return text.slice(0,1200);
  const phrases:Array<[RegExp,string]>=[[/\benergi surya\b/gi,"solar energy"],[/\bpanel surya\b/gi,"solar panels"],[/\bperubahan iklim\b/gi,"climate change"],[/\bkecerdasan buatan\b/gi,"artificial intelligence"],[/\bpembelajaran mesin\b/gi,"machine learning"]];
  let result=scopeSearchText(text);
  const preparationPhrases:Array<[RegExp,string]>=[
    [/\bpenyiapan sampel\b/gi,"sample preparation"],
    [/\bbahan alam\b/gi,"natural products"],
    [/\bsimplisia\b/gi,"dried medicinal plant"],
    [/\bpengeringan\b/gi,"drying"],
    [/\bpemurnian\b/gi,"purification"],
    [/\bsortasi\b/gi,"sorting"],
    [/\bpenyimpanan\b/gi,"storage"],
  ];
  for(const [pattern,replacement] of preparationPhrases)result=result.replace(pattern,replacement);
  for(const [pattern,replacement] of phrases)result=result.replace(pattern,replacement);
  const translations:Record<string,string>={pendidikan:"education",pembelajaran:"learning",memori:"memory",kesehatan:"health",lingkungan:"environment",efisiensi:"efficiency",efektivitas:"effectiveness",kalibrasi:"calibration",disolusi:"dissolution",formulasi:"formulation",absorpsi:"absorption",stabilitas:"stability",ekonomi:"economics",dipiridamol:"dipyridamole",kokristal:"cocrystal"};
  result=result.replace(/\b[a-z]+\b/gi,word=>translations[word.toLowerCase()]||word);
  return result.replace(/\b(?:jelaskan|singkat|itu|ringkas(?:an)?|apa(?:kah)?|bagaimana|mengapa|pengaruh|hubungan|perbedaan|bandingkan|bukti|ilmiah|tervalidasi|tervalida[i]?|valid|berdasarkan|adalah|terhadap|dengan|dan|atau|yang|dari|pada|dalam|sebagai|saya|ingin|beserta|link|tautan|publik|public|access|akses|terbuka|minimal|maksimal|lebih|tentang|mengenai|terbaru|show|explain|summari[sz]e|evidence|of|the|and|for|on|in|to)\b/gi," ").replace(/\s+/g," ").trim().slice(0,240)||text.slice(0,240);
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

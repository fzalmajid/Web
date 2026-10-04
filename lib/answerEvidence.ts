import type { CitationStyle } from "./citations";
import { publicUrl } from "./researchLinks";
import { normalizeDoi } from "./referenceMetadata";

export type CitationIdentity={title:string;doi?:string|null;uri?:string;formatted?:string;authorYearKeys?:string[];workType?:string;year?:number|null;printedPages?:string[];readSource?:{uri:string;format:string;pages:number[]};catalogOnly?:boolean;repositoryLinks?:Array<{label:string;uri:string}>};
const heading=/^[\t ]*(?:#{1,6}[\t ]*)?(?:\*{1,2}|_{1,2})?(?:(?:Slide[\t ]+\d{1,3}[\t ]*[-–—:.][\t ]*)|(?:\d{1,3}[.)][\t ]+))?(?:References|Daftar Pustaka|Referensi(?: Ilmiah)?|Bibliography|Works Cited)[\t ]*:?[\t ]*(?:\*{1,2}|_{1,2})?[\t ]*:?[\t ]*$/im;
const normalize=(text:string)=>text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim();
const authorDateStyle=(style:CitationStyle)=>["apa","apa6","harvard","chicago"].includes(style);
/** Format existing explicit locators only. Never append every retrieved page to
 * a claim or infer a PDF-to-print offset. Code and links remain literal. */
export function formatInTextPageLocators(text:string,style:CitationStyle){
  if(!["apa","apa6","harvard","chicago"].includes(style))return text;
  return text.replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`|!?\[[^\]\n]*\]\([^\)\n]*\)|\(([^()\n]*\b(?:18|19|20|21)\d{2}[a-z]?,\s*)(?:hlm\.?|halaman|pp?\.)\s*(\d+(?:\s*[–-]\s*\d+)?(?:\s*,\s*\d+(?:\s*[–-]\s*\d+)?)*)\)/g,(token,prefix:string|undefined,pages:string|undefined)=>{
    if(!prefix||!pages)return token;
    const values=pages.trim();
    const label=style==="chicago"?"":"hlm. ";
    return `(${prefix}${label}${values})`;
  });
}
function citationBody(body:string){
  return body.replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`|!?\[[^\]\n]*\]\([^\)\n]*\)|https?:\/\/[^\s<>"\]]+/g,token=>token.replace(/[^\n]/g," "));
}
function authorYearMarkers(body:string){
  const text=citationBody(body),markers:Array<{text:string;narrative:boolean}>=[];
  for(const group of text.matchAll(/\(([^()\n]{1,240})\)/g)){
    for(const part of group[1].split(";"))if(/^\s*[\p{L}]/u.test(part)&&/\b(?:18|19|20|21)\d{2}[a-z]?\b/.test(part))markers.push({text:normalize(part),narrative:false});
    // Narrative citation: Author (2024), not a bare surname/year mention.
    if(/^\s*(?:18|19|20|21)\d{2}[a-z]?(?:\s*,[^()]*)?\s*$/.test(group[1])){
      const prefix=text.slice(Math.max(0,group.index!-180),group.index).split("\n").pop()||"";
      markers.push({text:normalize(prefix+" "+group[1].split(",")[0]),narrative:true});
    }
  }
  return markers;
}
function numericMarkers(body:string){
  const numbers=new Set<number>();
  for(const match of citationBody(body).matchAll(/\[(\d+(?:\s*[,;–-]\s*\d+)*)\]|\((\d+(?:\s*[,;–-]\s*\d+)*)\)/g)){
    for(const part of (match[1]||match[2]).split(/[,;]/)){
      const range=part.trim().split(/[–-]/).map(Number);
      if(range.length===1)numbers.add(range[0]);
      else if(range[1]>=range[0]&&range[1]-range[0]<=100)for(let n=range[0];n<=range[1];n++)numbers.add(n);
    }
  }
  return numbers;
}
function mlaReferences(body:string,inventory:CitationIdentity[]){
  const markers=Array.from(citationBody(body).matchAll(/\(([^()\n]{1,180})\)/g),match=>` ${normalize(match[1])} `);
  const keys=new Map<string,CitationIdentity[]>();
  for(const item of inventory)for(const signature of item.authorYearKeys||[]){
    const key=normalize(signature).replace(/\s+(?:18|19|20|21)\d{2}[a-z]?$/,""),matches=keys.get(key)||[];
    if(key&&!matches.includes(item))matches.push(item);keys.set(key,matches);
  }
  return [...new Set(inventory)].filter(item=>[...keys].some(([key,matches])=>matches.length===1&&matches[0]===item&&markers.some(marker=>marker.startsWith(` ${key} `)&&/^\s*(?:\d+(?:\s*[–-]\s*\d+)?)?\s*$/.test(marker.slice(key.length+2)))));
}

/** Only unambiguous, catalog-backed author/year markers count as omitted references.
 * Never infer a work from a surname alone, or assign/renumber numeric citations. */
export function omittedAuthorYearReferences(body:string,inventory:CitationIdentity[],used:CitationIdentity[]){
  const markers=authorYearMarkers(body);
  const signatureMatches=new Map<string,CitationIdentity[]>();
  for(const item of inventory)for(const raw of item.authorYearKeys||[]){
    const key=normalize(raw);if(!key)continue;
    const matches=signatureMatches.get(key)||[];
    if(!matches.includes(item))matches.push(item);
    signatureMatches.set(key,matches);
  }
  return [...new Set(inventory)].filter(item=>!used.includes(item)&&(item.authorYearKeys||[]).some(raw=>{
    const key=normalize(raw);
    return signatureMatches.get(key)?.length===1&&markers.some(marker=>marker.narrative?` ${marker.text}`.endsWith(` ${key}`):` ${marker.text} `.includes(` ${key} `));
  }));
}

/** Flag unresolved parenthetical author-year markers; never synthesize metadata. */
export function unresolvedCitationWarnings(body:string,inventory:CitationIdentity[]){
  const unresolved:string[]=[];
  const signatures=new Map<string,Set<CitationIdentity>>();
  for(const item of inventory)for(const raw of item.authorYearKeys||[]){
    const key=normalize(raw);const works=signatures.get(key)||new Set<CitationIdentity>();works.add(item);signatures.set(key,works);
  }
  for(const group of citationBody(body).matchAll(/\(([^()\n]{1,240})\)/g))for(const part of group[1].split(";")){
    if(!/^\s*[\p{L}]/u.test(part)||!/(?:18|19|20|21)\d{2}/.test(part))continue;
    const marker=` ${normalize(part)} `;
    const matches=new Set<CitationIdentity>();
    for(const [key,works] of signatures)if(marker.includes(` ${key} `))for(const work of works)matches.add(work);
    if(matches.size!==1)unresolved.push(part.trim());
  }
  return unresolved.length?["Sitasi dalam teks belum dapat dipasangkan secara unik dengan inventaris sumber: "+[...new Set(unresolved)].slice(0,8).join("; ")+". Identitas/edisi perlu diperiksa; entri tidak dikarang."]:[];
}

/** Completeness is a structural check, never a claim-support/fact validator. */
export function citationPairingIssues(answer:string,inventory:CitationIdentity[],style:CitationStyle){
  const boundary=heading.exec(answer);
  const body=answer.slice(0,boundary?.index??answer.length);
  const issues=authorDateStyle(style)?unresolvedCitationWarnings(body,inventory):[];
  if(authorDateStyle(style)){
    const signatures=new Map<string,Set<CitationIdentity>>();
    for(const item of inventory)for(const raw of item.authorYearKeys||[]){
      const key=normalize(raw),works=signatures.get(key)||new Set<CitationIdentity>();
      works.add(item);signatures.set(key,works);
    }
    for(const group of citationBody(body).matchAll(/\((\s*(?:18|19|20|21)\d{2}[a-z]?)(?:\s*,[^()]*)?\)/g)){
      const prefix=citationBody(body).slice(Math.max(0,group.index!-180),group.index);
      const author=prefix.match(/([\p{Lu}][\p{L}'’.-]*(?:\s+(?:[\p{Lu}][\p{L}'’.-]*|dan|and|&|et|al\.?|dkk\.?|de|van))*)\s*$/u)?.[1];
      if(!author)continue;
      const marker=normalize(prefix+" "+group[1]),works=new Set<CitationIdentity>();
      for(const [key,items] of signatures)if((" "+marker).endsWith(" "+key))for(const item of items)works.add(item);
      if(works.size!==1)issues.push("Sitasi naratif belum memiliki identitas sumber unik: "+author+" "+group[1].trim()+".");
    }
    const cited=omittedAuthorYearReferences(body,inventory,[]);
    const tail=boundary?answer.slice(boundary.index+boundary[0].length):"";
    for(const item of cited)if(!identityInEntry(tail,item))issues.push("Entri daftar pustaka belum tersedia untuk sumber yang disitasi: "+item.title+".");
  }
  if(style==="ieee"||style==="vancouver"){
    const tail=boundary?answer.slice(boundary.index+boundary[0].length):"";
    for(const n of numericMarkers(body)){
      const entry=tail.split(/\n(?=\s*(?:\[\d+\]|\d+[.)]))/).find(line=>Number(/^(?:\[(\d+)\]|(\d+)[.)])\s*/.exec(line.trim())?.slice(1).find(Boolean))===n);
      if(!entry||!inventory.some(item=>identityInEntry(entry,item)))issues.push("Sitasi numerik "+n+" belum memiliki entri sumber yang cocok.");
    }
  }
  if(style==="mla"){
    const tail=boundary?answer.slice(boundary.index+boundary[0].length):"";
    for(const item of mlaReferences(body,inventory))if(!identityInEntry(tail,item))issues.push("Entri Works Cited belum tersedia untuk sumber yang disitasi: "+item.title+".");
    for(const group of citationBody(body).matchAll(/\(([\p{Lu}][\p{L}'’.-]+(?:\s+(?:[\p{Lu}][\p{L}'’.-]+|and|dan|&|et|al\.?))*)\s+(\d+(?:\s*[–-]\s*\d+)?)\)/gu)){
      if(mlaReferences(group[0],inventory).length!==1)issues.push("Sitasi MLA belum memiliki sumber unik: "+group[1]+".");
    }
  }
  return [...new Set(issues)];
}

export function requiresQuantitativePaperEvidence(question:string){
  return /\b(?:formulasi|formulation|resep|formula)\b/i.test(question)&&/\b(?:mg|milligram|miligram|jumlah|massa|mass|komposisi|composition|eksipien|excipients?)\b/i.test(question)&&/\b(?:jurnal|journal|paper|tervalidasi|tervalida[i]?|validated)\b/i.test(question);
}

/** Natural-language requests to find scholarly literature are themselves an explicit
 * request for public research. A stale UI Web toggle must not prevent the scholarly
 * retriever from running when the user literally asks us to find journals/papers. */
export function explicitScholarlySearchIntent(question:string){
  const q=String(question||"");
  const scholarly=/\b(?:jurnal|journal|paper|papers|artikel\s+ilmiah|scientific\s+articles?|publikasi\s+ilmiah|scholarly|pubmed|doi)\b/i.test(q);
  const discovery=/\b(?:carikan|cari|temukan|telusuri|search(?:kan)?|find|look\s+for|browse|mencari|membahas)\b/i.test(q);
  return scholarly&&discovery;
}

/** A user-provided proposal is input data, not proof of a published recipe.
 * Permit its arithmetic/documentation without weakening journal-recipe gates. */
export function userFormulaProposal(question:string){
  if(!/\b(?:usulan|rancangan|formula saya|formulasi saya|my formula|proposed formulation)\b/i.test(question))return false;
  if(!/\b(?:buatkan|buat|susun|tulis|evaluasi|analisis|write|draft|evaluate)\b/i.test(question))return false;
  const items=Array.from(question.matchAll(/([a-z][a-z0-9_-]*(?:[\t ]+[a-z][a-z0-9_-]*){0,3})[\t ]+(\d+(?:[.,]\d+)?)[\t ]*mg\b/gi))
    .filter(item=>! /\b(?:untuk|total|tablet|tab|bobot|berat|dosis|per|of|at|weight|dose|for)\b/i.test(item[1]));
  return new Set(items.map(item=>item[1].toLowerCase().trim())).size>=2;
}

export const userFormulaNotice="Komposisi dan perhitungan batch di bawah memakai usulan Anda, bukan formula jurnal tervalidasi. Kesetaraan massa kokristal/API, kelayakan eksipien, dan mutu produk belum dibuktikan; materi ini untuk rancangan pembelajaran, bukan petunjuk produksi atau penggunaan klinis.";

export function userFormulaPrompt(allowed:boolean){
  return allowed ? "\n\nUSULAN KOMPOSISI DARI USER: angka bahan yang ditulis user boleh dipakai sebagai data usulan dan dihitung secara aritmetis (mg/tablet × jumlah tablet ÷ 1000 = g/batch). Labeli setiap tabel komposisi sebagai usulan user, bukan angka yang diambil dari jurnal. Periksa total massa dan persentase; jangan mengubah angka diam-diam. Ekuivalen kokristal/API dari user adalah asumsi belum diverifikasi, bukan temuan literatur. Jangan berhenti menulis seluruh dokumen hanya karena tabel jurnal belum ditemukan: lengkapi semua bagian yang diminta dengan data usulan, bukti yang benar-benar tersedia, atau penanda kekurangan bukti pada bagian terkait. Jangan menciptakan rentang lazim eksipien, spesifikasi mutu, klasifikasi BCS, monografi atau nomor halaman dari sumber yang belum dibaca. Bila monografi wajib FI/FHI/HOPE, tampilkan hanya informasi yang terlihat di sumber tersebut; bila tidak tersedia, buat checklist parameter yang perlu dilengkapi tanpa mengarang isi buku. Jangan mengisi kuota minimal jurnal/buku dengan identitas rekaan atau jurnal tidak relevan; nyatakan jumlah yang benar-benar ditemukan dan kekurangannya. Daftar pustaka harus menjadi bagian paling akhir dan hanya memuat inventaris sumber yang cocok. Pisahkan diagram/prosedur usulan konseptual dari proses yang sudah divalidasi." : "";
}

export const missingFormulaEvidence="Saya belum memperoleh full text jurnal yang memuat tabel komposisi dan jumlah bahan untuk formula yang Anda minta. Karena itu saya tidak akan membuat resep mg atau referensi dari pengetahuan internal. Metadata/abstrak saja tidak cukup. Aktifkan Web atau lampirkan PDF publik yang relevan; formula akan diambil dari tabel sumber, dengan nama bahan, satuan, jenis pelepasan, dan link yang dapat diperiksa.";

export function publicEvidenceFallbackNotice(state:{fullTextRead:boolean;pagesRead:boolean;metadataAvailable:boolean}){
  if(state.fullTextRead)return "Cuplikan teks penuh publik berhasil dibaca dan tersedia untuk jawaban ini. Pencocokan referensi bukan jaminan kebenaran setiap klaim.";
  if(state.pagesRead)return "Halaman publik berhasil dibaca dan tersedia untuk jawaban ini; dukungan tiap klaim tetap perlu diperiksa.";
  if(state.metadataAvailable)return "Bukti publik yang tersedia hanya metadata, abstrak, atau cuplikan hasil penelusuran. Teks penuh belum berhasil dibaca.";
  return "Belum ada halaman Web atau teks penuh publik yang berhasil dibaca. Pengetahuan internal AI bukan publikasi terverifikasi.";
}

/** Prompt excerpt IDs are internal, not citations. Only rename IDs backed by
 * this request's read excerpts; preserve code, links and bibliography titles. */
export function readableEvidenceLabels(answer:string,readExcerptCount:number){
  if(!Number.isSafeInteger(readExcerptCount)||readExcerptCount<1)return answer;
  const boundary=heading.exec(answer)?.index??answer.length;
  const body=answer.slice(0,boundary).replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`|!?\[[^\]\n]*\]\([^\)\n]*\)|https?:\/\/[^\s<>"\]]+|\bEVIDENCE[\t ]+([1-9]\d*)\b/g,(token,id:string|undefined)=>id&&Number(id)<=readExcerptCount?"sumber publik yang dibaca":token);
  return body+answer.slice(boundary);
}

/** Match a bibliography identity against actual retrieval, not the model's assertion that it exists. */
export function identityInEntry(entry:string,item:CitationIdentity){
  const formatted=item.formatted?normalize(item.formatted):"";
  if(formatted.length>=16&&normalize(entry).includes(formatted))return true;
  if(item.doi){const dois=entry.match(/\b10\.\d{4,9}\/[^\s<>"\]]+/gi)||[];if(dois.some(doi=>doi.replace(/[.,;)]+$/g,"").toLowerCase()===item.doi!.toLowerCase()))return true;}
  if(item.uri){try{const target=new URL(item.uri).href.replace(/\/$/,"");if((entry.match(/https?:\/\/[^\s<>"\]]+/gi)||[]).some(raw=>{try{return new URL(raw.replace(/[.,;)]+$/g,"")).href.replace(/\/$/,"")===target;}catch{return false;}}))return true;}catch{}}
  const title=normalize(item.title),line=normalize(entry);
  return title.length>=16 && line.includes(title);
}

export function guardAnswerBibliography(answer:string,inventory:CitationIdentity[],style:CitationStyle,strict=false,blocked:CitationIdentity[]=[]){
  // This is provenance, not an author/year citation. Preserve code and links.
  answer=answer.replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`|!?\[[^\]\n]*\]\([^\)\n]*\)|\(Bahan Pengguna\)/gi,token=>/^\(Bahan Pengguna\)$/i.test(token)?"— berdasarkan bahan pengguna":token);
  const boundary=heading.exec(answer)?.index??answer.length;
  answer=formatInTextPageLocators(answer.slice(0,boundary),style)+answer.slice(boundary);
  const match=heading.exec(answer);
  const fabricated=/pustaka internal farmasi|referensi internal (?:ai|model)|internal (?:ai|model) knowledge library/i.test(answer);
  if(fabricated)return {text:"Jawaban ditahan karena memuat sumber yang tidak dapat dibuktikan. Tidak ada referensi bernama ‘Pustaka Internal Farmasi’ dalam hasil penelusuran. Diperlukan sumber nyata sebelum komposisi atau sitasi tersebut dapat digunakan.",warnings:["Referensi rekaan diblokir; jawaban tidak boleh dipakai sebagai resep dari jurnal."],blocked:true};
  if(!match){
    const eligible=inventory.filter(item=>!blocked.some(conflict=>identityInEntry(`${item.title} ${item.uri||""} ${item.doi||""}`,conflict)));
    const cited=style==="mla"?mlaReferences(answer,eligible):authorDateStyle(style)?omittedAuthorYearReferences(answer,eligible,[]):[];
    if(cited.length){
      // Restore actual body citations even when the model omitted the heading.
      // Reuse the same canonical formatter/locator warnings, never a reading list.
      return guardAnswerBibliography(answer+"\n\nReferences:\n"+cited.map(item=>item.doi?`https://doi.org/${item.doi}`:item.title).join("\n"),cited,style,strict,blocked);
    }
    if(strict&&style!=="none")return {text:"Jawaban belum memiliki referensi jurnal yang dapat dicocokkan. Komposisi tidak ditampilkan sebagai resep tervalidasi. Gunakan PDF publik yang tersedia di panel sumber untuk memeriksa tabel bahan; jangan gunakan angka tanpa asal sumber yang jelas.",warnings:["Jawaban kuantitatif tanpa referensi sumber diblokir."],blocked:true};
    return {text:answer,warnings:authorDateStyle(style)?unresolvedCitationWarnings(answer,eligible):((style==="ieee"||style==="vancouver")&&numericMarkers(answer).size?["Ada sitasi numeric tanpa daftar pustaka; identitas sumber tidak ditebak dari urutan inventaris."]:[]),blocked:false};
  }
  const before=answer.slice(0,match.index).trim();
  const tail=answer.slice(match.index+match[0].length).trim();
  const entries=tail.split(/\n(?=\s*(?:\[\d+\]|\d+[.)]|[-*] |[\p{Lu}]))/u).map(e=>e.trim()).filter(Boolean);
  const known=entries.map(entry=>({entry,source:blocked.some(item=>identityInEntry(entry,item))?undefined:inventory.find(item=>identityInEntry(entry,item))}));
  const unknown=known.filter(item=>!item.source);
  if(strict&&unknown.length)return {text:"Jawaban belum dapat ditampilkan sebagai formula dari jurnal karena referensi yang dihasilkan tidak cocok dengan sumber yang berhasil ditemukan. Saya tidak akan mengisi komposisi atau daftar pustaka dengan tebakan. Periksa PDF sumber yang tersedia di bawah atau lampirkan paper tambahan.",warnings:["Jawaban dengan identitas referensi yang tidak cocok diblokir."],blocked:true};
  const numeric=style==="ieee"||style==="vancouver";
  const eligible=inventory.filter(item=>!blocked.some(conflict=>identityInEntry(`${item.title} ${item.uri||""} ${item.doi||""}`,conflict)));
  const numbers=numeric?numericMarkers(before):new Set<number>();
  const labelNumber=(entry:string)=>Number(/^(?:\[(\d+)\]|(\d+)[.)])\s*/.exec(entry)?.slice(1).find(Boolean)||0);
  const used=style==="mla"?mlaReferences(before,eligible):authorDateStyle(style)?omittedAuthorYearReferences(before,eligible,[]):[...new Set(known.flatMap(item=>item.source&&(!numeric||numbers.has(labelNumber(item.entry)))?[item.source]:[]))];
  const uncited=style!=="none"?known.filter(item=>item.source&&!used.includes(item.source)):[];
  if(strict&&style!=="none"&&!used.length)return {text:"Jawaban ditahan karena sumber belum disitasi dalam teks secara cocok. Daftar pustaka bukan daftar hasil pencarian; diperlukan sitasi ke sumber nyata sebelum jawaban dapat disebut berbasis jurnal.",warnings:["Tidak ada sitasi dalam teks yang cocok; referensi tidak ditambahkan untuk mengisi daftar pustaka."],blocked:true};
  const omitted=authorDateStyle(style)?omittedAuthorYearReferences(before,eligible,used):[];
  used.push(...omitted);
  if(!numeric)used.sort((a,b)=>(a.formatted||a.title).localeCompare(b.formatted||b.title,"en"));
  // Preserve numeric identities only when all entries matched; don't silently renumber in-text citations.
  const references=used.map(item=>{
    const matched=known.find(k=>k.source===item&&(!numeric||numbers.has(labelNumber(k.entry))))?.entry||"";
    const identityUrl=publicUrl(item.uri)||(item.doi?publicUrl("https://doi.org/"+item.doi):null);
    // One link for the complete CSL entry. Prefer the document actually read,
    // not a separate status label or a DOI that sends readers elsewhere.
    const readUrl=publicUrl(item.readSource?.uri);
    const target=readUrl||identityUrl;
    let plain=(item.formatted||item.title)
      .replace(numeric?/^(?:\[\d+\]|\d+[.)])\s*/:/^$/,"")
      .replace(/\[([^\]\n]+)\]\([^\)\n]*\)/g,"$1")
      .trim();
    const doi=normalizeDoi(item.doi);
    if(doi&&!plain.toLowerCase().includes(doi.toLowerCase()))plain+=` https://doi.org/${doi}`;
    const labelText=plain.replace(/\\/g,"\\\\").replace(/\[/g,"\\[").replace(/\]/g,"\\]");
    let canonical=target?`[${labelText}](${target.replace(/\(/g,"%28").replace(/\)/g,"%29")})`:plain;
    // Excerpt locators belong in the in-text citation, according to the style,
    // not as an ad-hoc suffix on a whole-book CSL bibliography entry. Chapter
    // publication page ranges, when supplied, are already formatted by CSL.
    const label=/^(?:\[\d+\]|\d+[.)])\s*/.exec(matched)?.[0]||"";
    return numeric?label+canonical.replace(/^(?:\[\d+\]|\d+[.)])\s*/,""):canonical;
  });
  const warnings=unknown.length?["Entri referensi yang tidak cocok dengan inventaris sumber telah dihapus; dukungan klaim tetap perlu diperiksa."]:[];
  if(uncited.length)warnings.push("Entri daftar pustaka tanpa sitasi dalam teks telah dihapus. Hasil pencarian dan bacaan tambahan bukan daftar pustaka jawaban.");
  if(numeric&&[...numbers].some(n=>!known.some(item=>item.source&&labelNumber(item.entry)===n)))warnings.push("Ada sitasi numeric tanpa entri sumber yang cocok; nomor tidak dipasangkan berdasarkan urutan inventaris atau dikarang.");
  if(!numeric&&style!=="none")warnings.push(...unresolvedCitationWarnings(before,eligible));
  if(used.some(item=>(item.workType==="book"||item.workType==="chapter")&&!item.printedPages?.length))warnings.push("Ada buku tanpa halaman cetak terverifikasi; nomor PDF tidak digunakan sebagai pengganti.");
  return {text:before+(references.length?`\n\n*${style==="mla"?"Works Cited":"References"}:*\n`+references.join("\n\n"):"\n\nTidak ada referensi formal yang cocok dengan sumber hasil penelusuran."),warnings,blocked:false};
}

export function evidenceRules(hasFullText:boolean){return "\n\nBATAS BUKTI WAJIB: pengetahuan internal AI bukan karya bibliografis dan tidak boleh dibuat menjadi referensi. Tidak boleh ada ‘Pustaka Internal Farmasi’, sumber anonim rekaan, DOI atau judul dari ingatan. Hanya karya dalam inventaris sumber yang benar-benar disitasi dalam teks boleh masuk References. Dilarang menambahkan sumber yang tidak disitasi hanya untuk mengisi daftar pustaka. Setiap karya yang disebut dengan sitasi, termasuk saran bacaan dan bagian keterbatasan, harus memiliki entri References; jangan hanya mendaftarkan sumber formula utama. Identitas judul/DOI yang cocok bukan validasi ilmiah, klinis, mutu jurnal, atau peringkat indeks. Jangan mengulang label ‘jurnal/literatur tervalidasi’ dari pertanyaan tanpa bukti jenis validasi itu. Sebut formula sebagai formula penelitian, bukan resep penggunaan atau produk klinis tervalidasi. Bila user meminta resep formulasi dari jurnal, angka bahan harus terlihat dalam full text/tabel yang tersedia. Untuk tablet konvensional/lepas segera, jangan menghitung formulasi sustained/controlled release, floating/gastro-retentive, atau matriks lepas lambat sebagai model yang memenuhi permintaan; bila disebut, tempatkan sebagai studi berbeda di luar cakupan, bukan Model 2 pengganti. Dua varian formula satu paper harus disebut sebagai dua varian satu paper, bukan dua publikasi independen. Pada kokristal, bedakan massa kokristal dari massa API murni secara eksplisit; jangan mengarang ekuivalen API bila sumber tidak menyatakannya. "+(hasFullText?"Full text yang benar-benar dibaca ditandai EVIDENCE; sitasikan judul/DOI yang cocok dan link sumber publik tersebut. Utamakan temuan pada EVIDENCE. Bila mengutip temuan dari abstrak katalog, tulis eksplisit ‘berdasarkan abstrak’, bukan seolah seluruh paper telah dibaca. Metadata tanpa abstrak hanya boleh menjadi saran bacaan, bukan bukti temuan.":"Belum ada full text jurnal publik yang berhasil dibaca; jangan menyebut komposisi mg sebagai resep jurnal. Jelaskan kekurangan bukti. Bila abstrak tersedia, labeli temuan sebagai berdasarkan abstrak, bukan pembacaan full text.");}

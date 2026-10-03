import type { CitationStyle } from "./citations";
import { publicUrl } from "./researchLinks";

export type CitationIdentity={title:string;doi?:string|null;uri?:string;formatted?:string;authorYearKeys?:string[];workType?:string;year?:number|null;printedPages?:string[];readSource?:{uri:string;format:string;pages:number[]};catalogOnly?:boolean;repositoryLinks?:Array<{label:string;uri:string}>};
const heading=/^[\t ]*(?:#{1,6}[\t ]*)?(?:\*{1,2}|_{1,2})?(?:(?:Slide[\t ]+\d{1,3}[\t ]*[-–—:.][\t ]*)|(?:\d{1,3}[.)][\t ]+))?(?:References|Daftar Pustaka|Referensi(?: Ilmiah)?|Bibliography|Works Cited)[\t ]*:?[\t ]*(?:\*{1,2}|_{1,2})?[\t ]*:?[\t ]*$/im;
const normalize=(text:string)=>text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim();

/** Only unambiguous, catalog-backed author/year markers count as omitted references.
 * Never infer a work from a surname alone, or assign/renumber numeric citations. */
export function omittedAuthorYearReferences(body:string,inventory:CitationIdentity[],used:CitationIdentity[]){
  const normalized=` ${normalize(body)} `;
  const signatureMatches=new Map<string,CitationIdentity[]>();
  for(const item of inventory)for(const raw of item.authorYearKeys||[]){
    const key=normalize(raw);if(!key)continue;
    const matches=signatureMatches.get(key)||[];
    if(!matches.includes(item))matches.push(item);
    signatureMatches.set(key,matches);
  }
  return inventory.filter(item=>!used.includes(item)&&(item.authorYearKeys||[]).some(raw=>{
    const key=normalize(raw);
    return signatureMatches.get(key)?.length===1&&normalized.includes(` ${key} `);
  }));
}

/** Flag unresolved parenthetical author-year markers; never synthesize metadata. */
function unresolvedCitationWarnings(body:string,inventory:CitationIdentity[]){
  const unresolved:string[]=[];
  const signatures=new Map<string,Set<CitationIdentity>>();
  for(const item of inventory)for(const raw of item.authorYearKeys||[]){
    const key=normalize(raw);const works=signatures.get(key)||new Set<CitationIdentity>();works.add(item);signatures.set(key,works);
  }
  for(const group of body.matchAll(/\(([^()\n]{1,240})\)/g))for(const part of group[1].split(";")){
    if(!/^\s*[\p{L}]/u.test(part)||!/(?:18|19|20|21)\d{2}/.test(part))continue;
    const marker=` ${normalize(part)} `;
    const matches=new Set<CitationIdentity>();
    for(const [key,works] of signatures)if(marker.includes(` ${key} `))for(const work of works)matches.add(work);
    if(matches.size!==1)unresolved.push(part.trim());
  }
  return unresolved.length?["Sitasi dalam teks belum dapat dipasangkan secara unik dengan inventaris sumber: "+[...new Set(unresolved)].slice(0,8).join("; ")+". Identitas/edisi perlu diperiksa; entri tidak dikarang."]:[];
}

export function requiresQuantitativePaperEvidence(question:string){
  return /\b(?:formulasi|formulation|resep|formula)\b/i.test(question)&&/\b(?:mg|milligram|miligram|jumlah|komposisi|composition|eksipien|excipients?)\b/i.test(question)&&/\b(?:jurnal|journal|paper|tervalidasi|tervalida[i]?|validated)\b/i.test(question);
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
  if(item.doi){const dois=entry.match(/\b10\.\d{4,9}\/[^\s<>"\]]+/gi)||[];if(dois.some(doi=>doi.replace(/[.,;)]+$/g,"").toLowerCase()===item.doi!.toLowerCase()))return true;}
  if(item.uri){try{const target=new URL(item.uri).href.replace(/\/$/,"");if((entry.match(/https?:\/\/[^\s<>"\]]+/gi)||[]).some(raw=>{try{return new URL(raw.replace(/[.,;)]+$/g,"")).href.replace(/\/$/,"")===target;}catch{return false;}}))return true;}catch{}}
  const title=normalize(item.title),line=normalize(entry);
  return title.length>=16 && line.includes(title);
}

export function guardAnswerBibliography(answer:string,inventory:CitationIdentity[],style:CitationStyle,strict=false,blocked:CitationIdentity[]=[]){
  const match=heading.exec(answer);
  const fabricated=/pustaka internal farmasi|referensi internal (?:ai|model)|internal (?:ai|model) knowledge library/i.test(answer);
  if(fabricated)return {text:"Jawaban ditahan karena memuat sumber yang tidak dapat dibuktikan. Tidak ada referensi bernama ‘Pustaka Internal Farmasi’ dalam hasil penelusuran. Diperlukan sumber nyata sebelum komposisi atau sitasi tersebut dapat digunakan.",warnings:["Referensi rekaan diblokir; jawaban tidak boleh dipakai sebagai resep dari jurnal."],blocked:true};
  if(!match){
    const eligible=inventory.filter(item=>!blocked.some(conflict=>identityInEntry(`${item.title} ${item.uri||""} ${item.doi||""}`,conflict)));
    const cited=style!=="none"&&style!=="ieee"&&style!=="vancouver"?omittedAuthorYearReferences(answer,eligible,[]):[];
    if(cited.length){
      // Restore actual body citations even when the model omitted the heading.
      // Reuse the same canonical formatter/locator warnings, never a reading list.
      return guardAnswerBibliography(answer+"\n\nReferences:\n"+cited.map(item=>item.doi?`https://doi.org/${item.doi}`:item.title).join("\n"),cited,style,strict,blocked);
    }
    if(strict&&style!=="none")return {text:"Jawaban belum memiliki referensi jurnal yang dapat dicocokkan. Komposisi tidak ditampilkan sebagai resep tervalidasi. Gunakan PDF publik yang tersedia di panel sumber untuk memeriksa tabel bahan; jangan gunakan angka tanpa asal sumber yang jelas.",warnings:["Jawaban kuantitatif tanpa referensi sumber diblokir."],blocked:true};
    return {text:answer,warnings:style!=="none"&&style!=="ieee"&&style!=="vancouver"?unresolvedCitationWarnings(answer,eligible):[],blocked:false};
  }
  const before=answer.slice(0,match.index).trim();
  const tail=answer.slice(match.index+match[0].length).trim();
  const entries=tail.split(/\n(?=\s*(?:\[\d+\]|\d+[.)]|[-*] |[\p{Lu}]))/u).map(e=>e.trim()).filter(Boolean);
  const known=entries.map(entry=>({entry,source:blocked.some(item=>identityInEntry(entry,item))?undefined:inventory.find(item=>identityInEntry(entry,item))}));
  const unknown=known.filter(item=>!item.source);
  if(strict&&unknown.length)return {text:"Jawaban belum dapat ditampilkan sebagai formula dari jurnal karena referensi yang dihasilkan tidak cocok dengan sumber yang berhasil ditemukan. Saya tidak akan mengisi komposisi atau daftar pustaka dengan tebakan. Periksa PDF sumber yang tersedia di bawah atau lampirkan paper tambahan.",warnings:["Jawaban dengan identitas referensi yang tidak cocok diblokir."],blocked:true};
  const used=[...new Set(known.flatMap(item=>item.source?[item.source]:[]))];
  const numeric=style==="ieee"||style==="vancouver";
  const eligible=inventory.filter(item=>!blocked.some(conflict=>identityInEntry(`${item.title} ${item.uri||""} ${item.doi||""}`,conflict)));
  const omitted=!numeric&&style!=="none"?omittedAuthorYearReferences(before,eligible,used):[];
  used.push(...omitted);
  if(!numeric)used.sort((a,b)=>(a.formatted||a.title).localeCompare(b.formatted||b.title,"en"));
  // Preserve numeric identities only when all entries matched; don't silently renumber in-text citations.
  const references=used.map(item=>{
    const matched=known.find(k=>k.source===item)?.entry||"";
    const identityUrl=publicUrl(item.uri)||(item.doi?publicUrl("https://doi.org/"+item.doi):null);
    let canonical=item.formatted||(identityUrl?`[${item.title}](${identityUrl})`:item.title);
    if(item.workType==="book"||item.workType==="chapter")canonical+=item.printedPages?.length?` · Halaman cetak sumber terambil: ${item.printedPages.join(", ")}.`:" · Halaman cetak belum tersedia; bukan kutipan buku dengan locator terverifikasi.";
    const readUrl=publicUrl(item.readSource?.uri);
    if(readUrl){
      const format=item.readSource!.format==="full-text-pdf"?"PDF":item.readSource!.format==="full-text-xml"?"XML":"HTML";
      const locators=item.readSource!.pages.length?`; halaman PDF ${item.readSource!.pages.join(", ")}`:"; cuplikan bagian/tabel";
      canonical+=` · [Teks lengkap publik — ${format} dibaca${locators}](${readUrl.replace(/\(/g,"%28").replace(/\)/g,"%29")})`;
    }else if(item.catalogOnly){canonical+=" · Bukti tersedia: metadata/abstrak; teks lengkap belum dibaca.";}
    // Catalog-returned PMCID links give human-readable alternatives to a
    // publisher PDF that may fail on cookies. They do not assert an OA license
    // or that this alternate version was read by the server.
    const linked=new Set([readUrl]);
    for(const alternative of (item.repositoryLinks||[]).slice(0,2)){
      const uri=publicUrl(alternative.uri);if(!uri||linked.has(uri))continue;linked.add(uri);
      canonical+=` · [${alternative.label.replace(/[\[\]\n]/g,"")}](${uri.replace(/\(/g,"%28").replace(/\)/g,"%29")})`;
    }
    const label=/^(?:\[\d+\]|\d+[.)])\s*/.exec(matched)?.[0]||"";
    return numeric&&!unknown.length?label+canonical.replace(/^(?:\[\d+\]|\d+[.)])\s*/,""):canonical;
  });
  const warnings=unknown.length?["Entri referensi yang tidak cocok dengan inventaris sumber telah dihapus; dukungan klaim tetap perlu diperiksa."]:[];
  if(!numeric&&style!=="none")warnings.push(...unresolvedCitationWarnings(before,eligible));
  if(used.some(item=>(item.workType==="book"||item.workType==="chapter")&&!item.printedPages?.length))warnings.push("Ada buku tanpa halaman cetak terverifikasi; nomor PDF tidak digunakan sebagai pengganti.");
  return {text:before+(references.length?`\n\n*${style==="mla"?"Works Cited":"References"}:*\n`+references.join("\n\n"):"\n\nTidak ada referensi formal yang cocok dengan sumber hasil penelusuran."),warnings,blocked:false};
}

export function evidenceRules(hasFullText:boolean){return "\n\nBATAS BUKTI WAJIB: pengetahuan internal AI bukan karya bibliografis dan tidak boleh dibuat menjadi referensi. Tidak boleh ada ‘Pustaka Internal Farmasi’, sumber anonim rekaan, DOI atau judul dari ingatan. Hanya karya dalam inventaris sumber boleh masuk References. Setiap karya yang disebut dengan sitasi, termasuk saran bacaan dan bagian keterbatasan, harus memiliki entri References; jangan hanya mendaftarkan sumber formula utama. Identitas judul/DOI yang cocok bukan validasi ilmiah, klinis, mutu jurnal, atau peringkat indeks. Jangan mengulang label ‘jurnal/literatur tervalidasi’ dari pertanyaan tanpa bukti jenis validasi itu. Sebut formula sebagai formula penelitian, bukan resep penggunaan atau produk klinis tervalidasi. Bila user meminta resep formulasi dari jurnal, angka bahan harus terlihat dalam full text/tabel yang tersedia. Untuk tablet konvensional/lepas segera, jangan menghitung formulasi sustained/controlled release, floating/gastro-retentive, atau matriks lepas lambat sebagai model yang memenuhi permintaan; bila disebut, tempatkan sebagai studi berbeda di luar cakupan, bukan Model 2 pengganti. Dua varian formula satu paper harus disebut sebagai dua varian satu paper, bukan dua publikasi independen. Pada kokristal, bedakan massa kokristal dari massa API murni secara eksplisit; jangan mengarang ekuivalen API bila sumber tidak menyatakannya. "+(hasFullText?"Full text yang benar-benar dibaca ditandai EVIDENCE; sitasikan judul/DOI yang cocok dan link sumber publik tersebut. Utamakan temuan pada EVIDENCE. Bila mengutip temuan dari abstrak katalog, tulis eksplisit ‘berdasarkan abstrak’, bukan seolah seluruh paper telah dibaca. Metadata tanpa abstrak hanya boleh menjadi saran bacaan, bukan bukti temuan.":"Belum ada full text jurnal publik yang berhasil dibaca; jangan menyebut komposisi mg sebagai resep jurnal. Jelaskan kekurangan bukti. Bila abstrak tersedia, labeli temuan sebagai berdasarkan abstrak, bukan pembacaan full text.");}

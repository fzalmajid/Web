import type { CitationStyle } from "./citations";
import { publicUrl } from "./researchLinks";

export type CitationIdentity={title:string;doi?:string|null;uri?:string;formatted?:string;readSource?:{uri:string;format:string;pages:number[]};catalogOnly?:boolean};
const heading=/^[\t ]*(?:#{1,6}[\t ]*)?(?:\*{1,2}|_{1,2})?(?:\d{1,3}[.)][\t ]+)?(?:References|Daftar Pustaka|Referensi(?: Ilmiah)?|Bibliography|Works Cited)[\t ]*:?[\t ]*(?:\*{1,2}|_{1,2})?[\t ]*:?[\t ]*$/im;
const normalize=(text:string)=>text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim();

export function requiresQuantitativePaperEvidence(question:string){
  return /\b(?:formulasi|formulation|resep|formula)\b/i.test(question)&&/\b(?:mg|milligram|miligram|jumlah|komposisi|composition|eksipien|excipients?)\b/i.test(question)&&/\b(?:jurnal|journal|paper|tervalidasi|tervalida[i]?|validated)\b/i.test(question);
}

export const missingFormulaEvidence="Saya belum memperoleh full text jurnal yang memuat tabel komposisi dan jumlah bahan untuk formula yang Anda minta. Karena itu saya tidak akan membuat resep mg atau referensi dari pengetahuan internal. Metadata/abstrak saja tidak cukup. Aktifkan Web atau lampirkan PDF publik yang relevan; formula akan diambil dari tabel sumber, dengan nama bahan, satuan, jenis pelepasan, dan link yang dapat diperiksa.";

/** Match a bibliography identity against actual retrieval, not the model's assertion that it exists. */
export function identityInEntry(entry:string,item:CitationIdentity){
  if(item.doi){const dois=entry.match(/\b10\.\d{4,9}\/[^\s<>"\]]+/gi)||[];if(dois.some(doi=>doi.replace(/[.,;)]+$/g,"").toLowerCase()===item.doi!.toLowerCase()))return true;}
  if(item.uri){try{const target=new URL(item.uri).href.replace(/\/$/,"");if((entry.match(/https?:\/\/[^\s<>"\]]+/gi)||[]).some(raw=>{try{return new URL(raw.replace(/[.,;)]+$/g,"")).href.replace(/\/$/,"")===target;}catch{return false;}}))return true;}catch{}}
  const title=normalize(item.title),line=normalize(entry);
  return title.length>=16 && line.includes(title);
}

export function guardAnswerBibliography(answer:string,inventory:CitationIdentity[],style:CitationStyle,strict=false){
  const match=heading.exec(answer);
  const fabricated=/pustaka internal farmasi|referensi internal (?:ai|model)|internal (?:ai|model) knowledge library/i.test(answer);
  if(fabricated)return {text:"Jawaban ditahan karena memuat sumber yang tidak dapat dibuktikan. Tidak ada referensi bernama ‘Pustaka Internal Farmasi’ dalam hasil penelusuran. Diperlukan sumber nyata sebelum komposisi atau sitasi tersebut dapat digunakan.",warnings:["Referensi rekaan diblokir; jawaban tidak boleh dipakai sebagai resep dari jurnal."],blocked:true};
  if(!match){
    if(strict&&style!=="none")return {text:"Jawaban belum memiliki referensi jurnal yang dapat dicocokkan. Komposisi tidak ditampilkan sebagai resep tervalidasi. Gunakan PDF publik yang tersedia di panel sumber untuk memeriksa tabel bahan; jangan gunakan angka tanpa asal sumber yang jelas.",warnings:["Jawaban kuantitatif tanpa referensi sumber diblokir."],blocked:true};
    return {text:answer,warnings:[] as string[],blocked:false};
  }
  const before=answer.slice(0,match.index).trim();
  const tail=answer.slice(match.index+match[0].length).trim();
  const entries=tail.split(/\n(?=\s*(?:\[\d+\]|\d+[.)]|[-*] |[\p{Lu}]))/u).map(e=>e.trim()).filter(Boolean);
  const known=entries.map(entry=>({entry,source:inventory.find(item=>identityInEntry(entry,item))}));
  const unknown=known.filter(item=>!item.source);
  if(strict&&unknown.length)return {text:"Jawaban belum dapat ditampilkan sebagai formula dari jurnal karena referensi yang dihasilkan tidak cocok dengan sumber yang berhasil ditemukan. Saya tidak akan mengisi komposisi atau daftar pustaka dengan tebakan. Periksa PDF sumber yang tersedia di bawah atau lampirkan paper tambahan.",warnings:["Jawaban dengan identitas referensi yang tidak cocok diblokir."],blocked:true};
  const used=[...new Set(known.flatMap(item=>item.source?[item.source]:[]))];
  const numeric=style==="ieee"||style==="vancouver";
  // Preserve numeric identities only when all entries matched; don't silently renumber in-text citations.
  const references=used.map(item=>{
    const matched=known.find(k=>k.source===item)!.entry;
    let canonical=item.formatted||`[${item.title}](${item.uri||"https://doi.org/"+item.doi})`;
    const readUrl=publicUrl(item.readSource?.uri);
    if(readUrl){
      const format=item.readSource!.format==="full-text-pdf"?"PDF":item.readSource!.format==="full-text-xml"?"XML":"HTML";
      const locators=item.readSource!.pages.length?`; halaman PDF ${item.readSource!.pages.join(", ")}`:"; cuplikan bagian/tabel";
      canonical+=` · [Teks lengkap publik — ${format} dibaca${locators}](${readUrl.replace(/\(/g,"%28").replace(/\)/g,"%29")})`;
    }else if(item.catalogOnly){canonical+=" · Bukti tersedia: metadata/abstrak; teks lengkap belum dibaca.";}
    const label=/^(?:\[\d+\]|\d+[.)])\s*/.exec(matched)?.[0]||"";
    return numeric&&!unknown.length?label+canonical.replace(/^(?:\[\d+\]|\d+[.)])\s*/,""):canonical;
  });
  return {text:before+(references.length?`\n\n*${style==="mla"?"Works Cited":"References"}:*\n`+references.join("\n\n"):"\n\nTidak ada referensi formal yang cocok dengan sumber hasil penelusuran."),warnings:unknown.length?["Entri referensi yang tidak cocok dengan inventaris sumber telah dihapus; dukungan klaim tetap perlu diperiksa."]:[],blocked:false};
}

export function evidenceRules(hasFullText:boolean){return "\n\nBATAS BUKTI WAJIB: pengetahuan internal AI bukan karya bibliografis dan tidak boleh dibuat menjadi referensi. Tidak boleh ada ‘Pustaka Internal Farmasi’, sumber anonim rekaan, DOI atau judul dari ingatan. Hanya karya dalam inventaris sumber boleh masuk References. Bila user meminta resep formulasi dari jurnal, angka bahan harus terlihat dalam full text/tabel yang tersedia. "+(hasFullText?"Full text yang benar-benar dibaca ditandai EVIDENCE; sitasikan judul/DOI yang cocok dan link sumber publik tersebut. Utamakan temuan pada EVIDENCE. Bila mengutip temuan dari abstrak katalog, tulis eksplisit ‘berdasarkan abstrak’, bukan seolah seluruh paper telah dibaca. Metadata tanpa abstrak hanya boleh menjadi saran bacaan, bukan bukti temuan.":"Belum ada full text jurnal publik yang berhasil dibaca; jangan menyebut komposisi mg sebagai resep jurnal. Jelaskan kekurangan bukti. Bila abstrak tersedia, labeli temuan sebagai berdasarkan abstrak, bukan pembacaan full text.");}

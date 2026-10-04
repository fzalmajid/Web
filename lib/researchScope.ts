// Common names aid discovery at genus level only; they never supply a species.
const commonGenera:Array<[RegExp,string]>=[[/\b(?:cabai(?: keriting)?|chili(?: pepper)?|red pepper|paprika)\b/i,"Capsicum"],[/\b(?:kemangi|basil)\b/i,"Ocimum"],[/\b(?:kunyit|turmeric)\b/i,"Curcuma"],[/\b(?:tomat|tomato)\b/i,"Solanum"]];
const nonGenera=new Set("buatkan buat jelaskan carikan cari dasar teori laporan praktikum pengeringan penyiapan sample preparation drying dried medicinal botanical plant purification storage sorting extraction quality influence effect effects the performance color bioactive references study research solar energy artificial machine natural products".split(" "));
function oneEdit(a:string,b:string){
  a=a.toLowerCase();b=b.toLowerCase();
  if(Math.abs(a.length-b.length)>1)return false;
  let i=0,j=0,edits=0;
  while(i<a.length&&j<b.length){if(a[i]===b[j]){i++;j++;continue;}if(++edits>1)return false;if(a.length>=b.length)i++;if(b.length>=a.length)j++;}
  return edits+(a.length-i)+(b.length-j)<=1;
}
export function researchScope(text:string){
  const common=commonGenera.find(([pattern])=>pattern.test(text))?.[1]||commonGenera.find(([,genus])=>new RegExp("\\b"+genus+"\\b","i").test(text))?.[1];
  const genusOnly=/\b([A-Za-z][a-z]{2,})\s+(spp?)(?:\.|\b)/.exec(text);
  const named=Array.from(text.matchAll(/\b([A-Z][a-z]{2,})\s+([a-z][a-z-]{2,})\b/g)).find(match=>!nonGenera.has(match[1].toLowerCase())&&!nonGenera.has(match[2].toLowerCase()));
  const lowerNamed=common?new RegExp(`\\b(${common})\\s+([a-z][a-z-]{2,})\\b`,"i").exec(text):null;
  const match=genusOnly||(!named||nonGenera.has(named[1].toLowerCase())?lowerNamed:named);
  if(match&&!nonGenera.has(match[1].toLowerCase())&&!nonGenera.has(match[2].toLowerCase())){
    const original=match[1], genus=common&&oneEdit(original,common)?common:original[0].toUpperCase()+original.slice(1).toLowerCase();
    const species=/^spp?$/i.test(match[2])?null:match[2].toLowerCase();
    return {genus,species,label:genus+(species?" "+species:" sp."),correction:original.toLowerCase()!==genus.toLowerCase()?original+" → "+genus:null,explicit:true};
  }
  return common?{genus:common,species:null,label:common+" sp.",correction:null,explicit:false}:null;
}
export function scopeSearchText(text:string){
  const scope=researchScope(text);
  if(!scope)return text;
  let result=text;
  for(const [pattern] of commonGenera)result=result.replace(new RegExp(pattern.source,"gi")," ");
  if(scope.correction)result=result.replace(new RegExp("\\b"+scope.correction.split(" → ")[0]+"\\b","gi"),scope.genus);
  if(!new RegExp("\\b"+scope.genus+"\\b","i").test(result))result=scope.genus+" "+result;
  return result.replace(/\b(spp?)\./gi,"$1").replace(/\s+/g," ").trim();
}
export function researchScopeInstruction(question:string){
  const scope=researchScope(question);
  return "\n\nCAKUPAN BUKTI: Identitas, populasi, objek, proses, dan tujuan yang ditulis pengguna mengalahkan alias pencarian. Jangan mengganti objek dengan objek jawaban sebelumnya. Hasil penelitian pada satu spesies/varietas, populasi, kondisi, atau metode hanya mendukung cakupan tersebut; jangan menggeneralisasi tanpa bukti tambahan. Sebut objek penelitian sebenarnya ketika memakai sumber terkait, dan bedakan dari prinsip umum. Jangan mengutip artikel pengeringan untuk definisi resmi simplisia atau seluruh tahap sortasi/pencucian jika teksnya tidak mendukung klaim itu."
    +(scope?" Cakupan takson yang diminta: "+scope.label+". "+(!scope.species?"Spesies belum ditentukan; jangan menetapkannya sebagai spesies dari artikel yang ditemukan.":"Pertahankan spesies yang ditulis pengguna; studi spesies lain hanya pembanding yang diberi label.")+(scope.correction?" Koreksi ejaan pencarian sementara: "+scope.correction+". Nyatakan koreksi ini sebagai interpretasi, bukan identifikasi spesimen yang terkonfirmasi.":""):"");
}

import type { CitationStyle } from "./citations";
import { citationPairingIssues, guardAnswerBibliography, identityInEntry, type CitationIdentity } from "./answerEvidence";

export const citationCompletionInstruction = "\n\nSITASI DAN DAFTAR PUSTAKA WAJIB BERPASANGAN: sitasi dalam teks pengguna/riwayat adalah petunjuk yang belum dibuktikan, bukan identitas publikasi. Gunakan hanya sumber dalam inventaris dengan identitas unik dan isi yang mendukung klaim. Nama lembaga dan tahun yang sama tidak membuktikan buku tersebut mendukung definisi/prosedur: periksa judul dan cuplikannya. Jangan memindahkan sitasi dari karya lain atau menebak judul dari nama penulis. Jika identitas belum tersedia, tulis keterbatasan pada bagian itu atau hapus klaim yang tidak dapat didukung; jangan hanya menghapus kurung sambil mempertahankan klaim sebagai fakta terverifikasi. Setiap sitasi harus mempunyai entri References; entri tanpa sitasi tidak boleh dimasukkan.";

export async function completeAnswerCitations(options:{
  answer:string; inventory:CitationIdentity[]; style:CitationStyle;
  strict?:boolean; blocked?:CitationIdentity[];
  repair?:(issues:string[])=>Promise<string>;
}){
  const blocked=options.blocked||[];
  const eligible=options.inventory.filter(item=>!blocked.some(conflict=>identityInEntry(item.title+" "+(item.uri||"")+" "+(item.doi||""),conflict)));
  let guarded=guardAnswerBibliography(options.answer,options.inventory,options.style,options.strict,blocked);
  let issues=citationPairingIssues(guarded.blocked?options.answer:guarded.text,eligible,options.style);
  let attempted=false;
  if(issues.length&&options.repair){
    attempted=true;
    try{
      const text=await options.repair(issues);
      if(text.trim()){
        guarded=guardAnswerBibliography(text,options.inventory,options.style,options.strict,blocked);
        issues=citationPairingIssues(guarded.blocked?text:guarded.text,eligible,options.style);
      }
    }catch{
      // Do not turn a failed repair into a provider-fallback storm or fabricate entries.
    }
  }
  if(issues.length)return {
    text:"Jawaban belum dapat ditampilkan karena masih ada sitasi yang tidak memiliki pasangan sumber dan daftar pustaka yang jelas. Perbaikan otomatis belum berhasil menyelesaikannya. Lengkapi sumber asli/identitas publikasi yang disebut; referensi tidak akan dikarang atau dipasangkan hanya berdasarkan nama penulis dan tahun.",
    warnings:[...guarded.warnings,...issues],blocked:true,repairAttempted:attempted,
  };
  return {...guarded,repairAttempted:attempted};
}

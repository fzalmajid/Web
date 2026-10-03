import type { CitationIdentity } from "./answerEvidence";
import { guardAnswerBibliography } from "./answerEvidence";
import type { CitationStyle } from "./citations";

/** Restore only actual citations; discovery results remain in the source panel. */
export function recoverDocumentBibliography(text:string, inventory:CitationIdentity[], blocked:CitationIdentity[]=[], _question="", style:CitationStyle="apa"){
  const result=guardAnswerBibliography(text,inventory,style,false,blocked);
  return {text:result.text,warnings:result.warnings};
}

export function monographInstruction(question:string){
  if(!/\b(?:monografi|monographs?)\b/i.test(question))return "";
  return "\n\nMONOGRAFI LENGKAP, BUKAN DESKRIPSI SINGKAT: buat bagian terpisah untuk SETIAP bahan yang diminta, termasuk bahan herbal dan kokristal. Ikuti struktur dan urutan monografi sumber yang benar-benar dibaca: judul/identitas, nama lain, rumus/Mr bila ada, definisi/kadar, pemerian, kelarutan, identifikasi, kemurnian/batas cemaran, uji khusus, penetapan kadar, penyimpanan/wadah, serta fungsi dan inkompatibilitas bila sumber memuatnya. Jangan menambahkan parameter yang tidak ada; jangan mencampurkan FI, FHI dan HOPE seolah satu monografi. Cantumkan buku, edisi, tahun dan halaman tercetak/PDF yang terlihat, tanpa menebak. Pertahankan angka, satuan dan syarat sumber dalam parafrasa terstruktur yang setia. Kutipan verbatim panjang hanya untuk teks yang disediakan user atau izin/lisensi reproduksi yang terkonfirmasi; buku berhak cipta tanpa izin: gunakan parafrasa lengkap dan kutipan pendek, bukan copy-paste panjang. Jika sumber hanya cuplikan, labeli monografi parsial dan daftar subbagian yang belum tersedia; jangan menyebutnya monografi lengkap. Jika bahan tidak punya monografi ditemukan, nyatakan belum ditemukan; jangan mengganti spesies, serbuk/ekstrak, kokristal/API atau menebak coformer. Setiap monografi harus punya rujukan identitas sumber yang cocok dalam References. Daftar pustaka HANYA memuat sumber yang disitasi dalam teks monografi; setiap sitasi harus memiliki entri dengan identitas/DOI/URL persis. Sumber yang ditemukan tetapi belum disitasi tetap di panel sumber, bukan dipulihkan sebagai daftar pustaka.";
}

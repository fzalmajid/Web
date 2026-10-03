import type { CitationIdentity } from "./answerEvidence";
import { identityInEntry } from "./answerEvidence";
import { publicUrl } from "./researchLinks";
import { scientificQueryPlan, rankResearchHits, matchesRequiredTopic } from "./researchQuery";

/** Recovery is a reading list, never retroactive support for unlinked claims. */
export function recoverDocumentBibliography(text:string, inventory:CitationIdentity[], blocked:CitationIdentity[]=[], question=""){
  const plan=question?scientificQueryPlan(question):null;
  const relevant=plan?rankResearchHits(inventory,plan.query).filter(item=>matchesRequiredTopic(item.title,plan.requiredTerm)):inventory;
  const monographBooks=/\b(?:monografi|monographs?)\b/i.test(question)?inventory.filter(item=>/farmakope indonesia|farmakope herbal indonesia|handbook of pharmaceutical excipients/i.test(item.title)):[];
  const candidates=[...relevant,...monographBooks].filter(item=>{
    const doi=/^10\.\d{4,9}\/\S+$/i.test(item.doi||"");
    // formatted references come from the metadata pipeline; arbitrary provider
    // pages/grounding titles are not promoted into publications or books.
    return (doi||Boolean(item.formatted&&!/^\[[^\]]+\]\(/.test(item.formatted)))&&
      Boolean(publicUrl(item.uri)||(doi&&publicUrl(`https://doi.org/${item.doi}`)))&&
      !blocked.some(conflict=>identityInEntry(`${item.title} ${item.uri||""} ${item.doi||""}`,conflict));
  });
  const seen=new Set<string>();
  const referenceStart=text.search(/^[\t ]*(?:#{1,6}[\t ]*)?(?:\*{1,2})?(?:References|Daftar Pustaka|Works Cited)\b/im);
  const bibliography=referenceStart>=0?text.slice(referenceStart):"";
  const missing=candidates.filter(item=>{
    const key=(item.doi||item.uri||item.title).toLowerCase();
    if(seen.has(key))return false;seen.add(key);
    return !identityInEntry(bibliography,item);
  }).slice(0,12);
  if(!missing.length)return {text,warnings:[] as string[]};
  const entries=missing.map(item=>{
    const uri=publicUrl(item.uri)||`https://doi.org/${item.doi}`;
    const link=`[Buka publikasi/buku](${uri.replace(/\(/g,"%28").replace(/\)/g,"%29")})`;
    return `${(item.formatted||item.title).replace(/^(?:\[\d+\]|\d+[.)])\s*/,"")} · ${link}${item.readSource?" · Cuplikan sumber dibaca; dukungan klaim belum dipetakan.":" · Metadata ditemukan; teks lengkap/dukungan klaim belum diverifikasi."}`;
  });
  return {text:text.replace(/\n\nTidak ada referensi formal yang cocok dengan sumber hasil penelusuran\.$/,"")+"\n\n## References — bacaan pendukung yang ditemukan\n\nSumber nyata hasil penelusuran berikut belum dihubungkan dengan setiap klaim jawaban. Ini bukan bukti validasi formula dan bukan pemenuhan otomatis kuota jurnal/buku.\n\n"+entries.join("\n\n"),warnings:["Daftar bacaan dipulihkan dari metadata sumber nyata; kecocokan dengan klaim belum diverifikasi."]};
}

export function monographInstruction(question:string){
  if(!/\b(?:monografi|monographs?)\b/i.test(question))return "";
  return "\n\nMONOGRAFI LENGKAP, BUKAN DESKRIPSI SINGKAT: buat bagian terpisah untuk SETIAP bahan yang diminta, termasuk bahan herbal dan kokristal. Ikuti struktur dan urutan monografi sumber yang benar-benar dibaca: judul/identitas, nama lain, rumus/Mr bila ada, definisi/kadar, pemerian, kelarutan, identifikasi, kemurnian/batas cemaran, uji khusus, penetapan kadar, penyimpanan/wadah, serta fungsi dan inkompatibilitas bila sumber memuatnya. Jangan menambahkan parameter yang tidak ada; jangan mencampurkan FI, FHI dan HOPE seolah satu monografi. Cantumkan buku, edisi, tahun dan halaman tercetak/PDF yang terlihat, tanpa menebak. Pertahankan angka, satuan dan syarat sumber dalam parafrasa terstruktur yang setia. Kutipan verbatim panjang hanya untuk teks yang disediakan user atau izin/lisensi reproduksi yang terkonfirmasi; buku berhak cipta tanpa izin: gunakan parafrasa lengkap dan kutipan pendek, bukan copy-paste panjang. Jika sumber hanya cuplikan, labeli monografi parsial dan daftar subbagian yang belum tersedia; jangan menyebutnya monografi lengkap. Jika bahan tidak punya monografi ditemukan, nyatakan belum ditemukan; jangan mengganti spesies, serbuk/ekstrak, kokristal/API atau menebak coformer. Setiap monografi harus punya rujukan identitas sumber yang cocok dalam References. Daftar pustaka tidak boleh kosong jika inventaris publikasi/buku nyata tersedia: gunakan identitas/DOI/URL persis; pisahkan sumber terpakai dari bacaan pendukung metadata yang belum dibaca.";
}

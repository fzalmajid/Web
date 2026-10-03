/** Product policy: file extension is never the publication type. */
export function isFormalPublication(type:unknown){
  return /^(?:book|chapter|journal_article|report|thesis)$/.test(String(type||""));
}

export function documentWritingPolicy(){return "\n\nKEBIJAKAN BAHAN DAN PENULISAN: bahan user berupa catatan TXT, slide/PPT, lembar kerja dan materi belajar biasa boleh dipakai sebagai konteks, tetapi tidak otomatis dijadikan sitasi ilmiah atau daftar pustaka. Sebut asalnya sebagai bahan pengguna bila perlu. Jenis karya ditentukan metadata, bukan ekstensi: PDF/TXT/PPT yang memuat buku atau publikasi tetap memerlukan sitasi karya aslinya, hanya bila identitasnya tersedia; jangan mengubah dosen/PPT menjadi penerbit jurnal. Buku, bab buku dan publikasi yang dipakai harus masuk References. Untuk SETIAP kutipan/parafrasa buku wajib locator HALAMAN CETAK yang terlihat pada sumber (hlm./p./pp.), bukan nomor urutan PDF. HALAMAN PDF hanya untuk navigasi pembaca. Jangan menghitung offset PDF, mengarang halaman, atau memakai nomor halaman artikel sebagai halaman buku. Bila halaman cetak belum ditemukan, nyatakan locator cetak belum tersedia dan jangan mengaku sebagai kutipan buku terlokasi. Pertahankan edisi dan identitas buku. Penulisan mengikuti fungsi: teori, monografi dan pembahasan menggunakan paragraf koheren dengan subjudul; daftar bahan memakai tabel; urutan kerja menggunakan langkah bernomor; bullet hanya untuk rincian sejajar, bukan setiap kalimat. Permintaan PPT tetap ringkas per slide, tanpa menghilangkan paragraf penjelasan yang dibutuhkan. Pisahkan publikasi yang benar-benar disitasi dari daftar bacaan; jangan menambah paper hanya untuk memenuhi kuota atau sekadar memiliki DOI.";}

/** A narrow alias group for the currently failing cross-language monograph,
 * not a replacement of MCC with a different cellulose derivative. */
export function monographAliases(question:string){
  return /\b(?:mcc|microcrystalline cellulose|selulosa mikrokristal(?:in)?)\b/i.test(question)
    ? ["microcrystalline cellulose","selulosa mikrokristal","selulosa mikrokristalin","MCC"] : [];
}

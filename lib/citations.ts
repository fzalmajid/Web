export type CitationStyle = "none" | "apa" | "mla" | "harvard" | "vancouver" | "ieee" | "chicago";
export type CitationOutput = "in-text" | "bibliography";

const styles = new Set<CitationStyle>(["none", "apa", "mla", "harvard", "vancouver", "ieee", "chicago"]);
const outputs = new Set<CitationOutput>(["in-text", "bibliography"]);

export function normalizeCitationOptions(body: any) {
  const rawStyle = String(body?.citationStyle || "none").toLowerCase() as CitationStyle;
  const citationStyle: CitationStyle = styles.has(rawStyle) ? rawStyle : "none";
  const citationOutputs: CitationOutput[] = Array.isArray(body?.citationOutputs)
    ? Array.from(
        new Set(
          body.citationOutputs
            .map((value: unknown) => String(value).toLowerCase())
            .filter((value: string): value is CitationOutput => outputs.has(value as CitationOutput))
        )
      )
    : ["in-text"];

  return {
    citationStyle,
    citationOutputs: citationOutputs.length ? citationOutputs : ["in-text"] as CitationOutput[],
  };
}

export function citationInstruction(
  citationStyle: CitationStyle,
  citationOutputs: CitationOutput[]
) {
  if (citationStyle === "none") return "SITASI: tidak ada format sitasi khusus yang diminta user.";

  const styleRule: Record<Exclude<CitationStyle, "none">, string> = {
    apa:
      "APA 7: gunakan author-date berbentuk (Nama, Tahun), tambahkan halaman untuk kutipan langsung: (Nama, Tahun, p. Halaman). Untuk 3+ penulis gunakan (Nama et al., Tahun). Bedakan karya penulis dan tahun sama dengan a/b. Hanya untuk terjemahan, cetak ulang, terbit ulang, atau terbit kembali gunakan (Nama, TahunAsli/TahunVersi); jangan memakai dua tahun hanya karena edisinya baru.",
    mla:
      "MLA 9: gunakan author-page, bukan author-year. Bentuk umum (Nama Halaman), atau cukup (Halaman) jika nama sudah disebut. Untuk tanpa halaman gunakan penanda lokasi yang tersedia seperti (Nama Bab) atau (Nama Paragraf), jangan mengarang nomor halaman. Works Cited harus memuat penulis, judul, versi/edisi, penerbit, tanggal, container, dan DOI/URL bila metadata tersedia.",
    harvard:
      "Harvard author-date: gunakan bentuk (Nama Tahun) atau (Nama, Tahun) sesuai varian institusi yang dipilih; aplikasi ini memakai (Nama, Tahun). Tambahkan halaman sebagai (Nama, Tahun, p. Halaman) untuk kutipan langsung. Untuk 3+ penulis gunakan (Nama et al., Tahun). Untuk terjemahan/cetak ulang/terbit ulang gunakan TahunAsli/TahunVersi hanya bila dua metadata itu tersedia; Harvard memiliki variasi institusional, jadi jangan mengarang aturan yang tidak didukung pedoman target.",
    vancouver:
      "Vancouver/NLM: beri nomor Arab sesuai urutan pertama kali sumber muncul, berbentuk (1), (2), dan seterusnya; sumber yang sama mengulang nomor yang sama. Daftar referensi mengikuti urutan kemunculan, bukan alfabet. Tambahkan locator seperti p. Halaman hanya bila tersedia. Untuk gaya ICMJE, gunakan hingga enam penulis lalu et al. bila lebih dari enam, tanpa mengarang data.",
    ieee:
      "IEEE: beri nomor sesuai urutan kemunculan dan letakkan di dalam tanda kurung siku pada baris yang sama, misalnya [1] atau [1], [2]; rentang harus ditulis sebagai nomor terpisah, bukan rentang otomatis. Sumber yang sama mengulang nomor yang sama. Daftar referensi mengikuti nomor, memakai inisial nama, mencantumkan hingga enam penulis IEEE lalu et al. bila lebih dari enam, dan mempertahankan DOI/URL yang benar-benar tersedia.",
    chicago:
      "Chicago Author-Date: gunakan (Nama Tahun) dan tambahkan locator sebagai (Nama Tahun, Halaman). Untuk 4+ penulis gunakan (Nama et al. Tahun); daftar referensi disusun alfabetis. Gunakan n.d. bila tanggal memang tidak tersedia, bukan menebak. Untuk terjemahan/cetak ulang/terbit ulang, pertahankan informasi versi yang dibaca dan tahun karya asli hanya bila pedoman serta metadata sumber mendukungnya; jangan otomatis membuat TahunAsli/TahunVersi.",
  };

  const wantsInText = citationOutputs.includes("in-text");
  const wantsBibliography = citationOutputs.includes("bibliography");
  const outputRule =
    wantsInText && wantsBibliography
      ? "Gunakan sitasi dalam teks DAN tambahkan bagian Daftar Pustaka/References di akhir."
      : wantsBibliography
        ? "Jangan sisipkan marker sitasi dalam teks; tambahkan hanya Daftar Pustaka/References di akhir."
        : "Gunakan sitasi dalam teks; jangan tambahkan daftar pustaka terpisah.";

  return [
    "FORMAT SITASI USER:",
    styleRule[citationStyle as Exclude<CitationStyle, "none">],
    outputRule,
    "Jangan mengarang nama penulis, tahun, judul, DOI, URL, atau metadata bibliografi. Gunakan hanya metadata yang benar-benar tersedia dari sumber. Jika penulis/tahun tidak tersedia, gunakan identitas sumber yang tersedia secara jujur dan jangan menebak.",
    "ATURAN TAHUN: jangan menambahkan dua tahun hanya karena sebuah buku memiliki edisi baru. Gunakan pasangan TahunAsli/TahunVersi hanya bila sumber yang dipakai adalah terjemahan, cetak ulang, terbitan ulang, atau terbitan kembali dari karya yang sama, dan hanya jika kedua tahun benar-benar tersedia. Tahun asli ditulis lebih dahulu. Untuk MLA, tahun biasanya berada di Works Cited dan tidak masuk marker author-page. Untuk Vancouver/IEEE, tahun berada di entri bernomor, bukan marker numeriknya. Ikuti gaya yang dipilih, bukan aturan APA secara global.",
    "ATURAN LOKASI: jangan mengarang halaman, bab, paragraf, timestamp, DOI, URL, nomor referensi, atau nama penulis. Gunakan locator hanya jika sumber atau metadata ekstraksi menyediakannya.",
    "Untuk sumber Database pribadi tanpa metadata bibliografi lengkap, gunakan judul dokumen/folder yang tersedia sebagai identitas sumber secara konsisten.",
  ].join("\n");
}


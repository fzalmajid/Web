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

function bibliographyHeading(style: Exclude<CitationStyle, "none">) {
  if (style === "mla") return "Works Cited";
  return "References";
}

/**
 * Citation rules are deliberately explicit so the model does not leak rules
 * from one style into another. Where bibliographic metadata is unavailable,
 * the model must use the style's authorless/undated fallback rather than
 * inventing author, date, publisher, DOI, URL, issue, volume, or page data.
 *
 * Primary guides used when encoding these rules:
 * - APA Style, 7th ed. guidance (APA Style)
 * - MLA Handbook, 9th ed. / MLA Style Center
 * - Leeds Harvard (chosen deterministic Harvard variant)
 * - ICMJE Recommendations + NLM Citing Medicine (Vancouver implementation)
 * - IEEE Reference Guide
 * - Chicago Manual of Style, Author-Date
 */
export function citationInstruction(
  citationStyle: CitationStyle,
  citationOutputs: CitationOutput[]
) {
  if (citationStyle === "none") {
    return [
      "SITASI: user memilih Tanpa sitasi.",
      "Jangan menambahkan marker sitasi atau daftar pustaka formal kecuali user memintanya langsung di pertanyaan.",
    ].join("\n");
  }

  const styleRules: Record<Exclude<CitationStyle, "none">, string[]> = {
    apa: [
      "GAYA: APA 7th edition.",
      "IN-TEXT: gunakan author-date. Satu penulis: (Surname, 2020). Dua penulis parenthetical: (Surname & Surname, 2020); narrative memakai 'and'. Tiga atau lebih: (Surname et al., 2020) sejak sitasi pertama.",
      "LOCATOR: kutipan langsung wajib memakai locator bila tersedia: p. 12 untuk satu halaman, pp. 12–14 untuk rentang. Parafrasa tidak wajib halaman. Jangan membuat nomor halaman yang tidak tersedia.",
      "SAME AUTHOR/YEAR: bedakan 2020a, 2020b, dst. secara konsisten di in-text dan References bila memang ada beberapa karya penulis yang sama pada tahun yang sama.",
      "NO AUTHOR: pindahkan judul ke posisi author pada References; in-text gunakan short title yang cocok dengan entri References. NO DATE: gunakan n.d.",
      "REFERENCES: alfabetis berdasarkan author/authorless-title. Cantumkan semua penulis sampai 20; bila 21+, tulis 19 pertama, ellipsis, lalu penulis terakhir. Gunakan DOI dalam bentuk https://doi.org/... bila DOI benar-benar tersedia. Jangan menambahkan kota penerbit untuk buku.",
      "Hanya masukkan sumber yang benar-benar disitasi ke bagian References.",
    ],
    mla: [
      "GAYA: MLA 9th edition.",
      "IN-TEXT: gunakan author-location, BUKAN author-year. Umumnya (Surname 42); bila nama sudah disebut di kalimat, cukup (42). Jangan sisipkan koma antara nama dan nomor halaman.",
      "UNPAGINATED: bila sumber tidak memiliki page/part locator, jangan mengarang nomor. Jika author sudah disebut dan tidak ada locator, tidak perlu parenthetical citation tambahan. Jika tidak ada author, gunakan short title yang mengarah jelas ke Works Cited.",
      "THREE+ AUTHORS: gunakan surname penulis pertama + et al. sesuai entri Works Cited.",
      "WORKS CITED: susun alfabetis berdasarkan elemen pertama entri. Bangun entri dari core elements yang benar-benar tersedia: author, title of source, title of container, contributors, version, number, publisher, publication date, location/DOI/URL.",
      "Judul bagian akhir harus 'Works Cited'. Hanya masukkan karya yang benar-benar dirujuk.",
    ],
    harvard: [
      "GAYA: Leeds Harvard. Harvard memiliki banyak varian; aplikasi ini WAJIB mengikuti varian University of Leeds agar format deterministik.",
      "IN-TEXT: gunakan (Surname, 2020). Jika author disebut dalam kalimat: Surname (2020). Tiga atau lebih penulis: (Surname et al., 2020).",
      "LOCATOR: untuk kutipan langsung atau bagian spesifik gunakan p. untuk satu halaman dan pp. untuk rentang, misalnya (Surname, 2020, p. 33).",
      "CORPORATE AUTHOR: organisasi diperlakukan sebagai author bila memang merupakan author sumber.",
      "REFERENCE LIST: alfabetis menurut author/corporate author. Jangan memakai ibid.; ulangi citation yang diperlukan.",
      "TRANSLATION/VERSION: cite versi yang benar-benar dibaca. Jangan otomatis membuat pasangan tahun asli/tahun terjemahan.",
      "Jika metadata tidak lengkap, gunakan hanya elemen yang benar-benar tersedia; jangan mengarang author, tahun, publisher, DOI, atau URL.",
    ],
    vancouver: [
      "GAYA: Vancouver yang diimplementasikan sebagai ICMJE citation-sequence + NLM Citing Medicine.",
      "IN-TEXT: nomor Arab dalam tanda kurung sesuai urutan PERTAMA kali sumber disebut: (1), (2), dst. Sumber yang sama selalu memakai nomor yang sama.",
      "REFERENCE ORDER: References harus berurutan berdasarkan kemunculan pertama, BUKAN alfabetis.",
      "JOURNAL REFERENCES: ikuti urutan dan format NLM Citing Medicine; nama jurnal memakai singkatan MEDLINE bila singkatan tersebut benar-benar diketahui dari metadata. Jangan menebak singkatan.",
      "AUTHORS: format NLM adalah surname diikuti initials. Jangan mengarang author. Bila tidak ada person/organization author, mulai entri dengan title, sesuai aturan NLM.",
      "Jangan menambahkan sumber hanya untuk memperbanyak nomor; setiap reference harus mendukung pernyataan yang terkait.",
    ],
    ieee: [
      "GAYA: IEEE Reference Guide.",
      "IN-TEXT: nomor referensi berada pada baris yang sama dalam square brackets dan di dalam punctuation, misalnya [1]. Sumber yang sama mengulang nomor yang sama.",
      "MULTIPLE REFERENCES: tulis masing-masing nomor, misalnya [1], [2], [3], [4]; jangan otomatis memadatkan menjadi [1]–[4].",
      "REFERENCE ORDER: daftar References mengikuti nomor/urutan kemunculan pertama, bukan alfabetis. Satu nomor hanya untuk satu reference.",
      "AUTHORS: initials nama depan/tengah mendahului surname. Daftar semua author sampai enam; bila lebih dari enam, gunakan nama author pertama diikuti et al., sesuai IEEE Reference Guide.",
      "LOCATOR: bila mengutip bagian spesifik dan locator tersedia, bentuk seperti [3, pp. 5–10] dapat digunakan. Jangan mengarang locator.",
    ],
    chicago: [
      "GAYA: Chicago Manual of Style — Author-Date, bukan Notes and Bibliography.",
      "IN-TEXT: gunakan (Surname 2020) tanpa koma antara author dan year. Locator mengikuti koma, misalnya (Surname 2020, 45) atau (Surname 2020, 45–47).",
      "Tiga atau lebih author dalam in-text: gunakan surname author pertama + et al. + year.",
      "REFERENCE LIST: alfabetis; year ditempatkan segera setelah author. Judul bagian akhir: References.",
      "SAME AUTHOR/YEAR: gunakan suffix a, b, dst. secara konsisten bila memang diperlukan.",
      "BOOKS: place of publication tidak diperlukan dalam Chicago edisi terbaru. Jangan menambahkannya hanya karena template lama.",
      "NO DATE: gunakan n.d. hanya bila tanggal memang tidak tersedia. Jangan menebak.",
    ],
  };

  const wantsInText = citationOutputs.includes("in-text");
  const wantsBibliography = citationOutputs.includes("bibliography");
  const style = citationStyle as Exclude<CitationStyle, "none">;
  const heading = bibliographyHeading(style);

  const outputRules: string[] = [];
  if (wantsInText) {
    outputRules.push("OUTPUT IN-TEXT: aktif. Letakkan marker citation tepat setelah klaim/parafrasa/kutipan yang didukung, bukan dikumpulkan sembarang di akhir paragraf bila dukungannya tidak jelas.");
  } else {
    outputRules.push("OUTPUT IN-TEXT: nonaktif. Jangan tampilkan marker citation dalam teks.");
  }

  if (wantsBibliography) {
    outputRules.push(`OUTPUT ${heading.toUpperCase()}: aktif. Tambahkan bagian '${heading}' di akhir dan hanya masukkan sumber yang benar-benar dipakai mendukung jawaban.`);
  } else {
    outputRules.push(`OUTPUT ${heading.toUpperCase()}: nonaktif. Jangan tambahkan daftar referensi terpisah.`);
  }

  return [
    "FORMAT SITASI USER — PATUHI STYLE SECARA TERPISAH:",
    ...styleRules[style],
    ...outputRules,
    "",
    "ATURAN AKURASI METADATA:",
    "- Jangan pernah mengarang author, editor, year, edition, publisher, journal, volume, issue, DOI, URL, page, chapter, paragraph, timestamp, atau nomor reference.",
    "- Gunakan metadata bibliografis hanya jika benar-benar tersedia di konteks/sumber. Nama file bukan bukti author, publisher, atau year.",
    "- Jika metadata style tidak lengkap, gunakan fallback authorless/undated yang sah untuk style tersebut atau hilangkan elemen opsional yang tidak tersedia. Jangan 'melengkapi' dari tebakan.",
    "- Untuk file Database lokal yang hanya memiliki title dan page metadata, identifikasi dengan title yang tersedia dan locator halaman bila relevan; jangan membuat DOI/URL/publisher.",
    "- Nomor halaman PDF dari label HALAMAN PDF boleh dipakai sebagai locator karena berasal dari metadata ekstraksi. Jangan menyamakan nomor halaman PDF dengan page cetak bila sumber menunjukkan keduanya berbeda.",
    "- Satu klaim boleh memakai beberapa citation bila beberapa sumber benar-benar mendukungnya. Jangan mencantumkan sumber yang tidak mendukung klaim hanya untuk memperbanyak referensi.",
    "- Citation dan reference list harus konsisten satu-ke-satu: setiap marker harus dapat dipetakan ke entri/identitas sumber yang sama, dan nomor numeric tidak boleh berubah di tengah jawaban.",
  ].join("\n");
}

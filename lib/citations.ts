export type CitationStyle = "none" | "apa" | "mla" | "harvard" | "vancouver" | "ieee" | "chicago";
export type CitationOutput = "in-text" | "bibliography";

/** Official or institution-published style authorities; never treat these as sources
 * for the subject matter of a user's answer. Harvard is explicitly Leeds Harvard.
 * Chicago is the 18th-edition Author-Date system (2024), not Notes/Bibliography. */
export const CITATION_STYLE_GUIDES: Record<Exclude<CitationStyle, "none">, {
  name: string; url: string; secondaryUrl?: string;
}> = {
  apa: { name: "APA Publication Manual, edisi ke-7", url: "https://www.apa.org/pubs/books/publication-manual-7th-edition-paperback" },
  mla: { name: "MLA Style Center — MLA Handbook, edisi ke-9", url: "https://style.mla.org/in-text-citations-overview/" },
  harvard: { name: "University of Leeds — Leeds Harvard", url: "https://library.leeds.ac.uk/info/1402/referencing/50/leeds_harvard_introduction/3" },
  vancouver: {
    name: "ICMJE Recommendations — citation-sequence",
    url: "https://icmje.org/recommendations/browse/manuscript-preparation/preparing-for-submission.html",
    secondaryUrl: "https://www.ncbi.nlm.nih.gov/books/NBK7256/",
  },
  ieee: { name: "IEEE Reference Guide", url: "https://journals.ieeeauthorcenter.ieee.org/wp-content/uploads/sites/7/IEEE_Reference_Guide.pdf" },
  chicago: { name: "The Chicago Manual of Style, edisi ke-18 — Author-Date", url: "https://www.chicagomanualofstyle.org/tools_citationguide" },
};



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
      "IN-TEXT: gunakan author-date. Satu penulis: (Surname, 2020). Dua penulis parenthetical: (Surname & Surname, 2020); narrative memakai and di teks bahasa Inggris. Tiga atau lebih: (Surname et al., 2020) sejak sitasi pertama, KECUALI penyingkatan menyebabkan dua karya berbeda menjadi ambigu; perluas nama hingga berbeda.",
      "LOCATOR: kutipan langsung wajib memakai locator bila tersedia: p. 12 untuk satu halaman, pp. 12–14 untuk rentang. Parafrasa tidak wajib halaman. Jangan membuat nomor halaman yang tidak tersedia.",
      "SAME AUTHOR/YEAR: bedakan 2020a, 2020b, dst. secara konsisten di in-text dan References bila memang ada beberapa karya penulis yang sama pada tahun yang sama.",
      "NO AUTHOR: pindahkan judul ke posisi author pada References; in-text gunakan short title yang cocok dengan entri References. NO DATE: gunakan n.d.",
      "REFERENCES: alfabetis berdasarkan author/authorless-title. Cantumkan semua penulis sampai 20; bila 21+, tulis 19 pertama, ellipsis, lalu penulis terakhir. Format artikel jurnal: Author, A. A. (Year). Article title. *Journal Title, volume*(issue), pages. https://doi.org/... jika ada. Format buku: Author, A. A. (Year). *Book title* (edition bila bukan pertama). Publisher. Gunakan DOI dalam bentuk https://doi.org/... bila DOI benar-benar tersedia. Jangan menambahkan kota penerbit untuk buku.",
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
      "JOURNAL REFERENCES: ikuti NLM Citing Medicine: Author AA, Author BB. Article title. Abbreviated Journal Title. Year;volume(issue):page–page. DOI bila tersedia. Nama jurnal memakai singkatan MEDLINE hanya jika diverifikasi dari NLM Catalog/PubMed; jangan menebak singkatan.",
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
      "Dalam Chicago edisi 18, in-text menyebut maksimal DUA author; untuk TIGA atau lebih gunakan surname pertama + et al. + year. Jangan memakai aturan edisi 17.",
      "REFERENCE LIST Chicago 18: alfabetis; year segera setelah author. Daftar hingga ENAM author; jika ada TUJUH atau lebih, tulis TIGA pertama, lalu et al. Judul bagian akhir: References.",
      "SAME AUTHOR/YEAR: gunakan suffix a, b, dst. secara konsisten bila memang diperlukan.",
      "BOOKS: place of publication tidak diperlukan dalam Chicago edisi terbaru. Jangan menambahkannya hanya karena template lama.",
      "NO DATE: gunakan n.d. hanya bila tanggal memang tidak tersedia. Jangan menebak.",
    ],
  };

  const wantsInText = citationOutputs.includes("in-text");
  const wantsBibliography = citationOutputs.includes("bibliography");
  const style = citationStyle as Exclude<CitationStyle, "none">;
  const heading = bibliographyHeading(style);
  const guide = CITATION_STYLE_GUIDES[style];

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
    "Pedoman otoritatif untuk gaya ini: " + guide.name + " — " + guide.url + (guide.secondaryUrl ? " ; panduan bibliografi: " + guide.secondaryUrl : "") + ". Panduan ini adalah aturan format, BUKAN sumber isi jawaban.",
    ...styleRules[style],
    ...outputRules,
    "",
    "ATURAN AKURASI METADATA:",
    "- Jangan pernah mengarang author, editor, year, edition, publisher, journal, volume, issue, DOI, URL, page, chapter, paragraph, timestamp, atau nomor reference.",
    "- Gunakan metadata bibliografis hanya jika benar-benar tersedia di konteks/sumber. Nama file bukan bukti author, publisher, atau year.",
    "- Jika metadata style tidak lengkap, gunakan fallback authorless/undated yang sah untuk style tersebut atau hilangkan elemen opsional yang tidak tersedia. Jangan 'melengkapi' dari tebakan. Jika sumber sama sekali tidak dapat diidentifikasi secara unik, katakan data bibliografi belum cukup, jangan menghasilkan entri formal yang menyesatkan.",
    "- Untuk file Database lokal yang hanya memiliki title dan page metadata, identifikasi dengan title yang tersedia dan locator halaman bila relevan; jangan membuat DOI/URL/publisher.",
    "- Nomor halaman PDF dari label HALAMAN PDF boleh dipakai sebagai locator karena berasal dari metadata ekstraksi. Jangan menyamakan nomor halaman PDF dengan page cetak bila sumber menunjukkan keduanya berbeda.",
    "- Satu klaim boleh memakai beberapa citation bila beberapa sumber benar-benar mendukungnya. Jangan mencantumkan sumber yang tidak mendukung klaim hanya untuk memperbanyak referensi.",
    "- Citation dan reference list harus konsisten satu-ke-satu: setiap marker harus dapat dipetakan ke entri/identitas sumber yang sama, dan nomor numeric tidak boleh berubah di tengah jawaban.",
    "- SEBELUM MENJAWAB: buat inventaris sumber yang benar-benar dibaca beserta penulis, tahun, judul, halaman asli bila terbukti, penerbit/jurnal dan DOI/URL bila diverifikasi. Hanya referensi dalam inventaris boleh disitasi. Periksa nama dan tahun di marker terhadap entri akhir; untuk numeric periksa urutan pertama dan reuse angka sumber sama.",
    "- Jangan mengklaim akurasi bibliografi 100% jika metadata dokumen tidak lengkap atau belum diverifikasi ke publikasi asli. Jelaskan keterbatasannya secara singkat jika relevan.",
  ].join("\n");
}

/**
 * Structural-only verification of generated citations. This cannot verify that a
 * publication exists, its metadata is correct, or it supports a given factual claim.
 * Leave content unchanged; surface detected inconsistencies for user review.
 */
export function citationStructuralWarnings(
  answer: string,
  style: CitationStyle,
  selectedOutputs: CitationOutput[]
): string[] {
  if (style === "none" || !selectedOutputs.includes("bibliography")) return [];
  const heading = style === "mla" ? "Works Cited" : "(?:References|Daftar Pustaka)";
  const headingRegex = new RegExp("^(?:#{1,6}\\s*)?" + heading + "\\s*:?\\s*$", "im");
  const match = headingRegex.exec(answer);
  if (!match) {
    return ["Bagian " + (style === "mla" ? "Works Cited" : "References") + " tidak ditemukan; periksa keluaran sitasi."];
  }
  if (style !== "ieee" && style !== "vancouver") return [];
  const head = answer.slice(0, match.index);
  const list = answer.slice(match.index + match[0].length);
  const references = Array.from(list.matchAll(/^\s*(?:\[(\d{1,3})\]|(\d{1,3})[.)])\s+\S/gm))
    .map((entry) => Number(entry[1] || entry[2]));
  if (!references.length) return ["Daftar referensi bernomor tidak terbaca; cocokkan kembali nomor sitasi."];
  const warnings: string[] = [];
  if (references.some((n, i) => n !== i + 1)) {
    warnings.push("Nomor daftar referensi tidak berurutan dari 1.");
  }
  if (!selectedOutputs.includes("in-text")) return warnings;
  const citationRegex = style === "ieee" ? /\[(\d{1,3})\]/g : /\((\d{1,3})\)/g;
  const markers = Array.from(head.matchAll(citationRegex)).map((m) => Number(m[1]));
  if (markers.some((n) => !references.includes(n))) {
    warnings.push("Ada sitasi bernomor tanpa entri di daftar referensi.");
  }
  const order = Array.from(new Set(markers.filter((n) => references.includes(n))));
  if (order.some((n, i) => n !== i + 1)) {
    warnings.push("Urutan kemunculan pertama sitasi tidak sesuai penomoran referensi.");
  }
  if (references.some((n) => !markers.includes(n))) {
    warnings.push("Ada entri daftar referensi yang belum digunakan dalam teks.");
  }
  return warnings;
}

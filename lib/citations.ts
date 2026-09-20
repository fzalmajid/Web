export type CitationStyle = "none" | "apa" | "harvard" | "vancouver" | "ieee" | "chicago";
export type CitationOutput = "in-text" | "bibliography";

const styles = new Set<CitationStyle>(["none", "apa", "harvard", "vancouver", "ieee", "chicago"]);
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
      "APA 7: sitasi dalam teks berbentuk (Nama, Tahun); untuk 3+ penulis gunakan (Nama et al., Tahun).",
    harvard:
      "Harvard author-date: sitasi dalam teks berbentuk (Nama, Tahun); untuk 3+ penulis gunakan (Nama et al., Tahun).",
    vancouver:
      "Vancouver: sitasi dalam teks memakai nomor urut berbentuk (1), (2), dan seterusnya.",
    ieee:
      "IEEE: sitasi dalam teks memakai nomor urut berbentuk [1], [2], dan seterusnya.",
    chicago:
      "Chicago Author-Date: sitasi dalam teks berbentuk (Nama Tahun); untuk 4+ penulis boleh gunakan et al.",
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
    "Untuk sumber Database pribadi tanpa metadata bibliografi lengkap, gunakan judul dokumen/folder yang tersedia sebagai identitas sumber secara konsisten.",
  ].join("\n");
}

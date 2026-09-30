export type ReferenceDocumentType =
  | "book"
  | "report"
  | "journal_article"
  | "lecture_slides"
  | "webpage"
  | "thesis"
  | "chapter"
  | "other";

export type MetadataProvenance = {
  source: "manual" | "document" | "mendeley" | "crossref" | "filename" | "official";
  confidence: number;
  note?: string;
};

export type ReferenceMetadata = {
  title?: string | null;
  authors?: string[];
  corporate_author?: string | null;
  year?: number | null;
  publisher?: string | null;
  institution?: string | null;
  type?: ReferenceDocumentType | null;
  edition?: string | null;
  container_title?: string | null;
  volume?: string | null;
  issue?: string | null;
  pages?: string | null;
  doi?: string | null;
  isbn?: string | null;
  url?: string | null;
  mendeley_id?: string | null;
  provenance?: Record<string, MetadataProvenance>;
};

function cleanSpaces(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizedTitle(value: string) {
  return cleanSpaces(
    String(value || "")
      .replace(/\.(?:pdf|pptx?|docx?|txt|md)$/i, "")
      .replace(/\.pptx$/i, "")
      .replace(/^\s*\d+[.)_-]?\s*/, "")
      .replace(/[_]+/g, " ")
      .replace(/\s+/g, " ")
  );
}

function titleTokens(value: string) {
  return new Set(
    normalizedTitle(value)
      .toLowerCase()
      .replace(/[^a-z0-9À-ÿ]+/gi, " ")
      .split(/\s+/)
      .filter((part) => part.length > 2)
  );
}

export function titleSimilarity(a: string, b: string) {
  const aa = titleTokens(a);
  const bb = titleTokens(b);
  if (!aa.size || !bb.size) return 0;
  let overlap = 0;
  for (const token of aa) if (bb.has(token)) overlap++;
  return overlap / Math.max(aa.size, bb.size);
}

function setCandidate(
  target: ReferenceMetadata,
  field: keyof ReferenceMetadata,
  value: any,
  source: MetadataProvenance["source"],
  confidence: number,
  note?: string
) {
  if (value === undefined || value === null || value === "" ||
      (Array.isArray(value) && !value.length)) return;
  const existing = target.provenance?.[String(field)];
  if (existing && existing.confidence > confidence) return;
  (target as any)[field] = value;
  target.provenance = {
    ...(target.provenance || {}),
    [String(field)]: { source, confidence, ...(note ? { note } : {}) },
  };
}

function extractSlideAuthor(front: string) {
  const compact = cleanSpaces(front);
  const slide2 = /(?:Slide\s*2\s*:|\[Halaman\s*2\])\s*([^@]{3,180}?)(?=\s+(?:\d{8,}|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+|Whatsapp\b|Slide\s*3\s*:|\[Halaman\s*3\]))/i.exec(compact);
  const candidate = cleanSpaces(slide2?.[1] || "");
  if (!candidate) return "";
  if (!/[A-Za-zÀ-ÿ]{2,}\s+[A-Za-zÀ-ÿ]{2,}/.test(candidate)) return "";
  if (!/(S\.?\s*Farm|M\.?\s*(?:Biomed|Farm|Si)|Apt\.?|Dr\.?|Ph\.?D|Sp\.?)/i.test(candidate)) return "";
  return candidate.replace(/\s+,/g, ",").replace(/\s+\./g, ".").trim();
}

function extractTitleFromFront(front: string, fileName: string) {
  const compact = cleanSpaces(front);
  const slide = /Slide\s*1\s*:\s*(.+?)(?=\s+Slide\s*2\s*:)/i.exec(compact)?.[1];
  if (slide) {
    return cleanSpaces(slide)
      .replace(/\s+Sesi\s+\d+.*$/i, "")
      .replace(/\s+PSF\s+\d+.*$/i, "")
      .trim();
  }
  const page1 = /\[Halaman\s*1\]\s*(.+?)(?=\s+\[Halaman\s*2\])/i.exec(compact)?.[1];
  if (page1) {
    const upperTitle = /(?:BADAN\s+POM\s+RI\s+)?(.+?)(?:\s+BADAN\s+PENGAWAS\s+OBAT\s+DAN\s+MAKANAN\s+REPUBLIK\s+INDONESIA|\s+20\d{2})/i.exec(page1)?.[1];
    if (upperTitle && upperTitle.length >= 8) return cleanSpaces(upperTitle);
  }
  return normalizedTitle(fileName);
}

export function inferReferenceMetadata(input: {
  fileName: string;
  mimeType?: string | null;
  sourceUrl?: string | null;
  frontMatter?: string | null;
}): ReferenceMetadata {
  const front = String(input.frontMatter || "");
  const first800 = cleanSpaces(front).slice(0, 800);
  const meta: ReferenceMetadata = { provenance: {} };
  const lowerName = input.fileName.toLowerCase();

  const title = extractTitleFromFront(front, input.fileName);
  setCandidate(meta, "title", title, front ? "document" : "filename", front ? 0.9 : 0.55,
    front ? "Judul dibaca dari bagian awal dokumen." : "Fallback dari nama file.");

  const isSlides = /\.pptx?(?:\.pdf)?$/i.test(input.fileName) ||
    /Slide\s*1\s*:/i.test(front) ||
    /\bPSF\s*\d+\b/i.test(first800);
  if (isSlides) {
    setCandidate(meta, "type", "lecture_slides", "document", 0.98, "Struktur slide/presentasi terdeteksi.");
    const presenter = extractSlideAuthor(front);
    if (presenter) setCandidate(meta, "authors", [presenter], "document", 0.94, "Nama presenter/dosen ditemukan pada slide awal.");
    if (/Universitas\s+Esa\s+Unggul/i.test(first800)) {
      setCandidate(meta, "institution", "Universitas Esa Unggul", "document", 0.98, "Nama institusi terlihat pada slide awal.");
    }
  }

  const bpom = /BADAN\s+(?:POM|PENGAWAS\s+OBAT\s+DAN\s+MAKANAN)(?:\s+REPUBLIK\s+INDONESIA)?/i.test(first800);
  if (bpom) {
    setCandidate(meta, "corporate_author", "Badan Pengawas Obat dan Makanan Republik Indonesia", "document", 0.99,
      "Corporate author tercetak pada halaman awal.");
    setCandidate(meta, "publisher", "Badan Pengawas Obat dan Makanan Republik Indonesia", "document", 0.95,
      "Lembaga penerbit tercetak pada dokumen.");
    setCandidate(meta, "institution", "Badan Pengawas Obat dan Makanan Republik Indonesia", "document", 0.99);
  }

  const earlyYear = /\b(19\d{2}|20\d{2})\b/.exec(first800)?.[1];
  if (earlyYear) {
    setCandidate(meta, "year", Number(earlyYear), "document", 0.96, "Tahun ditemukan pada halaman awal.");
  }

  const doi = /\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/i.exec(front)?.[0]?.replace(/[.,;)]$/,"");
  if (doi) setCandidate(meta, "doi", doi, "document", 0.99, "DOI eksplisit ditemukan di dokumen.");

  const isbn = /\b(?:ISBN(?:-1[03])?\s*:?\s*)?((?:97[89][-\s]?)?[0-9][-0-9\s]{8,16}[0-9X])\b/i.exec(first800)?.[1];
  if (isbn && /ISBN/i.test(first800)) setCandidate(meta, "isbn", cleanSpaces(isbn), "document", 0.96);

  if (!meta.type) {
    if (bpom && /pedoman|guideline|panduan/i.test((meta.title || "") + " " + lowerName)) {
      setCandidate(meta, "type", "report", "document", 0.94);
    } else if (/journal|jurnal|doi/i.test(front.slice(0, 3000))) {
      setCandidate(meta, "type", "journal_article", "document", 0.72);
    } else if (input.sourceUrl) {
      setCandidate(meta, "type", "webpage", "document", 0.9);
      setCandidate(meta, "url", input.sourceUrl, "document", 1);
    } else if (/\.pdf$/i.test(input.fileName)) {
      setCandidate(meta, "type", "other", "filename", 0.5);
    }
  }

  return meta;
}

export function mergeReferenceMetadata(
  base: ReferenceMetadata,
  incoming: ReferenceMetadata,
  incomingSource: MetadataProvenance["source"],
  minimumConfidence = 0
): ReferenceMetadata {
  const result: ReferenceMetadata = {
    ...base,
    provenance: { ...(base.provenance || {}) },
  };
  for (const field of [
    "title","authors","corporate_author","year","publisher","institution","type","edition",
    "container_title","volume","issue","pages","doi","isbn","url","mendeley_id"
  ] as Array<keyof ReferenceMetadata>) {
    const value = incoming[field];
    if (value === undefined || value === null || value === "" ||
        (Array.isArray(value) && !value.length)) continue;
    const provenance = incoming.provenance?.[String(field)] || {
      source: incomingSource,
      confidence: incomingSource === "manual" ? 1 : 0.8,
    };
    if (provenance.confidence < minimumConfidence) continue;
    setCandidate(result, field, value, provenance.source || incomingSource, provenance.confidence, provenance.note);
  }
  return result;
}

export function referenceMetadataSummary(metadata: ReferenceMetadata) {
  const author = metadata.authors?.length
    ? metadata.authors.join("; ")
    : metadata.corporate_author || "";
  return [
    author,
    metadata.year ? String(metadata.year) : "",
    metadata.title || "",
    metadata.institution || "",
    metadata.publisher || "",
  ].filter(Boolean).join(" · ");
}

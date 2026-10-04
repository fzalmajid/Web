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
  source: "manual" | "document" | "mendeley" | "crossref" | "datacite" | "openalex" | "openlibrary" | "europepmc" | "pubmed" | "filename" | "official";
  confidence: number;
  note?: string;
};

export const REFERENCE_ENGINE_VERSION = "public-library-v1";
export type ReferenceAudit = {
  engineVersion: string;
  checkedAt: string;
  status: "auto" | "verified" | "manual" | "conflict";
  basis: "catalog" | "document" | "manual" | "incomplete";
  matches: Array<{ source: string; similarity: number; method: string }>;
  issues: string[];
  missing: string[];
  history: Array<{ checkedAt: string; status: string; basis: string }>;
};

export type ReferenceMetadata = {
  title?: string | null;
  authors?: string[];
  author_details?: Array<{ family?: string; given?: string; literal?: string; suffix?: string }>;
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
  datacite_id?: string | null;
  openalex_id?: string | null;
  openlibrary_id?: string | null;
  pmid?: string | null;
  pmcid?: string | null;
  provenance?: Record<string, MetadataProvenance>;
  audit?: ReferenceAudit;
};

export function normalizeDoi(value: unknown) {
  let doi = String(value || "").trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "").replace(/[.,;]+$/, "").toLowerCase();
  while (doi.endsWith(")") && (doi.match(/\)/g) || []).length > (doi.match(/\(/g) || []).length) doi = doi.slice(0, -1);
  return /^10\.\d{4,9}\/\S+$/i.test(doi) ? doi : "";
}

export function normalizeIsbn(value: unknown) {
  const isbn = String(value || "").replace(/[^0-9X]/gi, "").toUpperCase();
  if (/^\d{13}$/.test(isbn)) {
    const sum = [...isbn].reduce((n, digit, index) => n + Number(digit) * (index % 2 ? 3 : 1), 0);
    return sum % 10 === 0 ? isbn : "";
  }
  if (/^\d{9}[\dX]$/.test(isbn)) {
    const sum = [...isbn].reduce((n, digit, index) => n + (digit === "X" ? 10 : Number(digit)) * (10 - index), 0);
    return sum % 11 === 0 ? isbn : "";
  }
  return "";
}

export function normalizePmid(value: unknown) {
  const pmid = String(value || "").trim();
  return /^\d{1,9}$/.test(pmid) ? pmid : "";
}

export function isbnIdentity(value: unknown) {
  const isbn = normalizeIsbn(value);
  if (isbn.length !== 10) return isbn;
  const prefix = "978" + isbn.slice(0, 9);
  const sum = [...prefix].reduce((n, digit, index) => n + Number(digit) * (index % 2 ? 3 : 1), 0);
  return prefix + ((10 - sum % 10) % 10);
}

/** Do not trust legacy status labels: prior versions verified filename guesses. */
export function citationMetadataReady(metadata: ReferenceMetadata) {
  return Boolean(metadata.title && metadata.audit?.engineVersion === REFERENCE_ENGINE_VERSION &&
    ["verified", "manual"].includes(metadata.audit.status));
}

/** Exact identifiers must agree; fuzzy title matches require independent evidence. */
export function referenceIdentity(input: ReferenceMetadata, candidate: ReferenceMetadata) {
  for (const [field, normalize] of [
    ["doi", normalizeDoi], ["pmid", normalizePmid], ["isbn", isbnIdentity],
  ] as const) {
    const a = normalize(input[field]), b = normalize(candidate[field]);
    if (a && b && a !== b) return { accepted: false, method: field, issue: "conflicting_" + field };
  }
  const titleScore = titleSimilarity(input.title || "", candidate.title || "");
  for (const [field, normalize] of [
    ["doi", normalizeDoi], ["pmid", normalizePmid], ["isbn", isbnIdentity],
  ] as const) {
    const a = normalize(input[field]), b = normalize(candidate[field]);
    // Filename guesses may be replaced by exact identifier matches; an explicit
    // document title is an additional guard against an identifier cited inside it.
    if (a && a === b) {
      if (input.provenance?.title?.source === "document" && input.provenance.title.confidence >= 0.9 && titleScore < 0.6) {
        return { accepted: false, method: field, issue: "identifier_title_conflict" };
      }
      return { accepted: true, method: field, issue: "" };
    }
  }
  if (input.doi || input.pmid || input.isbn) return { accepted: false, method: "title", issue: "identifier_not_confirmed" };
  if (titleScore < 0.92) return { accepted: false, method: "title", issue: "weak_title_match" };
  if (input.year && candidate.year && input.year !== candidate.year && (input.provenance?.year?.confidence || 0) >= 0.9) {
    return { accepted: false, method: "title", issue: "conflicting_year" };
  }
  if (input.edition && String(input.edition) !== String(candidate.edition || "")) {
    return { accepted: false, method: "title", issue: "edition_not_confirmed" };
  }
  const authorAgreement = (input.authors || []).some((author) =>
    (candidate.authors || []).some((other) => titleSimilarity(author, other) >= 0.5));
  const yearAgreement = Boolean(input.year && input.year === candidate.year && (input.provenance?.year?.confidence || 0) >= 0.9);
  // Books need edition-level evidence, not a work-level title shared by many editions.
  const specificTitle = candidate.type !== "book" && titleScore === 1 && titleTokens(input.title || "").size >= 6;
  return authorAgreement || yearAgreement || specificTitle
    ? { accepted: true, method: "title+evidence", issue: "" }
    : { accepted: false, method: "title", issue: "ambiguous_title_only" };
}

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
  const heading = front.split(/\n/).map(cleanSpaces).find((line) =>
    line.length >= 12 && line.length <= 250 && line.split(/\s+/).length >= 3 &&
    !/^(?:\[Halaman|Slide\s*\d|https?:|doi\b|isbn\b|pmid\b|abstract\b|abstrak\b|copyright\b|©|journal\b|jurnal\b|volume\b)/i.test(line));
  return heading || normalizedTitle(fileName);
}

export function inferReferenceMetadata(input: {
  fileName: string;
  mimeType?: string | null;
  sourceUrl?: string | null;
  frontMatter?: string | null;
}): ReferenceMetadata {
  // Identifiers in a references section belong to cited works, not this file.
  // These exact standalone labels are emitted by our reader, not by the book.
  // Keep page labels in indexed evidence; remove them only from identity parsing.
  const identityText = String(input.frontMatter || "").replace(
    /^\s*\[(?:Halaman\s+\d+|Teks digital|Teks dari gambar\/OCR|tidak ada teks terbaca)\]\s*$/gim, ""
  );
  const front = identityText.split(/\n\s*(?:References|Bibliography|Daftar Pustaka)\s*\n/i)[0].slice(0, 12000);
  const first800 = cleanSpaces(front).slice(0, 800);
  const meta: ReferenceMetadata = { provenance: {} };
  const lowerName = input.fileName.toLowerCase();

  const title = extractTitleFromFront(front, input.fileName);
  const titleFromDocument = title !== normalizedTitle(input.fileName);
  const structuredTitle = /Slide\s*1\s*:|BADAN\s+(?:POM|PENGAWAS)/i.test(front.slice(0, 800));
  setCandidate(meta, "title", title, titleFromDocument ? "document" : "filename", titleFromDocument ? (structuredTitle ? 0.9 : 0.8) : 0.55,
    titleFromDocument ? "Judul dibaca dari bagian awal dokumen." : "Fallback dari nama file; belum terverifikasi.");
  const lines = front.split(/\n/).map(cleanSpaces).filter(Boolean);
  const explicitTitle = lines.find((line) => /^(?:title|judul)\s*:/i.test(line))?.replace(/^(?:title|judul)\s*:\s*/i, "");
  if (explicitTitle) setCandidate(meta, "title", explicitTitle, "document", 0.97, "Label judul eksplisit pada dokumen.");
  const explicitAuthors = lines.find((line) => /^(?:authors?|penulis|by)\s*:/i.test(line))?.replace(/^(?:authors?|penulis|by)\s*:\s*/i, "");
  if (explicitAuthors) setCandidate(meta, "authors", explicitAuthors.split(/;|\s+and\s+/).map(cleanSpaces).filter(Boolean), "document", 0.97);

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
  // A cited/mentioned institution inside lecture slides is not the slide author.
  // Only attribute BPOM when the document itself is not already identified as lecture material.
  if (bpom && !isSlides) {
    setCandidate(meta, "corporate_author", "Badan Pengawas Obat dan Makanan Republik Indonesia", "document", 0.99,
      "Corporate author tercetak pada halaman awal.");
    setCandidate(meta, "publisher", "Badan Pengawas Obat dan Makanan Republik Indonesia", "document", 0.95,
      "Lembaga penerbit tercetak pada dokumen.");
    setCandidate(meta, "institution", "Badan Pengawas Obat dan Makanan Republik Indonesia", "document", 0.99);
  }

  const earlyYear = /\b(19\d{2}|20\d{2})\b/.exec(first800)?.[1];
  if (earlyYear) {
    setCandidate(meta, "year", Number(earlyYear), "document", 0.65, "Tahun kandidat pada halaman awal; belum tentu tahun publikasi.");
  }
  const publicationYear = /(?:copyright|©|published|publication year|tahun terbit|terbit|year)\s*:?\s*(19\d{2}|20\d{2})/i.exec(front)?.[1];
  if (publicationYear) setCandidate(meta, "year", Number(publicationYear), "document", 0.97, "Tahun publikasi berlabel eksplisit.");

  const doi = normalizeDoi(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i.exec(front.slice(0, 5000))?.[0]);
  if (doi) setCandidate(meta, "doi", doi, "document", 0.99, "DOI eksplisit ditemukan di dokumen.");

  const isbn = normalizeIsbn(/\bISBN(?:-1[03])?\s*:?\s*([0-9X][-0-9X ]{8,20})/i.exec(front)?.[1]);
  if (isbn) setCandidate(meta, "isbn", isbn, "document", 0.96);
  const pmid = normalizePmid(/\bPMID\s*:?\s*(\d{1,9})\b/i.exec(front.slice(0, 5000))?.[1] ||
    /pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/i.exec(input.sourceUrl || "")?.[1]);
  if (pmid) setCandidate(meta, "pmid", pmid, "document", 0.99, "PMID explicite.");
  const edition = /\b(?:edition|edisi)\s*:?\s*(\d{1,2}|VIII|VII|VI|IV|III|II|IX|V|X|I)\b/i.exec(front)?.[1] || /\b(\d{1,2})(?:st|nd|rd|th)\s+edition\b/i.exec(front)?.[1];
  if (edition) setCandidate(meta, "edition", edition, "document", 0.97);

  // Official pharmacopeia title pages have a distinctive identity sequence.
  // Require actual cover text, never filename/slide guesses. ISBN is optional:
  // some official editions do not print it in the available title pages.
  // An explicitly present invalid ISBN remains conflicting evidence.
  // OCR may split a printed cover year ("20 20"); only normalize this sequence.
  const cover=first800.replace(/^\s*\[Halaman\s*1\]\s*/i,"");
  const officialCover=/^(Farmakope\s+(?:Herbal\s+)?Indonesia)\s+Edisi\s+(VIII|VII|VI|IV|III|II|IX|V|X|I|\d{1,2})\s+((?:19|20)(?:\s+\d{2}|\d{2}))\s+(Kementerian\s+Kesehatan\s+(?:Republik\s+Indonesia|RI))\b/i.exec(cover);
  const hasIsbnLabel = /\bISBN(?:-1[03])?\s*:?/i.test(front);
  if(officialCover&&(!hasIsbnLabel||isbn)&&!isSlides){
    const coverTitle=officialCover[1].toLowerCase().replace(/\b[a-z]/g,letter=>letter.toUpperCase());
    const coverAuthor=officialCover[4].toLowerCase().replace(/\b[a-z]/g,letter=>letter.toUpperCase()).replace(/\bRi\b/,"RI");
    setCandidate(meta,"title",coverTitle,"document",.98,"Judul terpisah dari edisi, tahun dan lembaga yang tercetak pada halaman judul.");
    setCandidate(meta,"corporate_author",coverAuthor,"document",.98,"Lembaga tercetak dalam identitas halaman judul farmakope, bukan disebut di isi/daftar pustaka.");
    setCandidate(meta,"institution",coverAuthor,"document",.98);
    setCandidate(meta,"year",Number(officialCover[3].replace(/\s/g,"")),"document",.97,"Tahun tercetak dalam identitas edisi pada halaman judul.");
    setCandidate(meta,"edition",officialCover[2].toUpperCase(),"document",.98);
    setCandidate(meta,"type","book","document",.98);
  }

  if (!meta.type) {
    if (isbn) {
      setCandidate(meta, "type", "book", "document", 0.94);
    } else if (bpom && /pedoman|guideline|panduan/i.test((meta.title || "") + " " + lowerName)) {
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
    "title","authors","author_details","corporate_author","year","publisher","institution","type","edition",
    "container_title","volume","issue","pages","doi","isbn","url","mendeley_id","datacite_id","openalex_id","openlibrary_id","pmid","pmcid"
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

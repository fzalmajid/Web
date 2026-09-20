export type PdfIndexedPage = {
  page: number;
  text: string;
};

export type PdfIndexBatch = {
  totalPages: number;
  startPage: number;
  endPage: number;
  pages: PdfIndexedPage[];
  timedOut: boolean;
};

function normalizePageText(items: any[]) {
  const lines: string[] = [];
  let current = "";

  for (const item of items || []) {
    const text = String(item?.str || "");
    if (!text) continue;
    current += text;
    if (item?.hasEOL) {
      lines.push(current.trimEnd());
      current = "";
    } else if (!/\s$/.test(current)) {
      current += " ";
    }
  }
  if (current.trim()) lines.push(current.trim());
  return lines.join("\n").replace(/[ \t]+\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
}

export async function extractPdfPageBatch(
  buffer: Buffer,
  startPage: number,
  options?: { maxPages?: number; maxMs?: number }
): Promise<PdfIndexBatch> {
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const loadingTask = pdfjs.getDocument({
    data,
    useSystemFonts: true,
    isEvalSupported: false,
    stopAtErrors: false,
    useWorkerFetch: false,
  });
  const doc = await loadingTask.promise;

  const totalPages = Number(doc.numPages || 0);
  const firstPage = Math.max(1, Math.min(Number(startPage || 1), Math.max(1, totalPages)));
  const maxPages = Math.max(1, Math.min(Number(options?.maxPages || 72), 160));
  const maxMs = Math.max(5000, Math.min(Number(options?.maxMs || 36000), 45000));
  const startedAt = Date.now();

  const pages: PdfIndexedPage[] = [];
  let pageNumber = firstPage;

  try {
    for (; pageNumber <= totalPages && pages.length < maxPages; pageNumber++) {
      if (pages.length > 0 && Date.now() - startedAt >= maxMs) break;

      const page = await doc.getPage(pageNumber);
      try {
        const textContent = await page.getTextContent({
          includeMarkedContent: false,
          disableNormalization: false,
        });
        const text = normalizePageText(Array.isArray(textContent?.items) ? textContent.items : []);
        pages.push({ page: pageNumber, text });
      } finally {
        try { page.cleanup(); } catch {}
      }
    }
  } finally {
    try { await doc.destroy(); } catch {}
  }

  const endPage = pages.length ? pages[pages.length - 1].page : firstPage - 1;
  return {
    totalPages,
    startPage: firstPage,
    endPage,
    pages,
    timedOut: endPage < totalPages && (Date.now() - startedAt >= maxMs || pages.length >= maxPages),
  };
}

export type PackedPdfChunk = {
  chunkIndex: number;
  pageStart: number;
  pageEnd: number;
  text: string;
};

export function packPdfPages(
  pages: PdfIndexedPage[],
  maxChars = 12000
): PackedPdfChunk[] {
  const chunks: PackedPdfChunk[] = [];
  const limit = Math.max(4000, Math.min(maxChars, 24000));

  let current = "";
  let pageStart = 0;
  let pageEnd = 0;
  let chunkIndex = 0;

  const flush = () => {
    const text = current.trim();
    if (!text) {
      current = "";
      pageStart = 0;
      pageEnd = 0;
      return;
    }
    const stableIndex = pageStart * 1000 + chunkIndex;
    chunks.push({
      chunkIndex: stableIndex,
      pageStart,
      pageEnd,
      text,
    });
    chunkIndex++;
    current = "";
    pageStart = 0;
    pageEnd = 0;
  };

  for (const page of pages) {
    let text = String(page.text || "").trim();
    if (!text) continue;

    if (text.length > limit) {
      flush();
      let offset = 0;
      let part = 0;
      while (offset < text.length) {
        let end = Math.min(text.length, offset + limit);
        if (end < text.length) {
          const para = text.lastIndexOf("\n\n", end);
          const line = text.lastIndexOf("\n", end);
          const sentence = Math.max(
            text.lastIndexOf(". ", end),
            text.lastIndexOf("? ", end),
            text.lastIndexOf("! ", end)
          );
          const best = Math.max(para, line, sentence);
          if (best > offset + Math.floor(limit * 0.55)) end = best + 1;
        }
        const piece = text.slice(offset, end).trim();
        if (piece) {
          chunks.push({
            chunkIndex: page.page * 1000 + part,
            pageStart: page.page,
            pageEnd: page.page,
            text: piece,
          });
          part++;
        }
        offset = Math.max(end, offset + 1);
      }
      continue;
    }

    const labelled = `[Halaman ${page.page}]\n${text}`;
    if (current && current.length + labelled.length + 2 > limit) flush();
    if (!pageStart) pageStart = page.page;
    pageEnd = page.page;
    current += (current ? "\n\n" : "") + labelled;
  }

  flush();
  return chunks;
}

/** Crawl4AI supports both legacy string Markdown and MarkdownGenerationResult. */
export function crawl4aiContent(data: any, cleanHtml: (html: string) => string): string | null {
  if (!data || data.success === false) return null;
  const first = Array.isArray(data.results) ? data.results[0] : Array.isArray(data) ? data[0] : data;
  if (!first || first.success === false) return null;
  const status = Number(first.redirected_status_code ?? first.status_code ?? 200);
  if (!Number.isFinite(status) || status < 200 || status >= 300) return null;
  const markdown = first.markdown;
  const candidates = typeof markdown === "string" ? [markdown]
    : [markdown?.raw_markdown, markdown?.fit_markdown, markdown?.markdown_with_citations];
  for (const candidate of [...candidates, first.text]) {
    if (typeof candidate !== "string" || !candidate.trim()) continue;
    return candidate.replace(/\r\n/g, "\n").trim().slice(0, 12000);
  }
  for (const html of [first.cleaned_html, first.html]) {
    if (typeof html !== "string" || !html.trim()) continue;
    const text = cleanHtml(html);
    if (text) return text.slice(0, 12000);
  }
  return null;
}

export async function readResearchJson(response: Response, maxBytes = 2_000_000): Promise<any> {
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("Respons riset terlalu besar.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Respons riset kosong.");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) throw new Error("Respons riset terlalu besar.");
      chunks.push(next.value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  const joined = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(joined));
}

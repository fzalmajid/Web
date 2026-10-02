export type AnswerProseBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "heading"; text: string; level: number; anchor: string; id?: string }
  | { kind: "list"; ordered: boolean; start: number; items: string[] }
  | { kind: "code"; text: string }
  | { kind: "rule" };

export function answerHeadingSlug(text: string) {
  return text.normalize("NFKC").toLowerCase().replace(/[*_`]/g, "").replace(/[^\p{L}\p{N}\s-]/gu, "").trim().replace(/\s+/g, "-").replace(/-+/g, "-") || "bagian";
}

/** Small presentation-only parser. No raw HTML, remote assets or executable markup. */
export function answerProse(text: string): AnswerProseBlock[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n"), result: AnswerProseBlock[] = [];
  let paragraph: string[] = [], mathFence = "";
  const flush = () => { if (paragraph.length) result.push({ kind: "paragraph", text: paragraph.join("\n") }); paragraph = []; };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], trimmed = line.trim();
    // Keep display math together for the existing KaTeX renderer.
    if (mathFence) { paragraph.push(line); if (trimmed.endsWith(mathFence)) mathFence = ""; continue; }
    if (trimmed.startsWith("$$") || trimmed.startsWith("\\[")) {
      const end = trimmed.startsWith("$$") ? "$$" : "\\]";
      paragraph.push(line);
      if (trimmed.length <= 2 || !trimmed.slice(2).endsWith(end)) mathFence = end;
      continue;
    }
    const fence = /^\s*(`{3,}|~{3,})[^`~]*$/.exec(line);
    if (fence) {
      flush(); const code: string[] = [], close = new RegExp("^\\s*" + fence[1][0] + "{" + fence[1].length + ",}\\s*$");
      while (++i < lines.length && !close.test(lines[i])) code.push(lines[i]);
      result.push({ kind: "code", text: code.join("\n") }); continue;
    }
    if (!trimmed) { flush(); continue; }
    // Some providers emit the contents as consecutive italic/bold numbered
    // lines instead of a Markdown list. Recognize only a multi-item opening.
    const openingItem = (value: string) => /^\s*([_*]{1,2})(\d+)[.)]\s+([^*_\n]{1,160})\1\s*$/.exec(value);
    if (!result.length && !paragraph.length && openingItem(line)) {
      const items: string[] = []; let end = i;
      while (end < lines.length) { const item = openingItem(lines[end]); if (!item) break; items.push(item[3]); end++; }
      if (items.length >= 2) { result.push({ kind: "list", ordered: true, start: Number(openingItem(line)![2]), items }); i = end - 1; continue; }
    }
    const heading = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) { flush(); result.push({ kind: "heading", text: heading[2], level: Math.max(2, heading[1].length), anchor: answerHeadingSlug(heading[2]) }); continue; }
    const boldHeading = /^\s{0,3}(\*{1,2})([^*\n]{1,120})\1\s*:?\s*$/.exec(line);
    if (boldHeading) { flush(); result.push({ kind: "heading", text: boldHeading[2], level: 3, anchor: answerHeadingSlug(boldHeading[2]) }); continue; }
    if (/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flush(); result.push({ kind: "rule" }); continue; }
    const list = /^\s*([-+*]|\d+[.)])\s+(.+)$/.exec(line);
    if (list) {
      flush(); const ordered = /^\d/.test(list[1]), items = [list[2]], start = ordered ? Number.parseInt(list[1], 10) : 1;
      while (i + 1 < lines.length) {
        const next = /^\s*([-+*]|\d+[.)])\s+(.+)$/.exec(lines[i + 1]);
        if (!next || /^\d/.test(next[1]) !== ordered) break;
        items.push(next[2]); i++;
      }
      result.push({ kind: "list", ordered, start, items }); continue;
    }
    paragraph.push(line);
  }
  flush(); return result;
}

export function scopeAnswerHeadings(groups: AnswerProseBlock[][], scope: string) {
  const anchors = new Map<string, string>(), counts = new Map<string, number>();
  for (const blocks of groups) for (const block of blocks) if (block.kind === "heading") {
    const count = (counts.get(block.anchor) || 0) + 1; counts.set(block.anchor, count);
    block.id = scope + "-" + block.anchor + (count > 1 ? "-" + count : "");
    if (!anchors.has(block.anchor)) anchors.set(block.anchor, block.id);
  }
  return anchors;
}

export function safeAnswerLink(raw: string, anchors: Map<string, string>) {
  if (raw.startsWith("#")) {
    try { const id = anchors.get(answerHeadingSlug(decodeURIComponent(raw.slice(1)))); return id ? "#" + id : null; } catch { return null; }
  }
  if (!/^https?:\/\//i.test(raw) || /[\u0000-\u0020\u007f]/.test(raw)) return null;
  try { const url = new URL(raw); return url.username || url.password ? null : url.href; } catch { return null; }
}

export function answerHeadingTarget(label: string, anchors: Map<string, string>) {
  const slug = answerHeadingSlug(label.replace(/^\s*\d+[.)]\s+/, ""));
  const exact = anchors.get(slug); if (exact) return exact;
  const unnumbered = Array.from(anchors).filter(([key]) => key.replace(/^\d+-/, "") === slug);
  if (unnumbered.length === 1) return unnumbered[0][1];
  // Permit a shortened contents label only when it identifies one heading.
  const candidates = slug.includes("-") ? Array.from(anchors).filter(([key]) => key.replace(/^\d+-/, "").startsWith(slug + "-")) : [];
  return candidates.length === 1 ? candidates[0][1] : null;
}

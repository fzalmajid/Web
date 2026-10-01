export type AnswerBlock = { kind: "text"; value: string } | { kind: "table"; headers: string[]; rows: string[][] };

function cells(line: string) {
  return line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "").split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, "|"));
}

/** Only valid pipe tables become elements. Fenced code and ordinary prose stay literal. */
export function answerBlocks(text: string): AnswerBlock[] {
  const lines = text.split("\n"), blocks: AnswerBlock[] = [];
  let prose: string[] = [], fence = "";
  const flush = () => { if (prose.length) blocks.push({ kind: "text", value: prose.join("\n") }); prose = []; };
  for (let i = 0; i < lines.length; i++) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(lines[i]);
    if (marker) { if (!fence) fence = marker[1][0]; else if (marker[1][0] === fence) fence = ""; prose.push(lines[i]); continue; }
    const headers = cells(lines[i]), separator = cells(lines[i + 1] || "");
    if (!fence && lines[i].includes("|") && headers.length > 1 && headers.length <= 40 && separator.length === headers.length && separator.every(cell => /^:?-{3,}:?$/.test(cell))) {
      const rows: string[][] = [];
      let end = i + 2;
      while (end < lines.length && rows.length < 500 && lines[end].includes("|") && cells(lines[end]).length === headers.length) rows.push(cells(lines[end++]));
      if (rows.length) { flush(); blocks.push({ kind: "table", headers, rows }); i = end - 1; continue; }
    }
    prose.push(lines[i]);
  }
  flush(); return blocks;
}

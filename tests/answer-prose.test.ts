import { strict as assert } from "node:assert";
import { test } from "node:test";
import { answerProse, scopeAnswerHeadings, safeAnswerLink, answerHeadingTarget } from "../lib/answerProse";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AnswerProse from "../components/AnswerProse";

test("AI headings and contents links resolve to message-scoped anchors, including duplicate headings", () => {
  const groups = [answerProse("### Daftar Isi\n- [1. RAG](#1-rag)\n\n### 1. RAG\nPenjelasan."), answerProse("### 1. RAG\nLanjutan")];
  const anchors = scopeAnswerHeadings(groups, "answer-a");
  assert.equal(safeAnswerLink("#1-rag", anchors), "#answer-a-1-rag");
  const headings = groups.flat().filter(block => block.kind === "heading");
  assert.deepEqual(headings.map(block => block.id), ["answer-a-daftar-isi", "answer-a-1-rag", "answer-a-1-rag-2"]);
  assert.equal(safeAnswerLink("#tidak-ada", anchors), null);
  const other = [answerProse("### 1. RAG")];
  assert.equal(safeAnswerLink("#1-rag", scopeAnswerHeadings(other, "answer-b")), "#answer-b-1-rag");
});

test("live-style italic contents and bold standalone titles become working navigation", () => {
  const blocks = answerProse("_1. Perbedaan RAG_\n_2. Penggabungan RAG_\n_3. Tabel Tradeoff_\n\n*Perbedaan RAG*\nIsi pertama.\n\n**Penggabungan RAG**\nIsi kedua.\n\n*Tabel Tradeoff Metode*\n\n*References:*\nReferensi.");
  const anchors = scopeAnswerHeadings([blocks], "live-outline");
  const html = renderToStaticMarkup(createElement(AnswerProse, { blocks, anchors, renderText: text => text }));
  assert.equal(blocks[0].kind, "list");
  assert.ok(html.includes('href="#live-outline-perbedaan-rag"'));
  assert.ok(html.includes('href="#live-outline-penggabungan-rag"'));
  assert.ok(html.includes('href="#live-outline-tabel-tradeoff-metode"'));
  assert.ok(html.includes('<h3 id="live-outline-references">'));
  assert.equal(answerHeadingTarget("3. Tabel Tradeoff", anchors), "live-outline-tabel-tradeoff-metode");
});

test("ambiguous abbreviated contents stay text, not a jump to the wrong section", () => {
  const blocks = answerProse("*Tabel Tradeoff RAG*\nIsi.\n\n*Tabel Tradeoff Fine Tuning*\nIsi.");
  const anchors = scopeAnswerHeadings([blocks], "ambiguous");
  assert.equal(answerHeadingTarget("Tabel Tradeoff", anchors), null);
  assert.equal(answerHeadingTarget("Tabel Tradeoff RAG", anchors), "ambiguous-tabel-tradeoff-rag");
  assert.equal(answerProse("*Satu judul*\nTeks")[0].kind, "heading");
  assert.equal(answerProse("_Satu kalimat italic biasa_")[0].kind, "paragraph");
});

test("rendered answer has real contents links and headings while executable markup stays literal", () => {
  const blocks = answerProse("### Daftar Isi\n- [1. RAG](#1-rag)\n- [bahaya](javascript:alert(1))\n\n### 1. RAG\n`<script>alert(1)</script>`\n\n```html\n<img src=x onerror=alert(1)>\n```\n\nhttps://doi.org/10.1234/test.");
  const anchors = scopeAnswerHeadings([blocks], "answer-render");
  const html = renderToStaticMarkup(createElement(AnswerProse, { blocks, anchors, renderText: text => text }));
  assert.ok(html.includes('href="#answer-render-1-rag"'));
  assert.ok(html.includes('<h3 id="answer-render-1-rag">'));
  assert.ok(html.includes('href="https://doi.org/10.1234/test"'));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("&lt;img"));
  assert.ok(!html.includes('href="javascript:'));
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("<img"));
});

test("prose parser preserves display math, literal code, list numbering and text", () => {
  const blocks = answerProse("$$\n# x^2\n$$\n\n---\n3. Ketiga\n4. Keempat\n\n```html\n<script>alert(1)</script>\n# bukan heading\n```\n\nSelesai");
  assert.deepEqual(blocks, [
    { kind: "paragraph", text: "$$\n# x^2\n$$" }, { kind: "rule" },
    { kind: "list", ordered: true, start: 3, items: ["Ketiga", "Keempat"] },
    { kind: "code", text: "<script>alert(1)</script>\n# bukan heading" }, { kind: "paragraph", text: "Selesai" },
  ]);
});

test("answer links never activate executable protocols, embedded credentials or missing fragments", () => {
  const anchors = new Map<string,string>();
  for (const uri of ["javascript:alert(1)", "data:text/html,hello", "file:///private", "https://user:secret@example.com", "https://example.com/\nattack", "#%XX"]) assert.equal(safeAnswerLink(uri, anchors), null);
  assert.equal(safeAnswerLink("https://doi.org/10.1234/test", anchors), "https://doi.org/10.1234/test");
});

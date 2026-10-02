import { strict as assert } from "node:assert";
import { test } from "node:test";
import { answerProse, scopeAnswerHeadings, safeAnswerLink } from "../lib/answerProse";
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

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mergeStructuredPages, validatedRanking, rerankKnowledge, enhancePdfPages } from "../lib/documentEnhancements";
test("structured extraction cannot change page identity or silently lose pages", () => {
  const pages = [{ page: 7, text: "native ".repeat(30) }, { page: 8, text: "original ".repeat(30) }];
  assert.equal(mergeStructuredPages(pages, [{ page: 1, text: "wrong" }]), pages);
  assert.equal(mergeStructuredPages(pages, [{ page: 7, text: "x" }, { page: 7, text: "y" }]), pages);
  assert.deepEqual(mergeStructuredPages(pages, [{ page: 7, text: "x" }, { page: 8, text: "y" }]), pages);
  const improved = mergeStructuredPages(pages, pages.map(row => ({ ...row, text: row.text + " table" })));
  assert.equal(improved[0].page, 7); assert.match(improved[0].text, /table/);
});
test("reranker is a permutation, never new sources or source deletion", () => {
  const rows = [{ id: "a" }, { id: "b" }];
  assert.equal(validatedRanking(rows, ["a", "fake"]), rows);
  assert.equal(validatedRanking(rows, ["a", "a"]), rows);
  assert.deepEqual(validatedRanking(rows, ["b", "a"]), [rows[1], rows[0]]);
});
test("unconfigured enhancements preserve current pipeline", async () => {
  const rows = [{ id: "a" }, { id: "b" }];
  assert.equal(await rerankKnowledge(rows, "test"), rows);
  const pages = [{ page: 1, text: "original" }];
  assert.equal(await enhancePdfPages(Buffer.from("fake"), pages), pages);
});

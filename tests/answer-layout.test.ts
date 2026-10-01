import { strict as assert } from "node:assert";
import { test } from "node:test";
import { answerBlocks } from "../lib/answerLayout";
import { calibrationEvidence } from "../lib/calibrationEvidence";

test("answer tables preserve prose, escaped pipes and literal code", () => {
  const blocks = answerBlocks("Hasil\n| X | Y |\n| --- | ---: |\n| 1 | 0.06 |\n| 2 | a\\|b |\nPenjelasan");
  assert.equal(blocks.length, 3); assert.equal(blocks[1].kind, "table");
  if (blocks[1].kind === "table") assert.deepEqual(blocks[1].rows, [["1", "0.06"], ["2", "a|b"]]);
  assert.equal(answerBlocks("```text\n| X | Y |\n| --- | --- |\n| 1 | 2 |\n```")[0].kind, "text");
  assert.equal(answerBlocks("a | b\nordinary | prose")[0].kind, "text");
});
test("automatic calibration retrieval rejects unrelated excerpts, without gating other questions", () => {
  const rows = [{content:"Psychological types and narrative theory"}, {content:"Linear regression and calibration curve of absorbance"}, {raw_content:"Kurva baku dan linearitas metode", content:"summary"}];
  assert.deepEqual(calibrationEvidence(rows, "Kalibrasi linear konsentrasi"), rows.slice(1));
  assert.equal(calibrationEvidence(rows, "Jelaskan jenis psikologi"), rows);
  assert.deepEqual(calibrationEvidence(rows, "Kalibrasi linear"), rows.slice(1));
});

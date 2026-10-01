import { test } from "node:test";
import assert from "node:assert/strict";
import { remapTranscript } from "../lib/audioTimeline";
test("VAD timestamps map back across removed silence", () => {
  const map = [{ compactStart: 0, compactEnd: 2, originalStart: 3, originalEnd: 5 }, { compactStart: 2, compactEnd: 4, originalStart: 10, originalEnd: 12 }];
  assert.deepEqual(remapTranscript([{ text: "A", timestamp: [0, 2] }, { text: "B", timestamp: [2, 4] }], map, 15).map(c => c.timestamp), [[3, 5], [10, 12]]);
  assert.equal(remapTranscript([{ text: "Missing", timestamp: [0, null] }], map, 15).length, 0);
});

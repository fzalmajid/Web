import test from "node:test";
import assert from "node:assert/strict";
import { ChatRequestGate } from "../lib/chatRequest";

test("double submission is locked before any asynchronous chat save", () => {
  const gate = new ChatRequestGate();
  const first = gate.begin()!;
  assert.equal(gate.begin(), null);
  assert.equal(gate.isCurrent(first), true);
  assert.equal(gate.finish(first), true);
  assert.ok(gate.begin());
});

test("changing sessions aborts the old request and ignores its late completion", async () => {
  const gate = new ChatRequestGate();
  const old = gate.begin()!;
  let finishSave!: () => void;
  const pendingSave = new Promise<void>((resolve) => { finishSave = resolve; });
  let displayed = "";
  const oldResponse = pendingSave.then(() => {
    if (gate.isCurrent(old)) displayed = "old session";
    gate.finish(old);
  });
  gate.cancel();
  const next = gate.begin()!;
  finishSave();
  await oldResponse;
  assert.equal(old.signal.aborted, true);
  assert.equal(displayed, "");
  assert.equal(gate.isCurrent(next), true);
  assert.equal(gate.begin(), null);
});

test("stop and new conversation release the lock without accepting stale deltas", () => {
  const gate = new ChatRequestGate();
  const old = gate.begin()!;
  gate.cancel();
  assert.equal(gate.isCurrent(old), false);
  assert.equal(gate.finish(old), false);
  const fresh = gate.begin()!;
  assert.notEqual(old.id, fresh.id);
});

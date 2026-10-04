import test from "node:test";
import assert from "node:assert/strict";
import { boundedPopoverLeft } from "../lib/popoverPosition";

test("citation popup shifts away from the left edge", () => {
  const offset = boundedPopoverLeft(214, 400, 400, 0, 900);
  assert.equal(214 + offset, 16);
});
test("citation popup shifts away from the right edge", () => {
  const offset = boundedPopoverLeft(850, 1050, 400, 0, 900);
  assert.equal(850 + offset + 400, 884);
});
test("citation popup keeps right alignment when there is room", () => {
  assert.equal(boundedPopoverLeft(500, 700, 400, 0, 1200), -200);
});
test("citation popup respects a shifted visual viewport", () => {
  const offset = boundedPopoverLeft(210, 390, 400, 100, 500);
  assert.equal(210 + offset, 116);
});

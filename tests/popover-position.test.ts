import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { popoverPosition } from "../lib/popoverPosition";

for (const width of [320, 375, 768, 1440]) {
  test(`popover stays inside ${width}px viewport at either edge`, () => {
    for (const left of [4, width - 80]) {
      const p = popoverPosition({ left, width: 76, top: 500, bottom: 544 }, { width, height: 640 }, 400);
      assert.ok(p.left >= 12);
      assert.ok(p.left + p.width <= width - 12);
      assert.ok(p.maxHeight >= 0);
      assert.equal(p.top, undefined);
    }
  });
}
test("top anchor opens down and visual viewport offsets are respected", () => {
  const p = popoverPosition({ left: 20, width: 70, top: 55, bottom: 99 }, { width: 320, height: 300, left: 10, top: 30 }, 400);
  assert.equal(p.top, 107);
  assert.equal(p.bottom, undefined);
  assert.ok(p.left >= 22);
  assert.ok(p.top! + p.maxHeight <= 318);
});
test("keyboard-compressed viewport clamps an offscreen anchor vertically", () => {
  const viewport = { width: 320, height: 280, top: 40 };
  const p = popoverPosition({ left: 210, width: 90, top: 590, bottom: 634 }, viewport, 400);
  const bottom = viewport.height + viewport.top - p.bottom!;
  assert.equal(bottom, 308);
  assert.ok(bottom - p.maxHeight >= 52);
});
test("composer labels truncate in one row and popovers escape transformed ancestors", () => {
  const css = readFileSync("app/globals.css", "utf8");
  const portal = readFileSync("components/ViewportPopover.tsx", "utf8");
  assert.match(css, /\.gptComposer \.askTopControls\{display:flex!important;flex-wrap:nowrap!important/);
  assert.match(css, /\.gptComposer \.aiExperiencePicker\{order:3!important/);
  assert.ok(portal.includes("document.body"));
  assert.ok(portal.includes("createPortal"));
});

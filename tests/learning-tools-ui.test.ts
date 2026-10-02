import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("learning tool navigation visibly distinguishes the active module and keyboard focus", () => {
  const css = readFileSync(join(process.cwd(), "app/learning-tools.css"), "utf8");
  const page = readFileSync(join(process.cwd(), "app/tools/page.tsx"), "utf8");
  assert.ok(page.includes("aria-pressed={tab===id}"));
  assert.match(css, /nav button\[aria-pressed="true"\]\{[^}]*background:[^}]*color:/);
  assert.match(css, /nav button\{min-height:44px\}/);
  assert.match(css, /:focus-visible\{outline:3px/);
});

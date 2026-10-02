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

test("Web fallback preserves the user's Web selection in both normal and debug retry flows", () => {
  const page = readFileSync(join(process.cwd(), "app/page.tsx"), "utf8");
  const guarded = page.match(/if \(!data\.webFallback && Array\.isArray\(data\.selectedSources\) && data\.selectedSources\.length\)/g) || [];
  assert.equal(guarded.length, 2);
  assert.ok(!page.includes("if (Array.isArray(data.selectedSources) && data.selectedSources.length)"));
});

test("Record status reports actual VAD and no-speech results instead of claiming an unavailable integration", () => {
  const page = readFileSync(join(process.cwd(), "app/page.tsx"), "utf8");
  assert.match(page, /localVad = result\.usedVad/);
  assert.match(page, /localNoSpeech = Boolean\(result\.noSpeech\)/);
  assert.ok(page.includes("audio utuh, pemisahan ucapan belum tersedia"));
  assert.ok(page.includes("Tidak ada ucapan terdeteksi; audio tetap bisa didengar ulang."));
});

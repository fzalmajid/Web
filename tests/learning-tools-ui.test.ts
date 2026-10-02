import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("learning tool navigation visibly distinguishes the active module and keyboard focus", () => {
  const css = readFileSync(join(process.cwd(), "app/learning-tools.css"), "utf8");
  const page = readFileSync(join(process.cwd(), "components/LearningWorkspace.tsx"), "utf8");
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

test("media search is contextual in chat, not a duplicate composer form", () => {
  const page = readFileSync(join(process.cwd(), "app/page.tsx"), "utf8");
  assert.ok(!page.includes("extraWebPanel"));
  assert.ok(!page.includes("<OpenMedia"));assert.ok(page.includes("<ChatImages question="));
  const css = readFileSync(join(process.cwd(), "app/layout-alignment.css"), "utf8");
  assert.match(css, /\.askWebPanel\{\s*grid-column:1\/-1/);
  assert.match(css, /\.askTopControls\{[^}]*display:flex!important;[^}]*flex-wrap:wrap!important/);
  assert.match(css, /\.aiExperienceChoices\{flex-shrink:0\}/);
});

test("responsive chat respects the actual composer height and narrow viewport", () => {
  const css = readFileSync(join(process.cwd(), "app/layout-alignment.css"), "utf8");
  assert.match(css, /100dvh - var\(--rb-ai-answer-bottom,100px\) - var\(--rb-topbar-h,60px\)/);
  assert.match(css, /@media \(max-width:1023px\)\{\s*html,body,\.appShell\{min-width:0!important\}/);
  assert.match(css, /\.aiExperienceChoices button:focus-visible/);
});

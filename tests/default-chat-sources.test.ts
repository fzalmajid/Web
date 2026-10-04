import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const page=readFileSync("app/page.tsx","utf8");
test("online chat defaults to AI plus private Reference plus Web",()=>{
  assert.match(page,/useState<AiSourceKind\[\]>\(\["ai", "database", "web"\]\)/);
  const mode=page.slice(page.indexOf("function changeExperienceMode("),page.indexOf("function changeExperienceMode(")+1000);
  assert.match(mode,/if \(aiExperienceMode === "simple"\)\s*\{\s*setSelectedSources\(\["ai", "database", "web"\]\)/);
});
test("New Chat resets source kinds while saved chat preferences and Simple stay intact",()=>{
  const reset=page.slice(page.indexOf("function startNewChat()"),page.indexOf("function firstUrl("));
  assert.match(reset,/if \(busy\) return/);
  assert.match(reset,/aiExperienceMode === "simple" \? \["database"\] : \["ai", "database", "web"\]/);
  assert.match(page,/setSelectedSources\(settings.sources as AiSourceKind\[\]\)/);
});

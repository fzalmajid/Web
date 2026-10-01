import { test } from "node:test";
import assert from "node:assert/strict";
import { aiCouncilPlan, normalizeAiExperienceMode } from "../lib/aiOrchestration";
import { buildLocalHelperHints } from "../lib/localAiHelper";
import { webResearchStatus } from "../lib/webResearch";

test("normal AI modes describe depth instead of exposing a model picker", () => {
  assert.equal(normalizeAiExperienceMode("unknown"), "instant");
  assert.deepEqual(aiCouncilPlan("simple").stages, []);
  assert.deepEqual(aiCouncilPlan("instant").stages, []);
  assert.deepEqual(aiCouncilPlan("medium").stages, [
    "planner",
    "database-scholar",
    "independent-tutor",
    "synthesizer",
  ]);
  assert.deepEqual(aiCouncilPlan("high", true).stages, [
    "planner",
    "web-researcher",
    "database-scholar",
    "independent-tutor",
    "verifier",
    "critic",
    "synthesizer",
  ]);
});

test("local helper remains useful without a local model endpoint", async () => {
  const result = await buildLocalHelperHints("carikan paper paracetamol dan DOI terbaru", {});
  assert.equal(result.runtime, "heuristic-browser");
  assert.equal(result.intent, "research-and-citation");
  assert.ok(result.sourceTerms.includes("paracetamol"));
});

test("web research is optional and preserves a direct-fetch/provider fallback", () => {
  const status = webResearchStatus();
  assert.equal(status.directFetchFallback, true);
  assert.equal(status.searxng.required, false);
  assert.equal(status.crawl4ai.required, false);
});

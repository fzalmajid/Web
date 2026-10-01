import { test } from "node:test";
import assert from "node:assert/strict";
import { runAiCouncil } from "../lib/aiCouncil";
import { isZeroCostModel } from "../lib/openRouterFree";
test("free router and unavailable helper never trigger paid helper calls",async()=>{
  assert.equal(isZeroCostModel("openrouter/free"),true);assert.equal(isZeroCostModel("x:free"),true);assert.equal(isZeroCostModel("openrouter/auto"),false);
  delete process.env.OPENROUTER_API_KEY;let calls=0;
  const result=await runAiCouncil({mode:"high",useWeb:true,basePrompt:"Question and visible URL https://example.org/evidence",generate:async(prompt,web)=>{calls++;assert.equal(web,true);return{text:"Final",model:"primary"};}});
  assert.equal(calls,1);assert.equal(result?.result.text,"Final");
  assert.equal(result?.helpers.freeAgents,0);assert.equal(result?.helpers.structuralChecks,7);
});

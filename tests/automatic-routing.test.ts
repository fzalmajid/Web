import { test } from "node:test";
import assert from "node:assert/strict";
import { prioritizeAvailableModels } from "../lib/gemini";
import { selectionFromExperienceMode } from "../lib/aiModels";
test("normal mode routes only allowed Flash models; debug remains strict",()=>{
  const allowed=["gemini-3.5-flash-lite","gemini-3.5-flash","gemini-2.5-flash"];
  assert.deepEqual(prioritizeAvailableModels([allowed[0]],["gemini-3.8-flash",...allowed,"gemini-2.5-pro"],false,false,allowed),allowed);
  assert.deepEqual(prioritizeAvailableModels(["missing"],allowed,false,true,allowed),[]);
  assert.deepEqual(prioritizeAvailableModels([allowed[0]],[],false,false,allowed),allowed);
  assert.equal(selectionFromExperienceMode("instant").model,"gemini-3.5-flash-lite");
});

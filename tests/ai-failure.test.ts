import test from "node:test";
import assert from "node:assert/strict";
import {aiFailure} from "../lib/aiFailure";
test("provider quota returns actionable public message, stable code and bounded Retry-After",()=>{
  const failure=aiFailure({code:"GEMINI_QUOTA",statusCode:429,retryAfterSeconds:12.4,message:"private source/key"},"Failed");
  assert.equal(failure.init.status,429);assert.equal(failure.init.headers?.["Retry-After"],"13");
  assert.equal(failure.body.retryAfterSeconds,13);assert.equal(failure.body.code,"GEMINI_QUOTA");
  assert.doesNotMatch(failure.body.error,/private|Pilih model|tidak ada model/i);
  assert.match(failure.body.error,/13 detik/);
});
test("Search quota is not disguised as non-Web research or a failed answer grade",()=>{
  const failure=aiFailure({code:"WEB_SEARCH_QUOTA",statusCode:429},"Failed");
  assert.match(failure.body.error,/tidak akan diganti diam-diam/);
  assert.equal(failure.body.retryAfterSeconds,undefined);
});
test("auth error is actionable without suggesting a model picker; invalid wait and status are rejected",()=>{
  const failure=aiFailure({code:"GEMINI_AUTH_REJECTED",statusCode:403,retryAfterSeconds:NaN},"Failed");
  assert.match(failure.body.error,/API key, izin API/);
  assert.equal(failure.init.status,403);
  assert.equal(failure.init.headers,undefined);
  assert.equal(aiFailure({statusCode:200},"Failed").init.status,500);
});

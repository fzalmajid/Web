import test from "node:test";
import assert from "node:assert/strict";
import { routePrimary, type PrimaryGeneration } from "../lib/primaryRouter";
import { recordAiGenerationUsage } from "../lib/aiQuota";
import { openaiGenerateDetailed } from "../lib/externalAi";

const output = (model: string, provider: PrimaryGeneration["provider"]): PrimaryGeneration => ({text:`Answer ${model}`, model, provider,
  usage:{inputTokens:10,outputTokens:20,thoughtsTokens:0,totalTokens:30},webSources:[{title:model,uri:"https://example.org/paper"}]});
test("High combines two authorized primaries and records each provider once", async () => {
  const result = await routePrimary({gemini:async()=>output("gemini-test","shared-api-key"),combine:true,
    openai:async draft=>{assert.equal(draft?.model,"gemini-test"); return output("gpt-test","shared-openai-api-key");}});
  assert.equal(result.model,"gpt-test"); assert.equal(result.primaryRoute?.combined,true); assert.equal(result.webSources.length,1);
  const tracked:any[]=[];
  await recordAiGenerationUsage({rpc:async(_name:string,args:any)=>{tracked.push(args);return {data:null,error:null};}} as any,result);
  assert.equal(tracked.length,2); assert.equal(tracked[0].model_name,"shared-api-key|gemini-test");
  assert.equal(tracked[1].model_name,"shared-openai-api-key|gpt-test");
});
test("Instant only invokes Gemini on success, but uses GPT once on provider unavailability", async () => {
  let gpt=0;
  await routePrimary({gemini:async()=>output("gemini-test","shared-api-key"),openai:async()=>{gpt++;return output("gpt-test","shared-openai-api-key");}});
  assert.equal(gpt,0);
  const result=await routePrimary({gemini:async()=>{throw {code:"GEMINI_NO_AVAILABLE_MODEL"};},openai:async()=>{gpt++;return output("gpt-test","shared-openai-api-key");}});
  assert.equal(gpt,1);assert.equal(result.primaryRoute?.fallback,true);assert.equal(result.usageRecords?.length,1);
});
test("GPT billing/rate limit cannot discard a successful Gemini answer or start a retry loop", async () => {
  let calls=0;
  const result=await routePrimary({gemini:async()=>output("gemini-test","shared-api-key"),combine:true,
    openai:async()=>{calls++;throw {code:"PROVIDER_INSUFFICIENT_QUOTA"};}});
  assert.equal(calls,1);assert.equal(result.model,"gemini-test");assert.equal(result.primaryRoute?.combined,false);
  assert.equal(result.usageRecords?.length,1);
  await assert.rejects(routePrimary({gemini:async()=>{throw {code:"INVALID_SOURCE"};},openai:async()=>{throw new Error("Must not run");}}),error=>(error as any).code==="INVALID_SOURCE");
});
test("shared GPT transport does not send unsupported reasoning for 4.1 and supports JSON without storing the response", async () => {
  const original=globalThis.fetch;
  globalThis.fetch=async(_url,init)=>{
    const body=JSON.parse(String(init?.body));assert.equal(body.reasoning,undefined);
    assert.equal(body.store,false);assert.equal(body.text.format.type,"json_object");
    return Response.json({output_text:'{"units":[]}',usage:{input_tokens:10,output_tokens:20,total_tokens:30}});
  };
  try {assert.equal((await openaiGenerateDetailed({apiKey:"test-only",model:"gpt-4.1-mini",prompt:"JSON Study",effort:"high",json:true})).usage.totalTokens,30);}
  finally {globalThis.fetch=original;}
});

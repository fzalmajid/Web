import test from "node:test";
import assert from "node:assert/strict";
import {freeModelsForStage,openRouterFreeGenerate} from "../lib/openRouterFree";
import {routeCouncilStage} from "../lib/councilRouter";
import {runAiCouncil} from "../lib/aiCouncil";

async function fixture(run:()=>Promise<void>){
  const names=["OPENROUTER_API_KEY","OPENROUTER_FREE_MODEL","OPENROUTER_FREE_MODELS","OPENROUTER_FREE_STAGE_MODELS"];
  const saved=names.map(name=>process.env[name]),oldFetch=global.fetch,now=Date.now;
  names.forEach(name=>delete process.env[name]);
  Date.now=()=>now()+3600000;
  try{await run();}finally{names.forEach((name,i)=>saved[i]===undefined?delete process.env[name]:process.env[name]=saved[i]);global.fetch=oldFetch;Date.now=now;}
}
test("role preferences reject paid IDs and prefer unused permitted candidates",async()=>fixture(async()=>{
  process.env.OPENROUTER_FREE_MODELS="paid/model,alpha/one:free,beta/two:free";
  process.env.OPENROUTER_FREE_STAGE_MODELS=JSON.stringify({critic:["gamma/three:free","paid/critic"]});
  assert.deepEqual(freeModelsForStage("critic",["gamma/three:free"]),["alpha/one:free","beta/two:free","gamma/three:free"]);
}));
test("model failure switches to a free candidate with price and privacy guards",async()=>fixture(async()=>{
  process.env.OPENROUTER_API_KEY="test-not-a-real-key";
  process.env.OPENROUTER_FREE_MODELS="mock/a:free,mock/b:free,paid/model";
  const models:string[]=[];
  global.fetch=(async(_url,init)=>{const body=JSON.parse(String(init?.body));models.push(body.model);
    assert.deepEqual(body.provider.max_price,{prompt:0,completion:0});assert.equal(body.provider.data_collection,"deny");
    return models.length===1?new Response("{}",{status:503}):new Response(JSON.stringify({choices:[{message:{content:"Notes"}}]}));}) as typeof fetch;
  assert.equal((await openRouterFreeGenerate({prompt:"Evidence",stage:"critic"})).model,"openrouter-free:mock/b:free");
  assert.deepEqual(models,["mock/a:free","mock/b:free"]);
}));
test("expired helper budget is local only and never invokes the primary",async()=>fixture(async()=>{
  const result=await routeCouncilStage({stage:"verifier",prompt:"Context",withWeb:false,deadline:Date.now()-1,usedModels:[],primary:async()=>{throw new Error("Paid helper must not run");},local:()=>({text:"Structural only",model:"local-structural-helper"})});
  assert.equal(result.route.provider,"local-structural");assert.equal(result.route.policy,"free-only");
}));
test("one Council routes every stage and only the synthesizer invokes the primary",async()=>fixture(async()=>{
  let calls=0;
  const result=await runAiCouncil({mode:"high",useWeb:true,basePrompt:"Evidence",generate:async()=>{calls++;return {text:"Final",model:"existing-primary"};}});
  assert.equal(calls,1);assert.equal(result?.routes.length,8);assert.equal(result?.routes.filter(r=>r.policy==="free-only").length,7);
  assert.equal(result?.helpers.structuralChecks,7);
}));
test("provider rate limit stops retries across models and subsequent stages",async()=>fixture(async()=>{
  process.env.OPENROUTER_API_KEY="test-not-a-real-key";process.env.OPENROUTER_FREE_MODELS="limit/a:free,limit/b:free";
  let calls=0;global.fetch=(async()=>{calls++;return new Response("{}",{status:429,headers:{"retry-after":"60"}});}) as typeof fetch;
  await assert.rejects(openRouterFreeGenerate({prompt:"Evidence"}));await assert.rejects(openRouterFreeGenerate({prompt:"Evidence"}));assert.equal(calls,1);
}));

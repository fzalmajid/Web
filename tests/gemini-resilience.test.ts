import test from "node:test";
import assert from "node:assert/strict";
import {geminiGenerateDetailed} from "../lib/gemini";
import {modelPlanForSelection} from "../lib/aiModels";

const known=["gemini-3.5-flash-lite","gemini-3.5-flash","gemini-3.8-flash"];
const catalog=()=>Response.json({models:known.map(name=>({name:"models/"+name,supportedGenerationMethods:["generateContent"]}))});
const options={apiKey:"regression-test-only",models:known};
const ok=()=>Response.json({candidates:[{content:{parts:[{text:"Real response"}]},finishReason:"STOP"}]});

test("production regression: quota followed by missing legacy model stays quota, not all-models-unavailable",async()=>{
  const original=globalThis.fetch;let attempts=0;
  try {
    globalThis.fetch=async(_url,init)=>!init?.body?catalog():++attempts<3
      ?Response.json({error:{message:"Generation rate limit exceeded",details:[{"@type":"type.googleapis.com/google.rpc.RetryInfo",retryDelay:"12.4s"}]}},{status:429})
      :Response.json({error:{message:"model not found"}},{status:404});
    await assert.rejects(geminiGenerateDetailed([{text:"Grade essay"}],"",options),(error:any)=>error.code==="GEMINI_QUOTA"&&error.statusCode===429&&error.retryAfterSeconds===13);
    assert.equal(attempts,3);
  }finally{globalThis.fetch=original;}
});

test("using Web does not relabel ordinary token quota as Search quota",async()=>{
  const original=globalThis.fetch;
  try {
    globalThis.fetch=async(_url,init)=>!init?.body?catalog():Response.json({error:{message:"GenerateContent requests per day exceeded"}},{status:429});
    await assert.rejects(geminiGenerateDetailed([{text:"Research"}],"",{...options,googleSearch:true,maxAttempts:1}),(error:any)=>error.code==="GEMINI_QUOTA");
    globalThis.fetch=async(_url,init)=>!init?.body?catalog():Response.json({error:{message:"Google Search grounding quota exceeded"}},{status:429});
    await assert.rejects(geminiGenerateDetailed([{text:"Research"}],"",{...options,googleSearch:true,maxAttempts:1}),(error:any)=>error.code==="WEB_SEARCH_QUOTA");
  }finally{globalThis.fetch=original;}
});

test("failed discovery preserves a bounded usable Flash fallback, not three unverified requests",async()=>{
  const original=globalThis.fetch;const attempts:string[]=[];
  try {
    globalThis.fetch=async(url,init)=>{
      if(!init?.body)return Response.json({error:{message:"Discovery temporarily unavailable"}},{status:503});
      attempts.push(String(url));
      return attempts.length===1?Response.json({error:{message:"model not found"}},{status:404}):ok();
    };
    const result=await geminiGenerateDetailed([{text:"Explain"}],"",{...options,models:["gemini-unverified-a","gemini-unverified-b","gemini-unverified-c"]});
    assert.equal(result.model,"gemini-3.5-flash-lite");assert.equal(attempts.length,2);
    assert.ok(!attempts.some(url=>url.includes("unverified-b")));
  }finally{globalThis.fetch=original;}
});

test("authentication failure is precise and stops before spending generation attempts",async()=>{
  const original=globalThis.fetch;let calls=0;
  try {
    globalThis.fetch=async()=>{calls++;return Response.json({error:{message:"API key not valid",details:[{reason:"API_KEY_INVALID"}]}},{status:400});};
    await assert.rejects(geminiGenerateDetailed([{text:"Study"}],"",options),(error:any)=>error.code==="GEMINI_AUTH_REJECTED"&&error.statusCode===403);
    assert.equal(calls,1);
  }finally{globalThis.fetch=original;}
});

test("verified empty catalog is distinct from unavailable discovery and bounded candidate failures",async()=>{
  const original=globalThis.fetch;let generations=0;
  try {
    globalThis.fetch=async(_url,init)=>{if(init?.body)generations++;return Response.json({models:[]});};
    await assert.rejects(geminiGenerateDetailed([{text:"Explain"}],"",options),(error:any)=>error.code==="GEMINI_NO_AVAILABLE_MODEL");
    assert.equal(generations,0);
    globalThis.fetch=async(_url,init)=>!init?.body?catalog():Response.json({error:{message:"model not found"}},{status:404});
    await assert.rejects(geminiGenerateDetailed([{text:"Explain"}],"",{...options,maxAttempts:1}),(error:any)=>error.code==="GEMINI_MODEL_UNAVAILABLE"&&!error.message.includes("Tidak ada model"));
  }finally{globalThis.fetch=original;}
});

test("strict debug never silently changes model, even when discovery fails",async()=>{
  const original=globalThis.fetch;const attempts:string[]=[];
  try {
    globalThis.fetch=async(url,init)=>{
      if(!init?.body)throw new Error("Network unavailable");
      attempts.push(String(url));return Response.json({error:{message:"model not found"}},{status:404});
    };
    await assert.rejects(geminiGenerateDetailed([{text:"Explain"}],"",{...options,models:["debug-only"],strictModel:true}), (error:any)=>error.code==="GEMINI_MODEL_UNAVAILABLE");
    assert.equal(attempts.length,1);assert.match(attempts[0],/debug-only/);
  }finally{globalThis.fetch=original;}
});

test("service failure followed by 404 remains service failure; success still wins after quota",async()=>{
  const original=globalThis.fetch;let calls=0;let success=false;
  try {
    globalThis.fetch=async(_url,init)=>!init?.body?catalog():++calls===1
      ?Response.json({error:{message:success?"rate limit exceeded":"Service unavailable"}},{status:success?429:503})
      :success?ok():Response.json({error:{message:"model not found"}},{status:404});
    await assert.rejects(geminiGenerateDetailed([{text:"Explain"}],"",options),(error:any)=>error.code==="GEMINI_UNAVAILABLE");
    success=true;calls=0;
    assert.equal((await geminiGenerateDetailed([{text:"Explain"}],"",options)).text,"Real response");
    assert.equal(calls,2);
  }finally{globalThis.fetch=original;}
});

test("automatic Study and Web paths prefer active Flash models ahead of access-restricted legacy",()=>{
  for(const mode of ["instant","medium","high"] as const)for(const task of ["standard","web"] as const){
    const plan=modelPlanForSelection("gemini-3.5-flash",mode,task);
    assert.deepEqual(new Set(plan.slice(0,3)),new Set(known));
    assert.ok(!plan.slice(0,3).some(model=>model.includes("2.5")||model.includes("pro")));
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import {NextRequest} from "next/server";
// Exercise the real route while substituting external services, not grading logic.
const Module=require("node:module");
const originalLoad=Module._load;
let generated:any[]=[];
let responseRows:any[]=[];
let searches:any[]=[];
let providerError:any=null;
const quiz={id:"11111111-1111-1111-1111-111111111111",scope_node_id:"22222222-2222-2222-2222-222222222222",quiz_type:"essay",grading_mode:"fixed",question:"Bagaimana cara determinasi dan apa yang diamati?",choices:[],correct_answer:"Sumber data aktif tidak memuat rujukan terkait prosedur determinasi."};
const sourceId="33333333-3333-3333-3333-333333333333";
const db={
  auth:{getUser:async()=>({data:{user:{id:"user"}}})},
  from:(table:string)=>({
    select:()=>table==="quizzes"
      ? {in:async()=>({data:[quiz]})}
      : {eq:()=>({single:async()=>({data:{id:quiz.scope_node_id,parent_id:sourceId}})})},
  }),
};
Module._load=function(id:string,...args:any[]) {
  if(id==="@/lib/supabase")return {createServerSupabase:()=>db};
  if(id==="@/lib/requestTextAi")return {
    getTextAiRequestInfo:(_:any,mode:string)=>({sharedGemini:true,mode}),
    generateTextAi:async (...values:any[])=>{generated.push(values);if(providerError)throw providerError;return {text:JSON.stringify({results:responseRows}),model:"gemini-test",provider:"shared-api-key",usage:{}};},
  };
  if(id==="@/lib/knowledge")return {
    searchSelectedKnowledge:async(...values:any[])=>{searches.push(values);return [];},
    getSelectedKnowledge:async()=>[],prioritizeQuestionRelevantSources:(rows:any)=>rows,buildKnowledgeContext:()=>"",
  };
  if(id==="@/lib/aiQuota")return {normalizeAiMode:(x:string)=>x,checkAiCredits:async()=>({allowed:true}),finalizeAiCredits:async()=>({}),recordAiGenerationUsage:async()=>{},aiQuotaError:()=>({})};
  return originalLoad.call(this,id,...args);
};
const {POST}=require("../app/api/grade-quiz/route");
Module._load=originalLoad;
function request(sources:string[],mode="medium") {
  return new NextRequest("https://example.test/api/grade-quiz",{method:"POST",headers:{authorization:"Bearer test","content-type":"application/json"},body:JSON.stringify({aiMode:mode,sources,sourceNodeIds:[sourceId],sourceFileIds:[],answers:[{quizId:quiz.id,answer:"Bandingkan ciri morfologi dengan kunci determinasi, herbarium tervalidasi atau ahli botani."}]})});
}
test("legacy fixed essay reaches real AI dispatch; Simple upgrades only grading; absent results remain ungraded",async()=>{
  generated=[];searches=[];responseRows=[];
  const result=await POST(request(["database"],"simple"));
  assert.equal(result.status,200);
  const data=await result.json();
  assert.equal(data.results[0].gradable,false);assert.equal(data.results[0].score,null);
  assert.equal(generated.length,1);assert.equal(generated[0][1],"instant");
  assert.match(generated[0][2],/"reference_answer": ""/);
  assert.match(generated[0][2],/Bandingkan ciri morfologi/);
  assert.equal(searches[0][1],quiz.question);assert.deepEqual(searches[0][2],[sourceId]);
});
test("AI source can assess without Database; partial score is genuine model verdict",async()=>{
  searches=[];responseRows=[{id:quiz.id,gradable:true,verdict:"hampir_benar",score:70,feedback:"Lengkapi ciri organ yang diamati.",basis:"Pengetahuan AI"}];
  const result=await POST(request(["ai"]));const data=await result.json();
  assert.equal(data.results[0].score,70);assert.equal(searches.length,0);
  assert.match(generated.at(-1)[2],/Boleh menilai konsep dari pengetahuan umum AI/);
});
test("insufficient and duplicate model results never fail a student",async()=>{
  for (const rows of [[{id:quiz.id,gradable:false,score:0,verdict:"salah"}],[{id:quiz.id,gradable:true,score:100,verdict:"benar"},{id:quiz.id,gradable:true,score:0,verdict:"salah"}]]) {
    responseRows=rows;const data=await (await POST(request(["database"]))).json();
    assert.equal(data.results[0].gradable,false);assert.equal(data.results[0].score,null);
  }
});
test("missing login is rejected before grading",async()=>{
  const result=await POST(new NextRequest("https://example.test/api/grade-quiz",{method:"POST"}));
  assert.equal(result.status,401);
});
test("quota is an actionable retryable service error, never a score or missing-model claim",async()=>{
  providerError=Object.assign(new Error("private provider payload"),{code:"GEMINI_QUOTA",statusCode:429,retryAfterSeconds:15});
  try {
    const response=await POST(request(["ai"]));const data=await response.json();
    assert.equal(response.status,429);assert.equal(response.headers.get("Retry-After"),"15");
    assert.equal(data.code,"GEMINI_QUOTA");assert.equal(data.results,undefined);
    assert.match(data.error,/15 detik/);assert.doesNotMatch(data.error,/private provider|Tidak ada model/);
  }finally{providerError=null;}
});

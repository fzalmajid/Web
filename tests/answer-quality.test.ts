import test from "node:test";
import assert from "node:assert/strict";
import {visibleAnswerParts,planningOnlyAnswer,claimSupportInstruction} from "../lib/answerQuality";
import {geminiGenerateDetailed} from "../lib/gemini";
import {planAnswerLength} from "../lib/answerLength";
import {matchesResearchPurpose,rankResearchHits} from "../lib/researchQuery";
import {guardAnswerBibliography} from "../lib/answerEvidence";
import {mergeWebSources} from "../lib/scholarlySources";

test("thought summaries never become visible answer text",()=>{
  assert.equal(visibleAnswerParts([{text:"Let's write",thought:true},{text:"Definisi simplisia."},{text:"secret",thought:true}]),"Definisi simplisia.");
  assert.equal(visibleAnswerParts([{text:"notes",thought:true}]),"");
  assert.equal(planningOnlyAnswer('Wijanarko: abstract mentions parameters. Let\'s write based on abstract.'),true);
  assert.equal(planningOnlyAnswer('Dasar teori\nSimplisia adalah bahan alam yang dikeringkan.'),false);
});

test("theory sizing distinguishes definition from preparation without adding report sections",()=>{
  const definition=planAnswerLength("tuliskan dasar teori simplisia");
  const process=planAnswerLength("tuliskan dasar teori simplisia, penyiapan sampel hingga kering (Capsicum sp)");
  assert.ok(process.targetCharacters>definition.targetCharacters);
  assert.deepEqual(process.sections,["Dasar teori"]);
  assert.ok(planAnswerLength("tuliskan dasar teori simplisia ringkas").targetCharacters<definition.targetCharacters);
});

test("purpose gate is general and does not blacklist requested software topics",()=>{
  for(const subject of ["simplisia","memory","kalibrasi"]){
    const app={title:`Aplikasi kamus ${subject} berbasis Android`};
    assert.equal(matchesResearchPurpose(app,`tuliskan dasar teori ${subject}`),false);
    assert.equal(matchesResearchPurpose(app,`tuliskan dasar teori aplikasi ${subject}`),true);
  }
  const relevant={title:"Standardisasi simplisia daun tanaman",abstract:"Specific parameters of dried medicinal plant materials"};
  assert.equal(matchesResearchPurpose(relevant,"tuliskan dasar teori simplisia"),true);
  assert.equal(rankResearchHits([{title:"Aplikasi kamus simplisia Android",abstract:"dried medicinal plant database"},relevant],"dried medicinal plant","tuliskan dasar teori simplisia").includes(relevant),true);
});

test("user notes are provenance, not formal citations; literal examples remain unchanged",()=>{
  const result=guardAnswerBibliography("Tahapan dari catatan (Bahan Pengguna). `contoh (Bahan Pengguna)`",[],"apa");
  assert.match(result.text,/berdasarkan bahan pengguna/);
  assert.match(result.text,/`contoh \(Bahan Pengguna\)`/);
  assert.doesNotMatch(result.text,/References:/);
  assert.match(claimSupportInstruction(),/standar umum/);
});

test("read XML and DOI listing become one source without merging conflicting works",()=>{
  const title="An actual paper on drying";
  const hit:any={title,doi:"10.1000/drying",uri:"https://doi.org/10.1000/drying"};
  const read={title:title+" — dibaca: artikel XML",uri:"https://example.org/read.xml"};
  assert.deepEqual(mergeWebSources([read],[hit]),[read]);
  const other:any={...hit,doi:"10.1000/other",uri:"https://doi.org/10.1000/other"};
  assert.equal(mergeWebSources([],[hit,other]).length,2);
});

test("short explanations reserve visible output and recover once from truncated reasoning",async()=>{
  const original=globalThis.fetch;const calls:any[]=[];
  try{
    globalThis.fetch=async(url,options)=>{
      if(!String(url).includes(":generateContent"))return new Response(JSON.stringify({models:[{name:"models/gemini-2.5-flash",supportedGenerationMethods:["generateContent"]}]}));
      calls.push(JSON.parse(String(options?.body)));
      return new Response(JSON.stringify({candidates:[{content:{parts:calls.length===1?[{thought:true,text:"Let's write a plan"}]:[{text:"Dasar teori lengkap.\n\nReferences:\nSumber nyata."}]},finishReason:calls.length===1?"MAX_TOKENS":"STOP"}],usageMetadata:{thoughtsTokenCount:100,candidatesTokenCount:20}}));
    };
    const result=await geminiGenerateDetailed([{text:"Tuliskan dasar teori simplisia"}],"Tutor",{apiKey:"test-quality-budget",models:["gemini-2.5-flash"],strictModel:true,effort:"high",maxOutputTokens:4096,maxThinkingTokens:1024,retryTruncatedDocument:true});
    assert.equal(calls.length,2);
    assert.ok(calls[0].generationConfig.thinkingConfig.thinkingBudget<=1024);
    assert.equal(result.finishReason,"STOP");assert.equal(result.repairedTruncation,true);
    assert.doesNotMatch(result.text,/Let's/);assert.equal(result.usage.thoughtsTokens,200);
  }finally{globalThis.fetch=original;}
});

test("repeated planning-only responses fail safely rather than exposing notes",async()=>{
  const original=globalThis.fetch;let calls=0;
  try{
    globalThis.fetch=async(url)=>{
      if(!String(url).includes(":generateContent"))return new Response(JSON.stringify({models:[{name:"models/test-quality-model",supportedGenerationMethods:["generateContent"]}]}));
      calls++;return new Response(JSON.stringify({candidates:[{content:{parts:[{text:"Let's write the answer"}]},finishReason:"STOP"}]}));
    };
    await assert.rejects(geminiGenerateDetailed([{text:"Explain"}],"Tutor",{apiKey:"test-quality-notes",models:["test-quality-model"],strictModel:true,retryTruncatedDocument:true}),/Jawaban final/);
    assert.equal(calls,2);
  }finally{globalThis.fetch=original;}
});

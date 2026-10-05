import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {needsAiGrading,usableQuizReference,normalizeQuizGrade} from "../lib/quizGrading";

test("every essay including legacy fixed rows needs semantic AI grading",()=>{
  assert.equal(needsAiGrading({quiz_type:"essay",grading_mode:"fixed"}),true);
  assert.equal(needsAiGrading({quiz_type:"essay",grading_mode:"ai"}),true);
  assert.equal(needsAiGrading({quiz_type:"mcq",grading_mode:"fixed"}),false);
});
test("source disclaimers never become answer keys, independent of topic",()=>{
  for (const text of [
    "Berdasarkan sumber yang tersedia, tidak terdapat informasi spesifik mengenai cara determinasi karena dokumen materi yang ada tidak membahas topik tersebut.",
    "Sumber data aktif tidak memuat rujukan terkait prosedur titrasi.",
    "Insufficient evidence for this topic.",
  ]) assert.equal(usableQuizReference(text),"");
  assert.equal(usableQuizReference("Tidak terdapat stomata pada permukaan tersebut."),"Tidak terdapat stomata pada permukaan tersebut.");
  assert.equal(usableQuizReference("Bandingkan morfologi dengan kunci determinasi dan herbarium."),"Bandingkan morfologi dengan kunci determinasi dan herbarium.");
});
test("missing/malformed AI results and insufficient evidence do not become zero grades",()=>{
  for (const result of [null,{}, {score:0}, {gradable:true,score:NaN,verdict:"salah"}, {gradable:false,score:0,verdict:"salah"}]) {
    const grade=normalizeQuizGrade(result,"essay");
    assert.equal(grade.gradable,false);assert.equal(grade.score,null);assert.equal(grade.verdict,"tidak_dapat_dinilai");
  }
});
test("valid AI verdicts retain partial credit; correct is consistent",()=>{
  for (const [verdict,score] of Object.entries({benar:100,hampir_benar:70,benar_sebagian:50,benar_sedikit:25,salah:0})) {
    const grade=normalizeQuizGrade({gradable:true,verdict,score,correct:true},"essay");
    assert.equal(grade.score,score);assert.equal(grade.correct,score===100);
  }
});
test("UI calls AI for all essays with active selected source scopes and keeps answers on failure",()=>{
  const page=readFileSync("app/page.tsx","utf8");
  assert.match(page,/localQuizzes.filter\(needsAiGrading\)/);
  assert.doesNotMatch(page,/correctFixedEssay|const fixedEssay/);
  const submit=page.slice(page.indexOf("async function finishQuiz()"),page.indexOf("async function removeQuiz("));
  assert.match(submit,/sourceNodeIds: practiceSourceNodeIds/);
  assert.match(submit,/sourceFileIds: practiceSourceFileIds/);
  assert.match(submit,/sources: practiceAnswerSources/);
  assert.match(submit,/finally[\s\S]*setGrading\(false\)/);
  assert.doesNotMatch(submit,/normalizeQuizAnswer|setEssayAnswers/);
  assert.match(page,/Belum dapat dinilai · tidak masuk nilai akhir/);
});

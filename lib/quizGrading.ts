/** Essay answers require semantic assessment, including legacy 'fixed' rows. */
export function needsAiGrading(quiz: {quiz_type: string; grading_mode: string}) {
  return quiz.quiz_type === "essay" || quiz.grading_mode === "ai";
}

/** A source-coverage disclaimer is not an answer key. No topic-specific rules. */
export function usableQuizReference(value: unknown) {
  const text = String(value || "").trim();
  const unavailable = /(?:tidak|belum)\s+(?:terdapat|tersedia|ditemukan|ada|cukup)\s+(?:informasi|sumber|rujukan|bukti)|(?:sumber|rujukan|database|dokumen|materi).{0,35}(?:tidak|belum)\s+(?:tersedia|cukup|memuat|membahas)|insufficient (?:information|evidence)|no (?:information|evidence|sources?) (?:available|found)/i;
  return unavailable.test(text) ? "" : text;
}

export function normalizeQuizGrade(result: any, quizType: string) {
  const allowed = ["benar", "hampir_benar", "benar_sebagian", "benar_sedikit", "salah"];
  const valid = result && typeof result.gradable === "boolean" &&
    (result.gradable === false || (allowed.includes(result.verdict) && Number.isFinite(result.score)));
  if (!valid || !result.gradable) return {
    gradable: false, verdict: "tidak_dapat_dinilai", correct: false, score: null,
    feedback: String(result?.feedback || "Penilaian belum lengkap. Jawaban tidak dihitung salah; coba nilai ulang atau lengkapi sumber."),
    basis: String(result?.basis || ""),
  };
  const scores: Record<string, number> = {benar:100,hampir_benar:70,benar_sebagian:50,benar_sedikit:25,salah:0};
  const score = quizType === "mcq" ? (result.verdict === "benar" ? 100 : 0) : scores[result.verdict];
  return {gradable:true,verdict:quizType === "mcq" ? (score === 100 ? "benar" : "salah") : result.verdict,
    correct:score === 100,score,feedback:String(result.feedback || ""),basis:String(result.basis || "")};
}

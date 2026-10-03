import type { AiEffort, AiResponseLength } from "./aiModels";

export type AnswerLengthPlan = {
  kind: "brief" | "explanation" | "analysis" | "document";
  minCharacters: number;
  targetCharacters: number;
  maxCharacters: number;
  sections: string[];
  explicit: { unit: "characters" | "words" | "sentences"; amount: number; maximum: boolean } | null;
  responseLength: AiResponseLength;
  maxOutputTokens: number;
};

const reportSections = [
  { name: "Dasar teori", pattern: /\b(?:dasar teori|landasan teori|theoretical background)\b/i, weight: 2800 },
  { name: "Monografi", pattern: /\b(?:monografi|monograph)\b/i, weight: 2000 },
  { name: "Alat dan bahan", pattern: /\b(?:alat\s*(?:dan|&)\s*bahan|alat|materials and methods)\b/i, weight: 700 },
  { name: "Cara kerja", pattern: /\b(?:cara kerja|prosedur|metode kerja|procedure)\b/i, weight: 1300 },
  { name: "Hasil pengamatan", pattern: /\b(?:hasil pengamatan|hasil praktikum|hasil|results)\b/i, weight: 1000 },
  { name: "Pembahasan", pattern: /\b(?:pembahasan|discussion)\b/i, weight: 3400 },
  { name: "Kesimpulan", pattern: /\b(?:kesimpulan|conclusion)\b/i, weight: 500 },
];

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

function explicitLength(question: string): AnswerLengthPlan["explicit"] {
  // Only output-length units, never quantities such as 500 mg or a citation year.
  const match = question.match(/\b(?:(maksimal|max(?:imum)?|paling banyak|tidak lebih dari|at most)\s+)?(\d{1,3}(?:[.,]\d{3})+|\d{1,6})\s*(karakter|characters?|kata|words?|kalimat|sentences?)\b/i);
  if (!match) return null;
  const unit = /karakter|character/i.test(match[3]) ? "characters" : /kata|word/i.test(match[3]) ? "words" : "sentences";
  const amount = clamp(Number(match[2].replace(/[.,]/g, "")), 1, unit === "sentences" ? 100 : 100000);
  return { unit, amount, maximum: Boolean(match[1]) };
}

/** Cheap sizing fallback. The answering AI makes the semantic sizing decision in the prompt. */
export function planAnswerLength(question: string, effort: AiEffort = "none"): AnswerLengthPlan {
  const text = String(question || "").trim().slice(0, 12000);
  const sections = reportSections.filter(section => section.pattern.test(text));
  const writingRequest = /\b(?:buat(?:kan)?|susun(?:kan)?|tulis(?:kan)?|hasilkan|write|draft|prepare)\b/i.test(text);
  const documentRequest = writingRequest && /\b(?:laporan|makalah|proposal|artikel|esai|essay|report|monografi|monograph)\b/i.test(text);
  const complete = /\b(?:utuh|lengkap|komprehensif|full|complete)\b/i.test(text);
  const concise = /\b(?:singkat|ringkas|padat|brief|concise)\b/i.test(text);
  const detailed = /\b(?:secara|dengan|jelaskan|uraikan|bahas)\s+(?:sangat\s+)?(?:rinci|detail|mendalam|lengkap|panjang)\b/i.test(text);
  const greeting = /^(?:hai|halo|hi|hello|apa kabar|terima kasih|makasih|tes|test|ping)[.!? ]*$/i.test(text);
  const factual = /^(?:apa itu|apa arti|apa kepanjangan|berapa|siapa|kapan|di mana|dimana|what is|who|when)\b/i.test(text);
  const analytical = /\b(?:bandingkan|perbandingan|analisis|evaluasi|pro kontra|kelebihan.*kekurangan|compare|analy[sz]e)\b/i.test(text);
  let kind: AnswerLengthPlan["kind"] = "explanation";
  let target = 1800;
  let selectedSections = sections;
  if (greeting || (factual && !detailed && !analytical)) { kind = "brief"; target = greeting ? 180 : 550; }
  if (analytical || detailed) { kind = "analysis"; target = detailed ? 5000 : 3500; }
  if (documentRequest || (writingRequest && sections.length >= 4)) {
    kind = "document";
    if (complete && !sections.length && /\b(?:laporan|report)\b/i.test(text)) selectedSections = reportSections;
    target = selectedSections.length
      ? selectedSections.reduce((total, section) => total + section.weight, 700)
      : complete ? 12000 : 6000;
  }
  const list = text.match(/\b(\d{1,2})\s+(?:contoh|poin|langkah|resep|formula|model|examples?|steps?)\b/i);
  if (list) target = Math.max(target, clamp(Number(list[1]), 1, 30) * 350);
  if (concise) target = kind === "document" ? Math.min(3200, Math.max(1500, selectedSections.length * 300)) : 650;
  const explicit = explicitLength(text);
  if (explicit) target = explicit.amount * (explicit.unit === "words" ? 6 : explicit.unit === "sentences" ? 160 : 1);
  target = clamp(Math.round(target), 1, 48000);
  const min = explicit?.maximum ? 1 : Math.max(1, Math.round(target * (explicit ? 0.9 : 0.65)));
  const max = explicit ? target : Math.min(48000, Math.round(target * 1.4));
  // Characters are not tokens. Reserve conservative Indonesian text capacity plus reasoning headroom.
  const reasoning = /^(?:high|xhigh|max)$/.test(effort) ? 4096 : /^(?:medium|dynamic)$/.test(effort) ? 2048 : 512;
  return {
    kind, minCharacters: min, targetCharacters: target, maxCharacters: max,
    sections: selectedSections.map(section => section.name), explicit,
    responseLength: target < 1100 ? "short" : target >= 4000 ? "long" : "medium",
    maxOutputTokens: clamp(Math.ceil((max / 2 + reasoning + 512) / 512) * 512, 1536, 32768),
  };
}

export function answerLengthInstruction(plan: AnswerLengthPlan) {
  return [
    "PANJANG JAWABAN ADAPTIF — berlaku untuk jawaban final, bukan panjang catatan agen:",
    "Sebelum menulis, prediksi kebutuhan panjang dari maksud user, jumlah bagian/subpertanyaan, tingkat detail, dan bukti yang tersedia. Jangan tampilkan rencana atau hitungan internal.",
    `Perkiraan awal aplikasi: ${plan.minCharacters}–${plan.maxCharacters} karakter, pusat sekitar ${plan.targetCharacters} karakter (termasuk spasi). Ini panduan, BUKAN kuota yang harus dihabiskan atau batas potong teks.`,
    plan.explicit
      ? `User meminta ${plan.explicit.maximum ? "maksimal " : "sekitar "}${plan.explicit.amount} ${plan.explicit.unit === "words" ? "kata" : plan.explicit.unit === "sentences" ? "kalimat" : "karakter"}. Instruksi eksplisit ini mengalahkan perkiraan awal; hormati satuannya, bukan konversi perkiraan aplikasi.`
      : "AI boleh menyesuaikan perkiraan ke atas/bawah bila kebutuhan semantik berbeda. Selesai ketika semua kebutuhan terpenuhi; jangan memanjangkan dengan repetisi atau memadatkan sampai ada bagian penting yang hilang.",
    plan.sections.length ? `Bagian yang perlu tercakup sesuai permintaan: ${plan.sections.join("; ")}. Bagi panjang secara proporsional; dasar teori/pembahasan biasanya lebih kaya daripada alat–bahan/kesimpulan. Hormati urutan/format khusus user.` : "Pertanyaan sederhana cukup inti jawaban. Analisis atau dokumen lengkap harus memiliki penjelasan yang memadai, bukan sekadar outline.",
    "Simple/Instant/Medium/High menentukan kedalaman pemeriksaan, bukan panjang wajib. High boleh singkat; Instant boleh panjang bila user meminta dokumen utuh.",
    "Jangan mengarang angka hasil pengamatan, prosedur yang diklaim dilakukan, atau referensi untuk memenuhi panjang. Jika data belum diberikan, tandai belum tersedia; contoh hipotetis harus jelas berlabel dan bukan hasil nyata.",
    "Pertahankan sitasi valid dan bagian referensi bila diperlukan. Jangan mengorbankan keselamatan/ketepatan hanya demi target karakter. Jangan menyebut anggaran token atau detail pengaturan internal kepada user.",
  ].join("\n");
}

export function answerLengthStatus(plan: AnswerLengthPlan, answer: string, finishReason?: string) {
  const truncated = /^(?:MAX_TOKENS|max_tokens|length|max_output_tokens)$/i.test(finishReason || "");
  return { strategy: "adaptive", kind: plan.kind, estimatedCharacters: plan.targetCharacters,
    actualCharacters: Array.from(answer).length, requestedSections: plan.sections, truncated };
}

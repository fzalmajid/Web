/** Provider thought summaries are not user-facing answers. */
export function visibleAnswerParts(parts: Array<{text?: string; thought?: boolean}> = []) {
  return parts.filter(part => part.thought !== true && typeof part.text === "string")
    .map(part => part.text).join("").trim();
}

/** Conservative recovery trigger, not a regex that deletes sentences from answers. */
export function planningOnlyAnswer(text: string) {
  const clean = text.trim();
  return /^(?:Let's (?:write|draft|answer)|Let me (?:plan|draft)|I (?:need|should|will) (?:to )?(?:write|draft|answer))/i.test(clean)
    || (/(?:Let's write|we (?:read|need to cite) the (?:raw text|abstract))/i.test(clean)
      && /abstract mentions|raw text snippet/i.test(clean)
      && !/^(?:#{1,6}\s|\*[^\n]+\*\s*$)/m.test(clean));
}

export function claimSupportInstruction() {
  return "\n\nKESESUAIAN KLAIM DAN SUMBER: pilih sumber menurut fungsi klaim, bukan kemiripan kata pada judul. Definisi/klasifikasi memerlukan sumber yang benar-benar menjelaskannya; paper aplikasi kamus, inventaris atau perangkat lunak bukan sumber utama definisi bidang. Kondisi eksperimen (suhu, durasi, kadar air, dosis atau konsentrasi) hanya berlaku pada sampel dan metode penelitian itu. Jangan mengubah kondisi eksperimen menjadi standar umum, syarat resmi, batas aman atau anjuran untuk semua spesies/populasi. Angka dalam pendahuluan atau referensi sekunder bukan otomatis hasil penelitian tersebut. Jika standar belum tersedia, nyatakan belum ditemukan; jangan menciptakan batas. Setiap klaim harus cocok dengan bagian sumber yang tersedia; metadata saja tidak mendukung hasil, dan abstrak tidak membuktikan prosedur rinci. Catatan agen adalah saran yang harus diperiksa kembali, bukan fakta atau konsensus independen. Jawaban final harus dalam bahasa user dan bukan catatan penyusunan/rencana internal.";
}

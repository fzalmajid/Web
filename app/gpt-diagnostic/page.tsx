"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type TestResult = {
  ok?: boolean;
  error?: string;
  classification?: string;
  providerCode?: string | null;
  providerType?: string | null;
  httpStatus?: number;
  requestId?: string | null;
  model?: string;
};

export default function GptDiagnosticPage() {
  const [models, setModels] = useState<string[]>([]);
  const [selected, setSelected] = useState("");
  const [message, setMessage] = useState("Tes dilakukan dengan API key yang sudah tersambung di browser ini.");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      const value = JSON.parse(String(window.sessionStorage.getItem("rb-openai-models") || "[]"));
      const available: string[] = Array.isArray(value)
        ? value.map(String).filter((id: string) => /^gpt-/i.test(id) && !/audio|realtime|transcribe|tts|image|embedding/i.test(id))
        : [];
      setModels(available);
      const first = ["gpt-4.1-mini", "gpt-4o-mini", "gpt-5.6-luna", "gpt-5.5"]
        .find((id) => available.includes(id)) || available[0] || "";
      setSelected(first);
    } catch {
      setModels([]);
      setSelected("");
    }
  }, []);

  async function runTest() {
    setBusy(true);
    setMessage("Memeriksa izin GPT dan batas API menggunakan satu permintaan kecil...");
    try {
      const key = String(window.sessionStorage.getItem("rb-user-openai-key") || "").trim();
      const { data: auth, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !auth.session) {
        setMessage("Sesi login Ruang Belajar tidak ditemukan. Login kembali terlebih dahulu.");
        return;
      }
      if (!key || !selected) {
        setMessage("Hubungkan OpenAI terlebih dahulu melalui + Plugin di halaman Ruang Belajar, kemudian buka kembali tes ini di tab/browser yang sama.");
        return;
      }
      const response = await fetch("/api/test-openai-key", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + auth.session.access_token,
          "X-RB-OpenAI-Key": key,
        },
        body: JSON.stringify({ model: selected }),
      });
      const result = await response.json().catch(() => ({})) as TestResult;
      if (response.ok && result.ok) {
        setMessage("BERHASIL: GPT " + selected + " menerima permintaan API nyata. Jika chat biasa gagal, periksa batas output token, model yang dipilih, dan pencarian Database.");
      } else {
        setMessage("DITOLAK: " + String(result.error || "OpenAI tidak menerima tes.") +
          " · HTTP " + (result.httpStatus || response.status) +
          (result.providerCode ? " · Kode API: " + result.providerCode : "") +
          (result.classification ? " · Jenis: " + result.classification : "") +
          (result.requestId ? " · Request ID: " + result.requestId : ""));
      }
    } catch {
      setMessage("Tes tidak selesai karena koneksi. Belum ada kesimpulan tentang saldo atau kuota.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 680, margin: "6vh auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1>Uji Koneksi GPT</h1>
      <p>Periksa apakah API key dari browser Ruang Belajar dapat menjalankan GPT, bukan hanya menampilkan daftar model. Tidak ada API key yang ditampilkan atau disimpan oleh halaman ini.</p>
      <label htmlFor="gpt-model-test">Model yang diuji</label>
      <select id="gpt-model-test" value={selected} onChange={(event) => setSelected(event.target.value)}
        disabled={busy || !models.length} style={{ display: "block", width: "100%", padding: 12, marginTop: 8, marginBottom: 16 }}>
        {!models.length && <option value="">Belum ada model. Hubungkan API di + Plugin.</option>}
        {models.map((model) => <option key={model} value={model}>{model}</option>)}
      </select>
      <button type="button" onClick={runTest} disabled={busy || !selected}
        style={{ padding: "12px 18px", borderRadius: 10, cursor: busy ? "wait" : "pointer" }}>
        {busy ? "Menguji GPT..." : "Jalankan tes GPT kecil"}
      </button>
      <p role="status" aria-live="polite" style={{ padding: 16, border: "1px solid #777", borderRadius: 10, marginTop: 24, overflowWrap: "anywhere" }}>{message}</p>
      <p>Tes dapat menggunakan sedikit kredit API OpenAI. Jika mendapat HTTP 429, kode API akan membedakan rate limit, saldo kredit, atau batas proyek bila provider mengirimkan detailnya.</p>
      <a href="/">Kembali ke Ruang Belajar</a>
    </main>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type ApiCheck = { valid?: boolean; availableModels?: string[]; error?: string };
type TestResult = {
  ok?: boolean;
  error?: string;
  classification?: string;
  providerCode?: string | null;
  httpStatus?: number;
  requestId?: string | null;
};

function usableModels(models: unknown): string[] {
  if (!Array.isArray(models)) return [];
  return Array.from(new Set(models.map(String).filter((id) =>
    /^gpt-/i.test(id) && !/audio|realtime|transcribe|tts|image|embedding|search-preview/i.test(id)
  )));
}

function preferredModel(models: string[]): string {
  return ["gpt-4.1-mini", "gpt-4o-mini", "gpt-5.6-luna", "gpt-5.5"].find((id) =>
    models.includes(id)
  ) || models[0] || "";
}

export default function GptDiagnosticPage() {
  const [models, setModels] = useState<string[]>([]);
  const [selected, setSelected] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [connected, setConnected] = useState(false);
  const [message, setMessage] = useState("Memeriksa koneksi GPT pada tab ini...");
  const [busy, setBusy] = useState(false);

  const checkModels = useCallback(async (candidate: string, save: boolean) => {
    const { data: auth, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !auth.session) {
      setMessage("Login ke Ruang Belajar dahulu, lalu kembali ke halaman ini.");
      return;
    }
    const response = await fetch("/api/check-openai-key", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + auth.session.access_token,
        "X-RB-OpenAI-Key": candidate
      },
      body: "{}"
    });
    const result = await response.json().catch(() => ({})) as ApiCheck;
    if (!response.ok || !result.valid) {
      setMessage(result.error || "Kunci OpenAI tidak dapat diverifikasi.");
      return;
    }
    const available = usableModels(result.availableModels);
    if (!available.length) {
      setMessage("Kunci dikenali, tetapi proyek API tidak memiliki model GPT yang dapat diuji.");
      return;
    }
    if (save) {
      // Only this app origin and this browser tab hold the key. Never store it
      // in Supabase, GitHub, Vercel env, URL, or a cross-account cache.
      window.sessionStorage.setItem("rb-user-openai-key", candidate);
      window.sessionStorage.setItem("rb-openai-models", JSON.stringify(result.availableModels || []));
    }
    setModels(available);
    setSelected((previous) => available.includes(previous) ? previous : preferredModel(available));
    setConnected(true);
    setKeyInput("");
    setMessage("Kunci GPT dikenali di Ruang Belajar pada tab ini. Daftar model tersedia; klik tes kecil untuk memeriksa apakah inferensi benar-benar bisa berjalan.");
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const key = String(window.sessionStorage.getItem("rb-user-openai-key") || "").trim();
      if (!key) {
        if (mounted) setMessage("Belum ada API key pada tab Ruang Belajar ini. Koneksi ChatGPT atau tab lain tidak otomatis tersambung ke situs. Tempel kunci baru di kolom di bawah untuk menghubungkannya langsung di situs.");
        return;
      }
      try {
        if (mounted) await checkModels(key, false);
      } catch {
        if (mounted) setMessage("Kunci ada di tab ini, tetapi verifikasi model gagal. Periksa koneksi lalu coba lagi.");
      }
    })();
    return () => { mounted = false; };
  }, [checkModels]);

  async function connect() {
    const candidate = keyInput.trim();
    if (!candidate) {
      setMessage("Tempel OpenAI API key di kolom aplikasi ini. Jangan kirim ke chat.");
      return;
    }
    setBusy(true);
    setMessage("Memeriksa kunci dan daftar model GPT...");
    try {
      await checkModels(candidate, true);
    } catch {
      setMessage("Koneksi OpenAI tidak selesai. Periksa jaringan, lalu ulangi.");
    } finally {
      setBusy(false);
    }
  }

  async function runTest() {
    setBusy(true);
    setMessage("Mengirim satu pertanyaan kecil ke GPT...");
    try {
      const key = String(window.sessionStorage.getItem("rb-user-openai-key") || "").trim();
      const { data: auth, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !auth.session) {
        setMessage("Sesi login Ruang Belajar habis. Login kembali.");
        return;
      }
      if (!key || !selected) {
        setMessage("Hubungkan API key dan pilih model pada halaman ini terlebih dahulu.");
        return;
      }
      const response = await fetch("/api/test-openai-key", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + auth.session.access_token,
          "X-RB-OpenAI-Key": key
        },
        body: JSON.stringify({ model: selected })
      });
      const result = await response.json().catch(() => ({})) as TestResult;
      setMessage(response.ok && result.ok
        ? "BERHASIL: GPT " + selected + " menjawab permintaan kecil. API key dan akses inferensi aktif. Kembali ke Ruang Belajar pada tab yang sama untuk memilih GPT di Choose Model."
        : "DITOLAK: " + String(result.error || "OpenAI tidak menerima tes.") +
          " · HTTP " + (result.httpStatus || response.status) +
          (result.providerCode ? " · Kode API: " + result.providerCode : "") +
          (result.classification ? " · Jenis: " + result.classification : "") +
          (result.requestId ? " · Request ID: " + result.requestId : ""));
    } catch {
      setMessage("Tes gagal karena koneksi atau batas waktu. Status saldo API belum dapat dipastikan.");
    } finally {
      setBusy(false);
    }
  }

  function disconnect() {
    window.sessionStorage.removeItem("rb-user-openai-key");
    window.sessionStorage.removeItem("rb-openai-models");
    setConnected(false);
    setModels([]);
    setSelected("");
    setMessage("Kunci GPT sudah diputus dari tab situs ini.");
  }

  return (
    <main style={{ maxWidth: 720, margin: "5vh auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1>Uji Koneksi GPT</h1>
      <p>Halaman ini terhubung dengan <strong>Ruang Belajar Pribadi</strong>, bukan dengan plugin ChatGPT. API key yang ditambahkan di akun ChatGPT atau tab lain tidak otomatis tersedia di situs.</p>
      <section style={{ padding: 18, border: "1px solid #aaa", borderRadius: 12, marginBottom: 22 }}>
        <h2>1. Hubungkan GPT ke situs</h2>
        <label htmlFor="api-key-site">OpenAI API key — hanya dipakai dalam tab ini</label>
        <input id="api-key-site" type="password" autoComplete="off" value={keyInput}
          onChange={(event) => setKeyInput(event.target.value)}
          placeholder={connected ? "Sudah terhubung; isi untuk mengganti kunci" : "Tempel secret API key baru di sini"}
          style={{ display: "block", width: "100%", boxSizing: "border-box", padding: 12, marginTop: 8, marginBottom: 14 }}/>
        <button type="button" onClick={connect} disabled={busy || !keyInput.trim()}
          style={{ padding: "12px 18px", borderRadius: 9 }}>
          {busy ? "Memeriksa..." : connected ? "Periksa / ganti kunci" : "Hubungkan ke Ruang Belajar"}
        </button>
        {connected && <button type="button" onClick={disconnect} disabled={busy}
          style={{ padding: "12px 18px", borderRadius: 9, marginLeft: 10 }}>Putuskan</button>}
        <p style={{ fontSize: 13 }}>Kunci tidak dikirim ke ChatGPT atau disimpan di database situs. Koneksi ini berlaku pada tab browser yang sama; tab baru mungkin perlu dihubungkan lagi. Gunakan kunci baru jika kunci sebelumnya pernah dibagikan di chat.</p>
      </section>

      <section style={{ padding: 18, border: "1px solid #aaa", borderRadius: 12 }}>
        <h2>2. Tes pertanyaan GPT kecil</h2>
        <label htmlFor="gpt-model-test">Model yang diuji</label>
        <select id="gpt-model-test" value={selected} onChange={(event) => setSelected(event.target.value)}
          disabled={busy || !models.length} style={{ display: "block", width: "100%", padding: 12, marginTop: 8, marginBottom: 16 }}>
          {!models.length && <option value="">Belum ada model; hubungkan API key pada langkah 1.</option>}
          {models.map((model) => <option key={model} value={model}>{model}</option>)}
        </select>
        <button type="button" onClick={runTest} disabled={busy || !selected}
          style={{ padding: "12px 18px", borderRadius: 9 }}>
          {busy ? "Menguji..." : "Jalankan tes GPT kecil"}
        </button>
        <p role="status" aria-live="polite" style={{ padding: 16, border: "1px solid #777", borderRadius: 10, marginTop: 24, overflowWrap: "anywhere" }}>{message}</p>
        <p>Tes menggunakan sedikit kredit API. Jika ditolak, kode HTTP dan kode OpenAI membantu membedakan masalah kredit, izin model, dan rate limit.</p>
      </section>
      <p><a href="/">Kembali ke Ruang Belajar di tab yang sama</a></p>
    </main>
  );
}

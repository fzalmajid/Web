"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

type Material = {
  id: string;
  title: string;
  category: string;
  content: string;
  source_type: "manual" | "transcript";
  created_at: string;
};

type Recording = {
  id: string;
  title: string;
  file_path: string;
  mime_type: string;
  duration_seconds: number;
  transcript: string | null;
  created_at: string;
};

type Flashcard = { id: string; front: string; back: string; material_id: string | null };
type Quiz = { id: string; question: string; choices: string[]; correct_answer: string; explanation: string; material_id: string | null };

const tabs = ["Beranda", "Materi", "Rekam", "Tanya AI", "Latihan"] as const;
type Tab = (typeof tabs)[number];

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    return () => subscription.unsubscribe();
  }, []);

  if (loading) return <main className="center"><div className="loader">Memuat Ruang Belajar...</div></main>;
  if (!session) return <Auth />;
  return <Dashboard session={session} user={session.user} />;
}

function Auth() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");

    const result = mode === "login"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password });

    if (result.error) setMessage(result.error.message);
    else if (mode === "signup" && !result.data.session) {
      setMessage("Akun dibuat. Cek email untuk konfirmasi jika diminta.");
    }
    setBusy(false);
  }

  return (
    <main className="authShell">
      <section className="authCard">
        <div className="brandMark">RB</div>
        <p className="eyebrow">DATABASE-ONLY STUDY SPACE</p>
        <h1>Ruang Belajar</h1>
        <p className="muted">Simpan materi, rekam penjelasan, lalu belajar hanya dari database milikmu.</p>
        <form onSubmit={submit} className="stack">
          <label>Email<input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="nama@email.com" /></label>
          <label>Password<input type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)} placeholder="Minimal 6 karakter" /></label>
          <button className="primary" disabled={busy}>{busy ? "Memproses..." : mode === "login" ? "Masuk" : "Buat akun"}</button>
        </form>
        {message && <div className="notice">{message}</div>}
        <button className="textBtn" onClick={() => setMode(mode === "login" ? "signup" : "login")}>
          {mode === "login" ? "Belum punya akun? Daftar" : "Sudah punya akun? Masuk"}
        </button>
      </section>
    </main>
  );
}

function Dashboard({ session, user }: { session: Session; user: User }) {
  const [tab, setTab] = useState<Tab>("Beranda");
  const [materials, setMaterials] = useState<Material[]>([]);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    void loadAll();
  }, [refreshKey]);

  async function loadAll() {
    const [m, r, f, q] = await Promise.all([
      supabase.from("materials").select("*").order("created_at", { ascending: false }),
      supabase.from("recordings").select("*").order("created_at", { ascending: false }),
      supabase.from("flashcards").select("*").order("created_at", { ascending: false }),
      supabase.from("quizzes").select("*").order("created_at", { ascending: false }),
    ]);
    setMaterials((m.data || []) as Material[]);
    setRecordings((r.data || []) as Recording[]);
    setCards((f.data || []) as Flashcard[]);
    setQuizzes((q.data || []) as Quiz[]);
  }

  return (
    <div className="appShell">
      <header className="topbar">
        <div><p className="eyebrow">RUANG BELAJAR</p><h1>Belajar dari datamu sendiri.</h1></div>
        <div className="headerActions">
          <span className="userPill">{user.email}</span>
          <button className="ghost" onClick={() => supabase.auth.signOut()}>Keluar</button>
        </div>
      </header>

      <nav className="tabs">
        {tabs.map(item => <button key={item} className={tab === item ? "tab active" : "tab"} onClick={() => setTab(item)}>{item}</button>)}
      </nav>

      <main className="content">
        {tab === "Beranda" && <Overview materials={materials} recordings={recordings} cards={cards} quizzes={quizzes} setTab={setTab} />}
        {tab === "Materi" && <Materials user={user} materials={materials} onChange={() => setRefreshKey(x => x + 1)} />}
        {tab === "Rekam" && <Recorder session={session} user={user} recordings={recordings} onChange={() => setRefreshKey(x => x + 1)} />}
        {tab === "Tanya AI" && <Ask session={session} />}
        {tab === "Latihan" && <Study session={session} materials={materials} cards={cards} quizzes={quizzes} onChange={() => setRefreshKey(x => x + 1)} />}
      </main>
    </div>
  );
}

function Overview({ materials, recordings, cards, quizzes, setTab }: any) {
  return (
    <>
      <section className="hero card">
        <div>
          <p className="eyebrow">PRIVATE STUDY LIBRARY</p>
          <h2>Catat. Rekam. Tanya. Uji diri.</h2>
          <p className="muted">AI hanya diberi materi yang ditemukan di database akunmu. Jika tidak ada sumber, sistem berhenti.</p>
        </div>
        <div className="stats">
          <Stat n={materials.length} t="Materi" />
          <Stat n={recordings.length} t="Rekaman" />
          <Stat n={cards.length} t="Flashcard" />
          <Stat n={quizzes.length} t="Soal" />
        </div>
      </section>
      <section className="grid3">
        <Shortcut title="Tambah materi" body="Tulis atau tempel catatan belajar." onClick={() => setTab("Materi")} />
        <Shortcut title="Rekam penjelasan" body="Simpan audio dan ubah menjadi transcript." onClick={() => setTab("Rekam")} />
        <Shortcut title="Tanya database" body="Gunakan AI hanya dengan sumber milikmu." onClick={() => setTab("Tanya AI")} />
      </section>
    </>
  );
}

function Stat({ n, t }: { n: number; t: string }) {
  return <div><strong>{n}</strong><span>{t}</span></div>;
}

function Shortcut({ title, body, onClick }: { title: string; body: string; onClick: () => void }) {
  return <article className="card shortcut"><h3>{title}</h3><p className="muted">{body}</p><button className="primary" onClick={onClick}>Buka</button></article>;
}

function Materials({ user, materials, onChange }: { user: User; materials: Material[]; onChange: () => void }) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [content, setContent] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);

  const filtered = materials.filter(m => (m.title + " " + m.category + " " + m.content).toLowerCase().includes(search.toLowerCase()));

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.from("materials").insert({
      user_id: user.id,
      title,
      category,
      content,
      source_type: "manual",
    });
    setBusy(false);
    if (error) return alert(error.message);
    setTitle("");
    setCategory("");
    setContent("");
    onChange();
  }

  async function remove(id: string) {
    if (!confirm("Hapus materi ini?")) return;
    const { error } = await supabase.from("materials").delete().eq("id", id);
    if (error) alert(error.message);
    else onChange();
  }

  return (
    <section className="split">
      <article className="card">
        <p className="eyebrow">INPUT DATABASE</p>
        <h2>Tambah materi</h2>
        <form onSubmit={save} className="stack">
          <label>Judul<input required value={title} onChange={e => setTitle(e.target.value)} placeholder="Contoh: Sistem pernapasan" /></label>
          <label>Kategori<input value={category} onChange={e => setCategory(e.target.value)} placeholder="Biologi" /></label>
          <label>Isi<textarea required rows={12} value={content} onChange={e => setContent(e.target.value)} placeholder="Masukkan materi lengkap..." /></label>
          <button className="primary" disabled={busy}>{busy ? "Menyimpan..." : "Simpan ke Database"}</button>
        </form>
      </article>

      <article className="card">
        <div className="sectionHead">
          <div><p className="eyebrow">LIBRARY</p><h2>Materi tersimpan</h2></div>
          <input className="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Cari..." />
        </div>
        <div className="list">
          {filtered.length ? filtered.map(m => (
            <div className="item" key={m.id}>
              <div className="itemTop">
                <div><h3>{m.title}</h3><small>{m.category || "Tanpa kategori"} - {m.source_type === "transcript" ? "Transcript" : "Manual"}</small></div>
                <button className="danger" onClick={() => remove(m.id)}>Hapus</button>
              </div>
              <p>{m.content.length > 360 ? m.content.slice(0, 360) + "..." : m.content}</p>
            </div>
          )) : <p className="muted">Belum ada materi.</p>}
        </div>
      </article>
    </section>
  );
}

function Recorder({ session, user, recordings, onChange }: { session: Session; user: User; recordings: Recording[]; onChange: () => void }) {
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedRef = useRef(0);
  const elapsedRef = useRef(0);
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState("Siap merekam");
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => {
      const value = Math.floor((Date.now() - startedRef.current) / 1000);
      elapsedRef.current = value;
      setElapsed(value);
    }, 500);
    return () => clearInterval(id);
  }, [recording]);

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      recRef.current = rec;
      rec.ondataavailable = event => { if (event.data.size) chunksRef.current.push(event.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        await processRecording(blob);
      };
      startedRef.current = Date.now();
      elapsedRef.current = 0;
      setElapsed(0);
      rec.start();
      setRecording(true);
      setStatus("Sedang merekam...");
    } catch (error: any) {
      alert(error.message);
    }
  }

  function stop() {
    recRef.current?.stop();
    setRecording(false);
    setStatus("Memproses rekaman...");
  }

  async function processRecording(blob: Blob) {
    setBusy(true);
    const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
    const path = `${user.id}/${crypto.randomUUID()}.${ext}`;

    const upload = await supabase.storage.from("recordings").upload(path, blob, { contentType: blob.type || "audio/webm" });
    if (upload.error) {
      setBusy(false);
      setStatus("Gagal upload");
      return alert(upload.error.message);
    }

    const { data: row, error } = await supabase.from("recordings").insert({
      user_id: user.id,
      title: `Rekaman ${new Date().toLocaleString("id-ID")}`,
      file_path: path,
      mime_type: blob.type || "audio/webm",
      duration_seconds: elapsedRef.current,
    }).select("*").single();

    if (error) {
      setBusy(false);
      return alert(error.message);
    }

    const fd = new FormData();
    fd.append("audio", new File([blob], `recording.${ext}`, { type: blob.type || "audio/webm" }));

    const response = await fetch("/api/transcribe", {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}` },
      body: fd,
    });
    const result = await response.json();

    if (response.ok && result.transcript) {
      await supabase.from("recordings").update({ transcript: result.transcript }).eq("id", row.id);
      await supabase.from("materials").insert({
        user_id: user.id,
        title: `Transcript ${new Date().toLocaleString("id-ID")}`,
        category: "Transcript",
        content: result.transcript,
        source_type: "transcript",
      });
      setStatus("Rekaman + transcript tersimpan");
    } else {
      setStatus("Audio tersimpan, transcript belum berhasil");
    }

    setBusy(false);
    onChange();
  }

  async function play(r: Recording) {
    const { data, error } = await supabase.storage.from("recordings").createSignedUrl(r.file_path, 600);
    if (error) return alert(error.message);
    window.open(data.signedUrl, "_blank");
  }

  return (
    <section className="split">
      <article className="card">
        <p className="eyebrow">VOICE NOTES</p>
        <h2>Rekam & transkrip</h2>
        <p className="muted">Audio disimpan private di Supabase. Gemini mengubah suara menjadi transcript, lalu transcript otomatis masuk ke database materi.</p>
        <div className="recPanel">
          <span className={recording ? "dot live" : "dot"} />
          <div><strong>{status}</strong><p>{String(Math.floor(elapsed / 60)).padStart(2, "0")}:{String(elapsed % 60).padStart(2, "0")}</p></div>
        </div>
        <div className="row">
          <button className="primary" disabled={recording || busy} onClick={start}>Mulai Rekam</button>
          <button className="danger" disabled={!recording} onClick={stop}>Stop</button>
        </div>
        {busy && <div className="notice">Sedang upload dan membuat transcript...</div>}
      </article>

      <article className="card">
        <p className="eyebrow">PRIVATE AUDIO</p>
        <h2>Rekaman tersimpan</h2>
        <div className="list">
          {recordings.length ? recordings.map(r => (
            <div className="item" key={r.id}>
              <h3>{r.title}</h3>
              <small>{Math.floor(r.duration_seconds / 60)}m {r.duration_seconds % 60}s</small>
              {r.transcript && <p>{r.transcript.length > 260 ? r.transcript.slice(0, 260) + "..." : r.transcript}</p>}
              <button className="ghost" onClick={() => play(r)}>Putar audio</button>
            </div>
          )) : <p className="muted">Belum ada rekaman.</p>}
        </div>
      </article>
    </section>
  );
}

function Ask({ session }: { session: Session }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<Array<{ id: string; title: string; category: string }>>([]);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setAnswer("");
    setSources([]);

    const response = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ question }),
    });

    const result = await response.json();
    setBusy(false);

    if (!response.ok) return setAnswer(result.error || "Terjadi kesalahan.");
    setAnswer(result.answer);
    setSources(result.sources || []);
  }

  return (
    <article className="card askCard">
      <p className="eyebrow">STRICT DATABASE MODE</p>
      <h2>Tanya AI</h2>
      <p className="muted">Sistem mencari database dulu. Jika tidak ada materi yang cocok, AI tidak dipanggil.</p>
      <form className="askForm" onSubmit={submit}>
        <input required minLength={3} value={question} onChange={e => setQuestion(e.target.value)} placeholder="Tanyakan sesuatu dari materi..." />
        <button className="primary" disabled={busy}>{busy ? "Mencari..." : "Tanya"}</button>
      </form>
      <div className="answer">{answer || "Belum ada pertanyaan."}</div>
      {!!sources.length && <div className="sources"><strong>Sumber database:</strong>{sources.map(s => <span key={s.id}>{s.title}{s.category ? ` - ${s.category}` : ""}</span>)}</div>}
    </article>
  );
}

function Study({ session, materials, cards, quizzes, onChange }: { session: Session; materials: Material[]; cards: Flashcard[]; quizzes: Quiz[]; onChange: () => void }) {
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [flipped, setFlipped] = useState<Record<string, boolean>>({});
  const [answers, setAnswers] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!selected && materials[0]) setSelected(materials[0].id);
  }, [materials, selected]);

  async function generate() {
    if (!selected) return alert("Pilih materi dulu.");
    setBusy(true);

    const response = await fetch("/api/generate-study", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ materialId: selected }),
    });

    const result = await response.json();
    setBusy(false);

    if (!response.ok) return alert(result.error || "Gagal membuat latihan.");
    onChange();
    alert(`Dibuat ${result.flashcards} flashcard dan ${result.quizzes} soal.`);
  }

  const visibleCards = cards.filter(x => !selected || x.material_id === selected);
  const visibleQuizzes = quizzes.filter(x => !selected || x.material_id === selected);

  return (
    <>
      <article className="card studyHead">
        <div><p className="eyebrow">AI STUDY TOOLS</p><h2>Flashcard & kuis</h2></div>
        <div className="row">
          <select value={selected} onChange={e => setSelected(e.target.value)}>
            <option value="">Pilih materi</option>
            {materials.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
          </select>
          <button className="primary" onClick={generate} disabled={busy || !selected}>{busy ? "Membuat..." : "Buat dari Materi"}</button>
        </div>
      </article>

      <section className="split">
        <article className="card">
          <h2>Flashcard</h2>
          <div className="cards">
            {visibleCards.length ? visibleCards.map(card => (
              <button key={card.id} className="flash" onClick={() => setFlipped(value => ({ ...value, [card.id]: !value[card.id] }))}>
                <small>{flipped[card.id] ? "JAWABAN" : "PERTANYAAN"}</small>
                <strong>{flipped[card.id] ? card.back : card.front}</strong>
                <span>Ketuk untuk balik</span>
              </button>
            )) : <p className="muted">Belum ada flashcard untuk materi ini.</p>}
          </div>
        </article>

        <article className="card">
          <h2>Kuis</h2>
          <div className="list">
            {visibleQuizzes.length ? visibleQuizzes.map(quiz => (
              <div className="item quiz" key={quiz.id}>
                <h3>{quiz.question}</h3>
                {quiz.choices.map(choice => (
                  <button key={choice} onClick={() => setAnswers(value => ({ ...value, [quiz.id]: choice }))} className={answers[quiz.id] === choice ? "choice selected" : "choice"}>{choice}</button>
                ))}
                {answers[quiz.id] && (
                  <div className={answers[quiz.id] === quiz.correct_answer ? "result ok" : "result bad"}>
                    {answers[quiz.id] === quiz.correct_answer ? "Benar" : "Belum tepat"} - Jawaban: {quiz.correct_answer}<br />{quiz.explanation}
                  </div>
                )}
              </div>
            )) : <p className="muted">Belum ada kuis untuk materi ini.</p>}
          </div>
        </article>
      </section>
    </>
  );
}

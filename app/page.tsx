"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

type NodeType = "material" | "submaterial" | "database" | "recording" | "flashcards" | "quiz";
type Correction = { heard: string; corrected: string; basis: string };
type StudyNode = {
  id: string;
  user_id: string;
  parent_id: string | null;
  title: string;
  node_type: NodeType;
  description: string;
  position: number;
  created_at: string;
};
type KnowledgeEntry = {
  id: string;
  user_id: string;
  node_id: string;
  title: string;
  category: string;
  content: string;
  raw_content: string | null;
  source_type: "manual" | "file" | "transcript" | "generated";
  source_file_id: string | null;
  created_at: string;
};
type SourceFile = {
  id: string;
  user_id: string;
  node_id: string;
  file_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  processing_status: "processing" | "ready" | "error";
  raw_text: string | null;
  structured_text: string | null;
  corrections: Correction[];
  error_message: string | null;
  created_at: string;
};
type Recording = {
  id: string;
  user_id: string;
  node_id: string | null;
  title: string;
  file_path: string;
  mime_type: string;
  duration_seconds: number;
  transcript: string | null;
  raw_transcript: string | null;
  structured_transcript: string | null;
  corrections: Correction[];
  knowledge_entry_id: string | null;
  created_at: string;
};
type Flashcard = {
  id: string;
  front: string;
  back: string;
  material_id: string | null;
  scope_node_id: string | null;
};
type Quiz = {
  id: string;
  question: string;
  choices: string[];
  correct_answer: string;
  explanation: string;
  material_id: string | null;
  scope_node_id: string | null;
};

const labels: Record<NodeType, string> = {
  material: "Materi",
  submaterial: "Materi",
  database: "Database",
  recording: "Rekaman",
  flashcards: "Flashcard",
  quiz: "Kuis",
};

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const result = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    const subscription = result.data.subscription;

    if ("caches" in window) {
      caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key)))).catch(() => {});
    }
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js?v=5", { updateViaCache: "none" }).then((reg) => reg.update()).catch(() => {});
    }

    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return <main className="center"><div className="loader">Memuat Ruang Belajar...</div></main>;
  }
  if (!session) return <Auth />;
  return <Workspace session={session} user={session.user} />;
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

    const result =
      mode === "login"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: window.location.origin },
          });

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
        <p className="eyebrow">PRIVATE STUDY SPACE</p>
        <h1>Ruang Belajar</h1>
        <p className="muted">Susun ruang belajar bertingkat, rekam pertemuan, simpan database, lalu tanyakan ke AI.</p>

        <form onSubmit={submit} className="stack">
          <label>
            Email
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>
            Password
            <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <button className="primary" disabled={busy}>
            {busy ? "Memproses..." : mode === "login" ? "Masuk" : "Buat akun"}
          </button>
        </form>

        {message && <div className="notice">{message}</div>}

        <button className="textBtn" onClick={() => setMode(mode === "login" ? "signup" : "login")}>
          {mode === "login" ? "Belum punya akun? Daftar" : "Sudah punya akun? Masuk"}
        </button>
      </section>
    </main>
  );
}

function Workspace({ session, user }: { session: Session; user: User }) {
  const [nodes, setNodes] = useState<StudyNode[]>([]);
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [files, setFiles] = useState<SourceFile[]>([]);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    void loadAll();
  }, [refreshKey]);

  async function loadAll() {
    const result = await Promise.all([
      supabase.from("study_nodes").select("*").order("position").order("created_at"),
      supabase.from("knowledge_entries").select("*").order("created_at", { ascending: false }),
      supabase.from("source_files").select("*").order("created_at", { ascending: false }),
      supabase.from("recordings").select("*").order("created_at", { ascending: false }),
      supabase.from("flashcards").select("*").order("created_at", { ascending: false }),
      supabase.from("quizzes").select("*").order("created_at", { ascending: false }),
    ]);

    setNodes((result[0].data || []) as StudyNode[]);
    setEntries((result[1].data || []) as KnowledgeEntry[]);
    setFiles((result[2].data || []) as SourceFile[]);
    setRecordings((result[3].data || []) as Recording[]);
    setCards((result[4].data || []) as Flashcard[]);
    setQuizzes((result[5].data || []) as Quiz[]);

    if (currentId && !(result[0].data || []).some((item: any) => item.id === currentId)) {
      setCurrentId(null);
    }
  }

  const refresh = () => setRefreshKey((value) => value + 1);
  const current = currentId ? nodes.find((node) => node.id === currentId) || null : null;
  const children = nodes.filter((node) => node.parent_id === currentId);

  const aiScopeId =
    !current
      ? null
      : current.node_type === "material" || current.node_type === "submaterial"
        ? current.id
        : current.parent_id;

  const path = useMemo(() => {
    if (!current) return [];
    const result: StudyNode[] = [];
    let cursor: StudyNode | undefined = current;
    while (cursor) {
      result.unshift(cursor);
      cursor = cursor.parent_id ? nodes.find((node) => node.id === cursor?.parent_id) : undefined;
    }
    return result;
  }, [current, nodes]);

  function goBack() {
    if (!current) return;
    setCurrentId(current.parent_id);
  }

  async function removeNode(node: StudyNode) {
    if (!confirm('Hapus "' + node.title + '" beserta semua isi di dalamnya?')) return;

    const subtree = collectSubtreeIds(nodes, node.id);
    const relatedRecordings = recordings.filter((item) => item.node_id && subtree.includes(item.node_id));
    const relatedFiles = files.filter((item) => subtree.includes(item.node_id));

    if (relatedRecordings.length) {
      const paths = relatedRecordings.map((item) => item.file_path);
      await supabase.storage.from("recordings").remove(paths);
    }
    if (relatedFiles.length) {
      const paths = relatedFiles.map((item) => item.file_path);
      await supabase.storage.from("study-files").remove(paths);
    }

    const { error } = await supabase.from("study_nodes").delete().eq("id", node.id);
    if (error) return alert(error.message);

    if (currentId === node.id) setCurrentId(node.parent_id);
    refresh();
  }

  return (
    <div className="appShell">
      <header className="topbar">
        <button className="brandButton" onClick={() => setCurrentId(null)}>
          <span className="brandMini">RB</span>
          <span>Ruang Belajar</span>
        </button>
        <div className="headerActions">
          <AiCreditBadge />
          <span className="userPill">{user.email}</span>
          <button className="ghost" onClick={() => supabase.auth.signOut()}>Keluar</button>
        </div>
      </header>

      <main className="pageShell">
        {current && (
          <div className="pageNav">
            <button className="backBtn" onClick={goBack}>←</button>
            <div className="crumbs">
              <button onClick={() => setCurrentId(null)}>Beranda</button>
              {path.map((item) => (
                <span key={item.id}>
                  <b>/</b>
                  <button onClick={() => setCurrentId(item.id)}>{item.title}</button>
                </span>
              ))}
            </div>
          </div>
        )}

        {!current || current.node_type === "material" || current.node_type === "submaterial" ? (
          <FolderPage
            current={current}
            children={children}
            onOpen={setCurrentId}
            onAdd={() => setAddOpen(true)}
            onDelete={removeNode}
          />
        ) : null}

        {current?.node_type === "database" && (
          <DatabasePage
            session={session}
            user={user}
            node={current}
            entries={entries}
            files={files}
            onChange={refresh}
          />
        )}

        {current?.node_type === "recording" && (
          <RecordingPage
            session={session}
            user={user}
            node={current}
            nodes={nodes}
            recordings={recordings}
            onChange={refresh}
          />
        )}

        {(current?.node_type === "flashcards" || current?.node_type === "quiz") && (
          <PracticePage
            session={session}
            node={current}
            cards={cards}
            quizzes={quizzes}
            onChange={refresh}
          />
        )}
      </main>

      <BottomAskBar
        session={session}
        scopeNodeId={aiScopeId}
        scopeName={current ? current.title : "Seluruh Database"}
      />

      {addOpen && (
        <AddSheet
          user={user}
          parent={current}
          onClose={() => setAddOpen(false)}
          onCreated={(id) => {
            setAddOpen(false);
            setCurrentId(id);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function FolderPage({
  current,
  children,
  onOpen,
  onAdd,
  onDelete,
}: {
  current: StudyNode | null;
  children: StudyNode[];
  onOpen: (id: string) => void;
  onAdd: () => void;
  onDelete: (node: StudyNode) => void;
}) {
  return (
    <section className="folderPage">
      <div className="folderTitle">
        <p className="eyebrow">{current ? "RUANG MATERI" : "RUANG BELAJAR"}</p>
        <h1>{current ? current.title : "Materi saya"}</h1>
      </div>

      {!!children.length && (
        <div className="nodeGrid">
          {children.map((node) => (
            <article className="nodeCard" key={node.id}>
              <button className="nodeOpen" onClick={() => onOpen(node.id)}>
                <span className="nodeIcon">{iconFor(node.node_type)}</span>
                <div>
                  <small>{labels[node.node_type]}</small>
                  <h3>{node.title}</h3>
                </div>
              </button>
              <button className="nodeDelete" onClick={() => onDelete(node)}>Hapus</button>
            </article>
          ))}
        </div>
      )}

      {!children.length && (
        <div className="emptyFolder">
          <p>Belum ada isi di halaman ini.</p>
        </div>
      )}

      <button className="bigPlus" onClick={onAdd} aria-label="Tambah">+</button>
    </section>
  );
}

function AddSheet({
  user,
  parent,
  onClose,
  onCreated,
}: {
  user: User;
  parent: StudyNode | null;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [kind, setKind] = useState<"folder" | "database" | "recording" | "flashcards" | "quiz">("folder");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const options = [
    { value: "folder", label: "Materi / Submateri", hint: "Contoh: Farmasi, Penjaminan Mutu, Pertemuan 1" },
    { value: "database", label: "Database", hint: "Teks modul, DOCX, PDF, audio/video sumber" },
    { value: "recording", label: "Rekaman", hint: "Rekam suara + transkrip langsung dan versi tertata" },
    { value: "flashcards", label: "Flashcard", hint: "Latihan kartu dari database di halaman ini" },
    { value: "quiz", label: "Kuis", hint: "Soal dari database di halaman ini" },
  ] as const;

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    const nodeType: NodeType =
      kind === "folder"
        ? parent ? "submaterial" : "material"
        : kind;

    setBusy(true);
    const { data, error } = await supabase
      .from("study_nodes")
      .insert({
        user_id: user.id,
        parent_id: parent?.id || null,
        title: title.trim(),
        node_type: nodeType,
      })
      .select("id")
      .single();
    setBusy(false);

    if (error) return alert(error.message);
    onCreated(data.id);
  }

  return (
    <div className="sheetBackdrop" onMouseDown={onClose}>
      <section className="addSheet" onMouseDown={(e) => e.stopPropagation()}>
        <div className="sheetHead">
          <div>
            <p className="eyebrow">TAMBAH</p>
            <h2>{parent ? "Isi di " + parent.title : "Isi di Beranda"}</h2>
          </div>
          <button className="closeBtn" onClick={onClose}>×</button>
        </div>

        <div className="typeChoices">
          {options.map((option) => (
            <button
              key={option.value}
              className={kind === option.value ? "typeChoice active" : "typeChoice"}
              onClick={() => setKind(option.value)}
            >
              <strong>{option.label}</strong>
              <small>{option.hint}</small>
            </button>
          ))}
        </div>

        <form className="stack" onSubmit={create}>
          <label>
            Nama
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={kind === "folder" ? "Contoh: Pertemuan 1" : "Contoh: " + options.find((item) => item.value === kind)?.label}
            />
          </label>
          <button className="primary" disabled={busy || !title.trim()}>
            {busy ? "Membuat..." : "Buat & buka"}
          </button>
        </form>
      </section>
    </div>
  );
}

function DatabasePage({
  session,
  user,
  node,
  entries,
  files,
  onChange,
}: {
  session: Session;
  user: User;
  node: StudyNode;
  entries: KnowledgeEntry[];
  files: SourceFile[];
  onChange: () => void;
}) {
  const [content, setContent] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);
  const [fileStatus, setFileStatus] = useState("");

  const localEntries = entries.filter((item) => item.node_id === node.id);
  const localFiles = files.filter((item) => item.node_id === node.id);

  async function saveText(e: FormEvent) {
    e.preventDefault();
    setBusy(true);

    const { error } = await supabase.from("knowledge_entries").insert({
      user_id: user.id,
      node_id: node.id,
      title: node.title,
      category: "",
      content: content.trim(),
      raw_content: content.trim(),
      source_type: "manual",
    });

    setBusy(false);
    if (error) return alert(error.message);

    setContent("");
    onChange();
  }

  async function uploadFile(e: FormEvent) {
    e.preventDefault();
    if (!selectedFile) return;

    const mimeType = inferMime(selectedFile);
    if (!mimeType) return alert("Jenis file belum didukung.");
    if (selectedFile.size > 50 * 1024 * 1024) return alert("File maksimal 50 MB.");

    setFileBusy(true);
    setFileStatus("Mengupload...");

    const safeName = selectedFile.name.replace(/[^a-zA-Z0-9._-]+/g, "_");
    const path = user.id + "/" + node.id + "/" + crypto.randomUUID() + "-" + safeName;

    const upload = await supabase.storage.from("study-files").upload(path, selectedFile, { contentType: mimeType });
    if (upload.error) {
      setFileBusy(false);
      setFileStatus("");
      return alert(upload.error.message);
    }

    const { data: row, error } = await supabase
      .from("source_files")
      .insert({
        user_id: user.id,
        node_id: node.id,
        file_path: path,
        file_name: selectedFile.name,
        mime_type: mimeType,
        size_bytes: selectedFile.size,
        processing_status: "processing",
      })
      .select("*")
      .single();

    if (error) {
      await supabase.storage.from("study-files").remove([path]);
      setFileBusy(false);
      setFileStatus("");
      return alert(error.message);
    }

    setFileStatus("Membaca file dan menyusun isi...");

    const response = await fetch("/api/import-file", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + session.access_token,
      },
      body: JSON.stringify({
        sourceFileId: row.id,
        filePath: path,
        fileName: selectedFile.name,
        mimeType,
        nodeId: node.id,
      }),
    });

    const result = await response.json();
    setFileBusy(false);

    if (!response.ok) {
      setFileStatus("File tersimpan, tetapi pemrosesan gagal.");
      onChange();
      return alert(result.error || "Gagal memproses file.");
    }

    setSelectedFile(null);
    setFileStatus("Selesai. File sudah menjadi isi Database.");
    onChange();
  }

  async function removeEntry(id: string) {
    if (!confirm("Hapus catatan ini?")) return;
    const { error } = await supabase.from("knowledge_entries").delete().eq("id", id);
    if (error) alert(error.message);
    else onChange();
  }

  async function removeFile(file: SourceFile) {
    if (!confirm("Hapus file dan hasil olahannya?")) return;
    await supabase.from("knowledge_entries").delete().eq("source_file_id", file.id);
    await supabase.storage.from("study-files").remove([file.file_path]);
    const { error } = await supabase.from("source_files").delete().eq("id", file.id);
    if (error) alert(error.message);
    else onChange();
  }

  return (
    <section className="toolPage">
      <div className="toolHeader">
        <p className="eyebrow">DATABASE</p>
        <h1>{node.title}</h1>
        <p className="muted">Masukkan isi materi langsung sebagai teks atau file. Konteks mengikuti jalur materi tempat Database ini berada.</p>
      </div>

      <div className="toolGrid">
        <article className="panel">
          <h2>Masukkan teks</h2>
          <p className="muted">Langsung copy-paste isi modul, catatan, atau materi di sini. Nama dan konteks mengikuti Database serta jalur materi yang sedang dibuka.</p>
          <form className="stack" onSubmit={saveText}>
            <textarea
              required
              rows={14}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Paste teks materi di sini..."
            />
            <button className="primary" disabled={busy || !content.trim()}>
              {busy ? "Menyimpan..." : "Tambahkan ke Database"}
            </button>
          </form>
        </article>

        <article className="panel">
          <h2>Upload file</h2>
          <p className="muted">PDF, DOCX, TXT/MD/CSV/JSON, gambar, audio, dan video. Audio/video akan ditranskrip dulu.</p>
          <form className="stack" onSubmit={uploadFile}>
            <input
              type="file"
              accept=".pdf,.docx,.txt,.md,.csv,.json,.xml,.mp3,.wav,.m4a,.aac,.ogg,.flac,.opus,.webm,.mp4,.mov,.png,.jpg,.jpeg,.webp"
              onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
            />
            <button className="primary" disabled={!selectedFile || fileBusy}>
              {fileBusy ? "Memproses..." : "Upload & olah"}
            </button>
          </form>
          {fileStatus && <div className="notice">{fileStatus}</div>}
        </article>
      </div>

      <section className="databaseList">
        <h2>Isi Database</h2>
        {!localEntries.length && !localFiles.length && <p className="muted">Belum ada isi.</p>}

        {localEntries.map((entry) => (
          <article className="dataCard" key={entry.id}>
            <div className="dataHead">
              <div>
                <small>{entry.category || entry.source_type}</small>
                <h3>{entry.title}</h3>
              </div>
              <button className="dangerSmall" onClick={() => removeEntry(entry.id)}>Hapus</button>
            </div>
            <div className="dataText">{entry.content}</div>
          </article>
        ))}

        {localFiles.map((file) => (
          <article className="dataCard" key={file.id}>
            <div className="dataHead">
              <div>
                <small>{file.processing_status} · {formatBytes(file.size_bytes)}</small>
                <h3>{file.file_name}</h3>
              </div>
              <button className="dangerSmall" onClick={() => removeFile(file)}>Hapus file</button>
            </div>

            {file.structured_text && (
              <details>
                <summary>Versi tertata</summary>
                <div className="dataText">{file.structured_text}</div>
              </details>
            )}
            {file.raw_text && (
              <details>
                <summary>Sumber mentah / verbatim</summary>
                <div className="dataText raw">{file.raw_text}</div>
              </details>
            )}
            {!!file.corrections?.length && <CorrectionList corrections={file.corrections} />}
          </article>
        ))}
      </section>
    </section>
  );
}

function RecordingPage({
  session,
  user,
  node,
  nodes,
  recordings,
  onChange,
}: {
  session: Session;
  user: User;
  node: StudyNode;
  nodes: StudyNode[];
  recordings: Recording[];
  onChange: () => void;
}) {
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedRef = useRef(0);
  const elapsedRef = useRef(0);
  const recordingRef = useRef(false);
  const speechRef = useRef<any>(null);
  const speechFinalRef = useRef("");

  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [liveText, setLiveText] = useState("");
  const [liveSupported, setLiveSupported] = useState(true);
  const [status, setStatus] = useState("Siap merekam");
  const [result, setResult] = useState<{
    recordingId: string;
    raw: string;
    structured: string;
    summary: string;
    corrections: Correction[];
    added: boolean;
  } | null>(null);
  const [targetDbId, setTargetDbId] = useState("");

  const localRecordings = recordings.filter((item) => item.node_id === node.id);
  const siblingDatabases = nodes.filter(
    (item) => item.parent_id === node.parent_id && item.node_type === "database"
  );

  useEffect(() => {
    if (!targetDbId && siblingDatabases[0]) setTargetDbId(siblingDatabases[0].id);
  }, [siblingDatabases, targetDbId]);

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => {
      const value = Math.floor((Date.now() - startedRef.current) / 1000);
      elapsedRef.current = value;
      setElapsed(value);
    }, 400);
    return () => clearInterval(timer);
  }, [recording]);

  function startLiveSpeech() {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setLiveSupported(false);
      return;
    }

    setLiveSupported(true);
    speechFinalRef.current = "";
    setLiveText("");

    const recognition = new SpeechRecognition();
    recognition.lang = "id-ID";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event: any) => {
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const text = String(event.results[index][0]?.transcript || "");
        if (event.results[index].isFinal) {
          speechFinalRef.current += text + " ";
        } else {
          interim += text;
        }
      }
      setLiveText((speechFinalRef.current + interim).trim());
    };

    recognition.onend = () => {
      if (recordingRef.current) {
        try {
          recognition.start();
        } catch {}
      }
    };

    speechRef.current = recognition;
    try {
      recognition.start();
    } catch {
      setLiveSupported(false);
    }
  }

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferred =
        typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "";

      const recorder = preferred ? new MediaRecorder(stream, { mimeType: preferred }) : new MediaRecorder(stream);
      chunksRef.current = [];
      recRef.current = recorder;
      setResult(null);
      setLiveText("");
      speechFinalRef.current = "";

      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        await processRecording(blob);
      };

      startedRef.current = Date.now();
      elapsedRef.current = 0;
      setElapsed(0);
      recordingRef.current = true;
      setRecording(true);
      setStatus("Sedang merekam...");
      startLiveSpeech();
      recorder.start(1000);
    } catch (error: any) {
      alert(error.message);
    }
  }

  function stop() {
    recordingRef.current = false;
    setRecording(false);
    setStatus("Rekaman berhenti. Menyiapkan versi tertata & terkonteks...");
    try {
      speechRef.current?.stop();
    } catch {}
    recRef.current?.stop();
  }

  async function processRecording(blob: Blob) {
    setBusy(true);
    const mimeType = normalizeAudioMime(blob.type);
    const ext = mimeType === "audio/m4a" ? "m4a" : mimeType.split("/")[1] || "webm";
    const path = user.id + "/" + crypto.randomUUID() + "." + ext;
    const title = "Rekaman " + new Date().toLocaleString("id-ID");

    const upload = await supabase.storage.from("recordings").upload(path, blob, { contentType: mimeType });
    if (upload.error) {
      setBusy(false);
      setStatus("Gagal upload.");
      return alert(upload.error.message);
    }

    const { data: row, error } = await supabase
      .from("recordings")
      .insert({
        user_id: user.id,
        node_id: node.id,
        title,
        file_path: path,
        mime_type: mimeType,
        duration_seconds: elapsedRef.current,
      })
      .select("*")
      .single();

    if (error) {
      await supabase.storage.from("recordings").remove([path]);
      setBusy(false);
      return alert(error.message);
    }

    const response = await fetch("/api/transcribe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + session.access_token,
      },
      body: JSON.stringify({
        recordingId: row.id,
        filePath: path,
        mimeType,
        contextNodeId: node.parent_id,
      }),
    });

    const data = await response.json();
    setBusy(false);

    if (!response.ok) {
      setStatus("Audio tersimpan, tetapi versi final belum berhasil.");
      onChange();
      return alert(data.error || "Transkripsi gagal.");
    }

    setResult({
      recordingId: row.id,
      raw: data.rawTranscript || liveText,
      structured: data.structuredTranscript || data.rawTranscript || liveText,
      summary: data.summary || "",
      corrections: data.corrections || [],
      added: false,
    });
    setStatus("Selesai. Pilih Add to Database bila catatan ini ingin dimasukkan ke Database.");
    onChange();
  }

  async function addToDatabase() {
    if (!result || !targetDbId) return;

    const target = siblingDatabases.find((item) => item.id === targetDbId);
    if (!target) return;

    const title = "Hasil Rekaman - " + new Date().toLocaleString("id-ID");
    const combined =
      result.structured +
      (result.summary ? "\n\nRingkasan:\n" + result.summary : "");

    const { data: entry, error } = await supabase
      .from("knowledge_entries")
      .insert({
        user_id: user.id,
        node_id: target.id,
        title,
        category: "Hasil Rekaman",
        content: combined,
        raw_content: result.raw,
        source_type: "transcript",
      })
      .select("id")
      .single();

    if (error) return alert(error.message);

    await supabase.from("recordings").update({ knowledge_entry_id: entry.id }).eq("id", result.recordingId);

    setResult({ ...result, added: true });
    onChange();
  }

  async function addExistingToDatabase(item: Recording, databaseId: string) {
    if (!item.structured_transcript || !databaseId || item.knowledge_entry_id) return;

    const { data: entry, error } = await supabase
      .from("knowledge_entries")
      .insert({
        user_id: user.id,
        node_id: databaseId,
        title: "Hasil Rekaman - " + new Date(item.created_at).toLocaleString("id-ID"),
        category: "Hasil Rekaman",
        content: item.structured_transcript,
        raw_content: item.raw_transcript || item.structured_transcript,
        source_type: "transcript",
      })
      .select("id")
      .single();

    if (error) return alert(error.message);
    await supabase.from("recordings").update({ knowledge_entry_id: entry.id }).eq("id", item.id);
    onChange();
  }

  async function removeRecording(item: Recording) {
    if (!confirm("Hapus rekaman ini?")) return;
    await supabase.storage.from("recordings").remove([item.file_path]);
    if (item.knowledge_entry_id) {
      await supabase.from("knowledge_entries").delete().eq("id", item.knowledge_entry_id);
    }
    const { error } = await supabase.from("recordings").delete().eq("id", item.id);
    if (error) alert(error.message);
    else {
      if (result?.recordingId === item.id) setResult(null);
      onChange();
    }
  }

  return (
    <section className="toolPage">
      <div className="toolHeader">
        <p className="eyebrow">REKAMAN & TRANSKRIP</p>
        <h1>{node.title}</h1>
        <p className="muted">Transkrip langsung muncul selama bicara. Setelah Stop, Gemini membuat versi verbatim final dan versi tertata berdasarkan Database pada pertemuan ini.</p>
      </div>

      <article className="recordPanel">
        <div className="recordStatus">
          <span className={recording ? "recDot live" : "recDot"} />
          <div>
            <strong>{status}</strong>
            <span>{formatTime(elapsed)}</span>
          </div>
        </div>

        <div className="recordActions">
          <button className="primary" disabled={recording || busy} onClick={start}>Mulai Rekam</button>
          <button className="stopBtn" disabled={!recording} onClick={stop}>Stop</button>
        </div>

        <div className="liveTranscript">
          <div className="liveHead">
            <strong>Transkrip langsung</strong>
            {recording && <span>LIVE</span>}
          </div>
          <div className="dataText raw">
            {liveText || (liveSupported ? "Mulai bicara setelah rekaman berjalan..." : "Browser ini tidak mendukung transkrip live. Transkrip final tetap dibuat setelah Stop.")}
          </div>
        </div>

        {busy && (
          <div className="processingBox">
            <div className="spinner" />
            <div>
              <strong>Menyusun versi tertata & terkonteks...</strong>
              <p>Transkrip langsung di atas tetap dipertahankan.</p>
            </div>
          </div>
        )}

        {result && (
          <div className="finalTranscript">
            <h2>Hasil Rekaman</h2>

            <div className="resultSection">
              <strong>Versi tertata & terkonteks</strong>
              <div className="dataText">{result.structured}</div>
            </div>

            <details>
              <summary>Verbatim final</summary>
              <div className="dataText raw">{result.raw}</div>
            </details>

            {!!result.corrections.length && <CorrectionList corrections={result.corrections} />}

            <div className="addDbBox">
              <select value={targetDbId} onChange={(e) => setTargetDbId(e.target.value)}>
                <option value="">Pilih Database tujuan</option>
                {siblingDatabases.map((database) => (
                  <option key={database.id} value={database.id}>{database.title}</option>
                ))}
              </select>
              <button className="primary" disabled={!targetDbId || result.added} onClick={addToDatabase}>
                {result.added ? "Sudah masuk Database" : "Add to Database"}
              </button>
              {!siblingDatabases.length && (
                <small>Buat node Database di halaman sebelumnya dulu agar hasil rekaman bisa disimpan sebagai catatan.</small>
              )}
            </div>
          </div>
        )}
      </article>

      {!!localRecordings.length && (
        <section className="databaseList">
          <h2>Riwayat Rekaman</h2>
          {localRecordings.map((item) => (
            <StoredRecording
              key={item.id}
              item={item}
              databases={siblingDatabases}
              onAdd={addExistingToDatabase}
              onDelete={removeRecording}
            />
          ))}
        </section>
      )}
    </section>
  );
}

function StoredRecording({
  item,
  databases,
  onAdd,
  onDelete,
}: {
  item: Recording;
  databases: StudyNode[];
  onAdd: (item: Recording, databaseId: string) => void;
  onDelete: (item: Recording) => void;
}) {
  const [databaseId, setDatabaseId] = useState(databases[0]?.id || "");

  return (
    <article className="dataCard">
      <div className="dataHead">
        <div>
          <small>{formatTime(item.duration_seconds)}</small>
          <h3>{item.title}</h3>
        </div>
        <button className="dangerSmall" onClick={() => onDelete(item)}>Hapus</button>
      </div>

      {item.structured_transcript && <div className="dataText">{item.structured_transcript}</div>}
      {item.raw_transcript && (
        <details>
          <summary>Verbatim</summary>
          <div className="dataText raw">{item.raw_transcript}</div>
        </details>
      )}

      {!!item.corrections?.length && <CorrectionList corrections={item.corrections} />}

      {item.structured_transcript && !item.knowledge_entry_id && databases.length > 0 && (
        <div className="inlineAdd">
          <select value={databaseId} onChange={(e) => setDatabaseId(e.target.value)}>
            {databases.map((database) => (
              <option key={database.id} value={database.id}>{database.title}</option>
            ))}
          </select>
          <button className="ghost" onClick={() => onAdd(item, databaseId)}>Add to Database</button>
        </div>
      )}

      {item.knowledge_entry_id && <div className="savedBadge">Sudah masuk Database</div>}
    </article>
  );
}

function PracticePage({
  session,
  node,
  cards,
  quizzes,
  onChange,
}: {
  session: Session;
  node: StudyNode;
  cards: Flashcard[];
  quizzes: Quiz[];
  onChange: () => void;
}) {
  const mode = node.node_type === "flashcards" ? "flashcards" : "quiz";
  const localCards = cards.filter((item) => item.scope_node_id === node.id);
  const localQuizzes = quizzes.filter((item) => item.scope_node_id === node.id);
  const [busy, setBusy] = useState(false);
  const [flipped, setFlipped] = useState<Record<string, boolean>>({});
  const [answers, setAnswers] = useState<Record<string, string>>({});

  async function generate() {
    if (!node.parent_id) return alert("Buat Flashcard/Kuis di dalam Materi agar ada database sumber.");

    setBusy(true);
    const response = await fetch("/api/generate-study", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + session.access_token,
      },
      body: JSON.stringify({
        sourceNodeId: node.parent_id,
        targetNodeId: node.id,
        mode,
      }),
    });

    const result = await response.json();
    setBusy(false);

    if (!response.ok) return alert(result.error || "Gagal membuat latihan.");
    onChange();
  }

  return (
    <section className="toolPage">
      <div className="toolHeader">
        <p className="eyebrow">{mode === "flashcards" ? "FLASHCARD" : "KUIS"}</p>
        <h1>{node.title}</h1>
        <p className="muted">Dibuat hanya dari Database pada halaman induknya.</p>
        <button className="primary inlinePrimary" onClick={generate} disabled={busy}>
          {busy ? "Membuat..." : mode === "flashcards" ? "Buat Flashcard" : "Buat Kuis"}
        </button>
      </div>

      {mode === "flashcards" && (
        <div className="flashGrid">
          {localCards.map((card) => (
            <button
              className="flash"
              key={card.id}
              onClick={() => setFlipped((value) => ({ ...value, [card.id]: !value[card.id] }))}
            >
              <small>{flipped[card.id] ? "JAWABAN" : "PERTANYAAN"}</small>
              <strong>{flipped[card.id] ? card.back : card.front}</strong>
              <span>Ketuk untuk balik</span>
            </button>
          ))}
          {!localCards.length && <p className="muted">Belum ada flashcard.</p>}
        </div>
      )}

      {mode === "quiz" && (
        <div className="quizList">
          {localQuizzes.map((quiz) => (
            <article className="dataCard" key={quiz.id}>
              <h3>{quiz.question}</h3>
              {quiz.choices.map((choice) => (
                <button
                  key={choice}
                  className={answers[quiz.id] === choice ? "choice selected" : "choice"}
                  onClick={() => setAnswers((value) => ({ ...value, [quiz.id]: choice }))}
                >
                  {choice}
                </button>
              ))}
              {answers[quiz.id] && (
                <div className={answers[quiz.id] === quiz.correct_answer ? "answerState ok" : "answerState bad"}>
                  {answers[quiz.id] === quiz.correct_answer ? "Benar" : "Belum tepat"} · Jawaban: {quiz.correct_answer}
                  <br />
                  {quiz.explanation}
                </div>
              )}
            </article>
          ))}
          {!localQuizzes.length && <p className="muted">Belum ada kuis.</p>}
        </div>
      )}
    </section>
  );
}

function BottomAskBar({
  session,
  scopeNodeId,
  scopeName,
}: {
  session: Session;
  scopeNodeId: string | null;
  scopeName: string;
}) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<Array<{ id: string; title: string; category: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function ask(e: FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;

    setBusy(true);
    setOpen(true);
    setAnswer("");
    setSources([]);

    const response = await fetch("/api/ask", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + session.access_token,
      },
      body: JSON.stringify({ question, scopeNodeId }),
    });

    const data = await response.json();
    setBusy(false);

    if (!response.ok) {
      setAnswer(data.error || "Terjadi kesalahan.");
      return;
    }

    setAnswer(data.answer || "");
    setSources(data.sources || []);
  }

  return (
    <>
      {open && (
        <div className="aiAnswer">
          <div className="aiAnswerHead">
            <div>
              <small>Tanya AI · {scopeName}</small>
              <strong>{question}</strong>
            </div>
            <button onClick={() => setOpen(false)}>×</button>
          </div>
          <div className="aiAnswerBody">{busy ? "Mencari di Database..." : answer || "..."}</div>
          {!!sources.length && (
            <div className="aiSources">
              {sources.map((source) => (
                <span key={source.id}>{source.title}</span>
              ))}
            </div>
          )}
        </div>
      )}

      <form className="bottomAsk" onSubmit={ask}>
        <div className="askScope">AI · {scopeName}</div>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Tanya sesuatu dari Database..."
        />
        <button disabled={busy || !question.trim()}>{busy ? "..." : "↑"}</button>
      </form>
    </>
  );
}

function AiCreditBadge() {
  const [remaining, setRemaining] = useState<number | null>(null);
  const [limit, setLimit] = useState(40);

  useEffect(() => {
    let active = true;

    async function load() {
      const { data } = await supabase.rpc("get_ai_usage_today");
      if (!active || !data) return;
      setRemaining(Number(data.remaining ?? 40));
      setLimit(Number(data.limit ?? 40));
    }

    void load();
    const timer = window.setInterval(load, 15000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <span className="aiCreditPill">
      AI hari ini: {remaining === null ? "..." : remaining + "/" + limit}
    </span>
  );
}

function CorrectionList({ corrections }: { corrections: Correction[] }) {
  if (!corrections?.length) return null;

  return (
    <div className="corrections">
      <strong>Koreksi berbasis Database</strong>
      {corrections.map((item, index) => (
        <div key={item.heard + "-" + index}>
          <span>{item.heard}</span>
          <b>→</b>
          <span>{item.corrected}</span>
          {item.basis && <small>{item.basis}</small>}
        </div>
      ))}
    </div>
  );
}

function collectSubtreeIds(nodes: StudyNode[], id: string) {
  const result = [id];
  let cursor = 0;
  while (cursor < result.length) {
    const parentId = result[cursor];
    nodes.filter((node) => node.parent_id === parentId).forEach((child) => result.push(child.id));
    cursor += 1;
  }
  return result;
}

function iconFor(type: NodeType) {
  if (type === "database") return "DB";
  if (type === "recording") return "REC";
  if (type === "flashcards") return "FC";
  if (type === "quiz") return "Q";
  return "M";
}

function inferMime(file: File) {
  const current = (file.type || "").split(";")[0].toLowerCase();
  if (current && current !== "application/octet-stream") return normalizeAudioMime(current);

  const ext = file.name.toLowerCase().split(".").pop() || "";
  const map: Record<string, string> = {
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    txt: "text/plain",
    md: "text/markdown",
    csv: "text/csv",
    json: "application/json",
    xml: "application/xml",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    m4a: "audio/m4a",
    aac: "audio/aac",
    ogg: "audio/ogg",
    flac: "audio/flac",
    opus: "audio/opus",
    webm: "audio/webm",
    mp4: "video/mp4",
    mov: "video/quicktime",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
  };
  return map[ext] || "";
}

function normalizeAudioMime(value: string) {
  const mime = (value || "audio/webm").split(";")[0].trim().toLowerCase();
  if (mime === "audio/mp4") return "audio/m4a";
  return mime || "audio/webm";
}

function formatBytes(value: number) {
  if (!value) return "0 B";
  if (value < 1024) return value + " B";
  if (value < 1024 * 1024) return (value / 1024).toFixed(1) + " KB";
  return (value / (1024 * 1024)).toFixed(1) + " MB";
}

function formatTime(value: number) {
  const minutes = Math.floor(value / 60);
  const seconds = Math.max(0, value % 60);
  return String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
}

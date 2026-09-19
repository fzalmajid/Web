"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, PointerEvent as ReactPointerEvent } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

type NodeType = "material" | "submaterial" | "database" | "recording" | "flashcards" | "quiz";
type AiMode = "simple" | "instant" | "medium" | "high";
type Correction = { heard: string; corrected: string; basis: string };
type StudyNode = {
  id: string;
  user_id: string;
  parent_id: string | null;
  title: string;
  node_type: NodeType;
  description: string;
  emoji: string;
  card_color: string;
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
  quiz_type: "mcq" | "essay";
  grading_mode: "fixed" | "ai";
};

const aiModes: Array<{ value: AiMode; label: string; provider: "Local" | "Gemini"; hint: string }> = [
  { value: "simple", label: "Simple", provider: "Local", hint: "Diproses di perangkat, tanpa Gemini" },
  { value: "instant", label: "Instant", provider: "Gemini", hint: "Cepat & hemat · Gemini 3.6" },
  { value: "medium", label: "Medium", provider: "Gemini", hint: "Lebih teliti · Gemini 3.6" },
  { value: "high", label: "High", provider: "Gemini", hint: "Paling mendalam · Gemini 3.6" },
];

const nodeEmojis = ["📚","🧠","📝","🎓","💊","🧪","🔬","📖","🎙️","🗂️","✨","🌱","💡","📌","✅","⭐","🧬","🧫","⚗️","🏥","💉","🩺","🧴","🧾","📂","📁","📊","📈","📉","🧩","❓","❗","🧮","🧭","🗒️","📒","📓","📔","📕","📗","📘","📙","🎧","🎤","🎥","🖼️","🧑‍⚕️","👩‍🔬","👨‍🔬","🧑‍🏫","🏆","🎯","⏱️","🔖","🧷","🪄","🌟","🔥","💬","🗃️","🧱","🔎","🧷"];
const nodeColors = [
  { value: "default", label: "Default" },
  { value: "rose", label: "Rose" },
  { value: "sage", label: "Sage" },
  { value: "sky", label: "Sky" },
  { value: "amber", label: "Amber" },
  { value: "violet", label: "Violet" },
  { value: "slate", label: "Slate" },
];

function aiCost(action: "ask" | "study" | "transcription" | "file_light" | "file_heavy", mode: AiMode) {
  const table = {
    ask: { simple: 0, instant: 1, medium: 2, high: 4 },
    study: { simple: 0, instant: 2, medium: 4, high: 6 },
    transcription: { simple: 0, instant: 5, medium: 7, high: 10 },
    file_light: { simple: 0, instant: 2, medium: 3, high: 5 },
    file_heavy: { simple: 0, instant: 5, medium: 7, high: 10 },
  } as const;
  return table[action][mode];
}

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
  const [theme, setTheme] = useState<"light" | "dark" | "system">("system");

  useEffect(() => {
    const savedTheme = (window.localStorage.getItem("rb-theme") || "system") as "light" | "dark" | "system";
    setTheme(savedTheme);
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

  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const resolved = theme === "system"
        ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
        : theme;
      root.dataset.theme = resolved;
      root.dataset.themePreference = theme;
      window.localStorage.setItem("rb-theme", theme);
    };
    apply();
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => theme === "system" && apply();
    media.addEventListener?.("change", listener);
    return () => media.removeEventListener?.("change", listener);
  }, [theme]);

  if (loading) {
    return <main className="center"><div className="loader">Memuat Ruang Belajar...</div></main>;
  }
  if (!session) return <Auth />;
  return <Workspace session={session} user={session.user} theme={theme} onThemeChange={setTheme} />;
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

function Workspace({ session, user, theme, onThemeChange }: { session: Session; user: User; theme: "light" | "dark" | "system"; onThemeChange: (theme: "light" | "dark" | "system") => void }) {
  const [nodes, setNodes] = useState<StudyNode[]>([]);
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [files, setFiles] = useState<SourceFile[]>([]);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [customizeNode, setCustomizeNode] = useState<StudyNode | null>(null);
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

  const aiScopeName = !current
    ? "Seluruh Database"
    : path.map((item) => item.title).join(" · ");

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
          <ThemePicker value={theme} onChange={onThemeChange} />
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
            onCustomize={setCustomizeNode}
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
            entries={entries}
            nodes={nodes}
            onChange={refresh}
          />
        )}
      </main>

      <BottomAskBar
        session={session}
        scopeNodeId={aiScopeId}
        scopeName={aiScopeName}
        entries={entries}
        nodes={nodes}
      />

      {customizeNode && (
        <CustomizeSheet
          node={customizeNode}
          onClose={() => setCustomizeNode(null)}
          onSaved={() => {
            setCustomizeNode(null);
            refresh();
          }}
        />
      )}

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
  onCustomize,
  onDelete,
}: {
  current: StudyNode | null;
  children: StudyNode[];
  onOpen: (id: string) => void;
  onAdd: () => void;
  onCustomize: (node: StudyNode) => void;
  onDelete: (node: StudyNode) => void;
}) {
  return (
    <section className="folderPage">
      <div className="folderTitle folderTitleRow">
        <div>
          <p className="eyebrow">{current ? "RUANG MATERI" : "RUANG BELAJAR"}</p>
          <h1>{current ? (current.emoji ? current.emoji + " " : "") + current.title : "Materi saya"}</h1>
        </div>
        {current && <button className="ghost customizeTop" onClick={() => onCustomize(current)}>Sesuaikan</button>}
      </div>

      {!!children.length && (
        <div className="nodeGrid">
          {children.map((node) => (
            <article className="nodeCard" data-color={node.card_color || "default"} key={node.id}>
              <button className="nodeOpen" onClick={() => onOpen(node.id)}>
                <span className="nodeIcon">{node.emoji || iconFor(node.node_type)}</span>
                <div>
                  <small>{labels[node.node_type]}</small>
                  <h3>{node.title}</h3>
                </div>
              </button>
              <div className="nodeTools">
                <button onClick={() => onCustomize(node)}>Ubah</button>
                <button className="nodeDelete" onClick={() => onDelete(node)}>Hapus</button>
              </div>
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
  const [emoji, setEmoji] = useState("");
  const [cardColor, setCardColor] = useState("default");
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
        emoji: emoji.trim(),
        card_color: cardColor,
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
          <div className="customizeMini">
            <div>
              <span className="fieldLabel">Emoji (opsional)</span>
              <div className="emojiRow compact">
                {nodeEmojis.slice(0, 8).map((item) => (
                  <button type="button" key={item} className={emoji === item ? "emojiChoice active" : "emojiChoice"} onClick={() => setEmoji(item)}>{item}</button>
                ))}
              </div>
            </div>
            <div>
              <span className="fieldLabel">Warna</span>
              <div className="colorRow compact">
                {nodeColors.map((item) => (
                  <button type="button" key={item.value} title={item.label} className={cardColor === item.value ? "colorChoice active" : "colorChoice"} data-color={item.value} onClick={() => setCardColor(item.value)} />
                ))}
              </div>
            </div>
          </div>
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
  const [aiMode, setAiMode] = useState<AiMode>("simple");

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

    if (aiMode === "simple") {
      const localMime = inferMime(selectedFile);
      const localSupported =
        localMime.startsWith("text/") ||
        localMime === "application/json" ||
        localMime === "application/xml";

      if (!localSupported) {
        await supabase.from("source_files").update({
          processing_status: "error",
          error_message: "Format ini membutuhkan Gemini. Pilih Instant, Medium, atau High.",
        }).eq("id", row.id);
        setFileBusy(false);
        setFileStatus("Simple · Local belum mendukung format ini.");
        onChange();
        return alert("Simple · Local saat ini untuk TXT, MD, CSV, JSON, dan XML. Untuk PDF, DOCX, PPTX, gambar, audio, atau video pilih Instant, Medium, atau High (Gemini).");
      }

      const rawText = (await selectedFile.text()).trim();
      if (!rawText) {
        setFileBusy(false);
        setFileStatus("");
        return alert("File tidak berisi teks yang dapat dibaca.");
      }

      const { data: entry, error: entryError } = await supabase
        .from("knowledge_entries")
        .insert({
          user_id: user.id,
          node_id: node.id,
          title: selectedFile.name,
          category: "File Local",
          content: rawText,
          raw_content: rawText,
          source_type: "file",
          source_file_id: row.id,
        })
        .select("id")
        .single();

      if (entryError) {
        setFileBusy(false);
        return alert(entryError.message);
      }

      await supabase.from("source_files").update({
        processing_status: "ready",
        raw_text: rawText,
        structured_text: rawText,
        corrections: [],
        error_message: null,
      }).eq("id", row.id);

      setSelectedFile(null);
      setFileBusy(false);
      setFileStatus("Selesai dengan Simple · Local · 0 cr.");
      onChange();
      return;
    }

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
        aiMode,
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
          <p className="muted">PDF, DOCX, PPTX, TXT/MD/CSV/JSON, gambar, audio, dan video. Audio/video akan ditranskrip dulu.</p>
          <form className="stack" onSubmit={uploadFile}>
            <input
              type="file"
              accept=".pdf,.docx,.pptx,.txt,.md,.csv,.json,.xml,.mp3,.wav,.m4a,.aac,.ogg,.flac,.opus,.webm,.mp4,.mov,.png,.jpg,.jpeg,.webp"
              onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
            />
            <AiModePicker
              value={aiMode}
              onChange={setAiMode}
              action={selectedFile && isHeavyFile(selectedFile) ? "file_heavy" : "file_light"}
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
  const [aiMode, setAiMode] = useState<AiMode>("simple");

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

    if (aiMode === "simple") {
      const localTranscript = (liveText || speechFinalRef.current).trim();
      if (!localTranscript) {
        setBusy(false);
        setStatus("Audio tersimpan. Transkrip Local tidak tersedia di browser ini.");
        onChange();
        return alert("Mode Simple memakai transkrip Local. Browser ini belum menghasilkan transkrip live; pilih Instant, Medium, atau High untuk transkripsi Gemini.");
      }

      await supabase
        .from("recordings")
        .update({
          raw_transcript: localTranscript,
          structured_transcript: localTranscript,
          transcript: localTranscript,
          corrections: [],
        })
        .eq("id", row.id);

      setBusy(false);
      setResult({
        recordingId: row.id,
        raw: localTranscript,
        structured: localTranscript,
        summary: "",
        corrections: [],
        added: false,
      });
      setStatus("Selesai dengan Simple · Local · 0 cr.");
      onChange();
      return;
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
        aiMode,
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

        <AiModePicker value={aiMode} onChange={setAiMode} action="transcription" />
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
  entries,
  nodes,
  onChange,
}: {
  session: Session;
  node: StudyNode;
  cards: Flashcard[];
  quizzes: Quiz[];
  entries: KnowledgeEntry[];
  nodes: StudyNode[];
  onChange: () => void;
}) {
  type EssayResult = {
    gradable: boolean;
    correct: boolean;
    score: number;
    feedback: string;
    basis: string;
  };

  const mode = node.node_type === "flashcards" ? "flashcards" : "quiz";
  const localCards = cards.filter((item) => item.scope_node_id === node.id);
  const localQuizzes = quizzes.filter((item) => item.scope_node_id === node.id);
  const fixedQuizzes = localQuizzes.filter((item) => (item.quiz_type || "mcq") === "mcq");
  const essayQuizzes = localQuizzes.filter((item) => item.quiz_type === "essay");

  const [busy, setBusy] = useState(false);
  const [grading, setGrading] = useState(false);
  const [flipped, setFlipped] = useState<Record<string, boolean>>({});
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [essayAnswers, setEssayAnswers] = useState<Record<string, string>>({});
  const [essayResults, setEssayResults] = useState<Record<string, EssayResult>>({});
  const [submitted, setSubmitted] = useState(false);
  const [aiMode, setAiMode] = useState<AiMode>("simple");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualKind, setManualKind] = useState<"mcq" | "essay">("mcq");
  const [manualQuestion, setManualQuestion] = useState("");
  const [manualChoices, setManualChoices] = useState(["", "", "", ""]);
  const [manualCorrect, setManualCorrect] = useState(0);

  const answeredFixed = fixedQuizzes.filter((quiz) => answers[quiz.id]).length;
  const answeredEssay = essayQuizzes.filter((quiz) => essayAnswers[quiz.id]?.trim()).length;
  const totalQuestions = fixedQuizzes.length + essayQuizzes.length;
  const answeredTotal = answeredFixed + answeredEssay;
  const allAnswered = totalQuestions > 0 && answeredTotal === totalQuestions;

  const correctFixed = fixedQuizzes.filter((quiz) => answers[quiz.id] === quiz.correct_answer).length;
  const gradableEssayResults = essayQuizzes
    .map((quiz) => essayResults[quiz.id])
    .filter((item): item is EssayResult => !!item && item.gradable);
  const correctEssay = gradableEssayResults.filter((item) => item.correct).length;
  const gradedCount = fixedQuizzes.length + gradableEssayResults.length;
  const totalScorePoints =
    correctFixed * 100 +
    gradableEssayResults.reduce((sum, item) => sum + item.score, 0);
  const scorePercent = gradedCount ? Math.round(totalScorePoints / gradedCount) : 0;

  async function generate() {
    if (!node.parent_id) return alert("Buat Flashcard/Kuis di dalam Materi agar ada database sumber.");

    if (aiMode === "simple") {
      setBusy(true);
      const scopeIds = collectSubtreeIds(nodes, node.parent_id);
      const sourceEntries = entries.filter((item) => scopeIds.includes(item.node_id));
      const sentences = sourceEntries
        .flatMap((entry) => entry.content.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/))
        .map((sentence) => sentence.trim())
        .filter((sentence) => sentence.length >= 35 && sentence.length <= 260)
        .slice(0, 12);

      if (!sentences.length) {
        setBusy(false);
        return alert("Belum ada cukup teks di Database untuk dibuat secara Local.");
      }

      if (mode === "flashcards") {
        const local = sentences.slice(0, 5).map((sentence, index) => ({
          user_id: session.user.id,
          material_id: null,
          scope_node_id: node.id,
          front: "Poin " + (index + 1) + ": apa isi pentingnya?",
          back: sentence,
        }));
        const { error } = await supabase.from("flashcards").insert(local);
        setBusy(false);
        if (error) return alert(error.message);
        onChange();
        return;
      }

      const pool = sentences.slice(0, 6);
      const localQuiz = pool.slice(0, 3).map((correct, index) => {
        const distractors = pool.filter((item) => item !== correct).slice(index, index + 3);
        const choices = [correct, ...distractors].slice(0, 4);
        return {
          user_id: session.user.id,
          material_id: null,
          scope_node_id: node.id,
          question: "Pernyataan mana yang sesuai dengan materi?",
          choices,
          correct_answer: correct,
          explanation: "Jawaban diambil langsung dari Database.",
          quiz_type: "mcq",
          grading_mode: "fixed",
        };
      }).filter((item) => item.choices.length >= 2);

      const { error } = await supabase.from("quizzes").insert(localQuiz);
      setBusy(false);
      if (error) return alert(error.message);
      resetQuizSession();
      onChange();
      return;
    }

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
        aiMode,
      }),
    });

    const result = await response.json();
    setBusy(false);

    if (!response.ok) return alert(result.error || "Gagal membuat latihan.");
    resetQuizSession();
    onChange();
  }

  async function saveManualQuiz(e: FormEvent) {
    e.preventDefault();
    if (!manualQuestion.trim()) return;

    if (manualKind === "essay") {
      setBusy(true);
      const { error } = await supabase.from("quizzes").insert({
        user_id: session.user.id,
        material_id: null,
        scope_node_id: node.id,
        question: manualQuestion.trim(),
        choices: [],
        correct_answer: "",
        explanation: "Dinilai Gemini 3.6 hanya berdasarkan Database.",
        quiz_type: "essay",
        grading_mode: "ai",
      });
      setBusy(false);
      if (error) return alert(error.message);
    } else {
      const choices = manualChoices.map((item) => item.trim()).filter(Boolean);
      if (choices.length < 2) return alert("Isi minimal 2 pilihan jawaban.");
      const correctText = manualChoices[manualCorrect]?.trim();
      if (!correctText || !choices.includes(correctText)) return alert("Pilih jawaban benar yang sudah diisi.");

      setBusy(true);
      const { error } = await supabase.from("quizzes").insert({
        user_id: session.user.id,
        material_id: null,
        scope_node_id: node.id,
        question: manualQuestion.trim(),
        choices,
        correct_answer: correctText,
        explanation: "Kuis dibuat manual.",
        quiz_type: "mcq",
        grading_mode: "fixed",
      });
      setBusy(false);
      if (error) return alert(error.message);
    }

    setManualQuestion("");
    setManualChoices(["", "", "", ""]);
    setManualCorrect(0);
    setManualOpen(false);
    resetQuizSession();
    onChange();
  }

  function resetQuizSession() {
    setSubmitted(false);
    setAnswers({});
    setEssayAnswers({});
    setEssayResults({});
  }

  async function finishQuiz() {
    if (!allAnswered) return;

    if (essayQuizzes.length) {
      if (aiMode === "simple") {
        return alert("Essay harus dinilai Gemini 3.6. Pilih Instant, Medium, atau High terlebih dahulu.");
      }

      setGrading(true);
      const response = await fetch("/api/grade-quiz", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + session.access_token,
        },
        body: JSON.stringify({
          aiMode,
          answers: essayQuizzes.map((quiz) => ({
            quizId: quiz.id,
            answer: essayAnswers[quiz.id],
          })),
        }),
      });
      const data = await response.json();
      setGrading(false);

      if (!response.ok) return alert(data.error || "Gagal menilai essay.");

      const mapped: Record<string, EssayResult> = {};
      (data.results || []).forEach((item: any) => {
        mapped[String(item.id)] = {
          gradable: item.gradable !== false,
          correct: item.correct === true,
          score: Number(item.score || 0),
          feedback: String(item.feedback || ""),
          basis: String(item.basis || ""),
        };
      });
      setEssayResults(mapped);
    }

    setSubmitted(true);
  }

  async function removeQuiz(id: string) {
    if (!confirm("Hapus soal ini?")) return;
    const { error } = await supabase.from("quizzes").delete().eq("id", id);
    if (error) return alert(error.message);
    setAnswers((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setEssayAnswers((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setEssayResults((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setSubmitted(false);
    onChange();
  }

  return (
    <section className="toolPage">
      <div className="toolHeader">
        <p className="eyebrow">{mode === "flashcards" ? "FLASHCARD" : "KUIS"}</p>
        <h1>{node.title}</h1>
        <p className="muted">Dibuat hanya dari Database pada halaman induknya.</p>

        {mode === "flashcards" ? (
          <>
            <AiModePicker value={aiMode} onChange={setAiMode} action="study" />
            <button className="primary inlinePrimary" onClick={generate} disabled={busy}>
              {busy ? "Membuat..." : "Buat Flashcard"}
            </button>
          </>
        ) : (
          <div className="quizCreateActions">
            <div>
              <small className="createLabel">AI / MODE PENILAIAN ESSAY</small>
              <AiModePicker value={aiMode} onChange={setAiMode} action="study" />
              <button className="primary inlinePrimary" onClick={generate} disabled={busy}>
                {busy ? "Membuat..." : "Buat Kuis dari Database"}
              </button>
            </div>
            <div className="manualCreateBox">
              <small className="createLabel">BUAT SENDIRI</small>
              <button className="ghost" onClick={() => setManualOpen((current) => !current)}>
                {manualOpen ? "Tutup form" : "+ Tambah soal sendiri"}
              </button>
            </div>
          </div>
        )}
      </div>

      {mode === "quiz" && manualOpen && (
        <form className="panel manualQuizForm" onSubmit={saveManualQuiz}>
          <div>
            <p className="eyebrow">SOAL MANUAL</p>
            <h2>Buat pertanyaan sendiri</h2>
          </div>

          <div className="quizKindTabs">
            <button type="button" className={manualKind === "mcq" ? "active" : ""} onClick={() => setManualKind("mcq")}>
              Pilihan ganda
            </button>
            <button type="button" className={manualKind === "essay" ? "active" : ""} onClick={() => setManualKind("essay")}>
              Essay dinilai AI
            </button>
          </div>

          <label>
            Pertanyaan
            <textarea rows={3} required value={manualQuestion} onChange={(e) => setManualQuestion(e.target.value)} placeholder="Tulis pertanyaan..." />
          </label>

          {manualKind === "mcq" ? (
            <>
              <div className="manualChoices">
                {manualChoices.map((choice, index) => (
                  <label className="manualChoiceRow" key={index}>
                    <input
                      type="radio"
                      name="manual-correct"
                      checked={manualCorrect === index}
                      onChange={() => setManualCorrect(index)}
                      title="Jawaban benar"
                    />
                    <span>{String.fromCharCode(65 + index)}</span>
                    <input
                      value={choice}
                      onChange={(e) => setManualChoices((current) => current.map((item, i) => i === index ? e.target.value : item))}
                      placeholder={"Pilihan " + String.fromCharCode(65 + index)}
                    />
                  </label>
                ))}
              </div>
              <small className="muted">Lingkaran yang dipilih = jawaban benar.</small>
            </>
          ) : (
            <div className="essayInfo">
              <strong>Gemini 3.6 akan menilai jawaban peserta.</strong>
              <span>Penilaian hanya memakai Database di materi induk. Public Web tidak dipakai untuk penilaian essay.</span>
            </div>
          )}

          <button className="primary" disabled={busy}>{busy ? "Menyimpan..." : "Simpan soal"}</button>
        </form>
      )}

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
        <>
          {!!totalQuestions && (
            <div className="quizProgress">
              <span>{answeredTotal}/{totalQuestions} terjawab</span>
              {!submitted ? (
                <button
                  className="primary"
                  disabled={!allAnswered || grading}
                  onClick={finishQuiz}
                >
                  {grading ? "Gemini 3.6 sedang menilai..." : "Selesai & lihat nilai"}
                </button>
              ) : (
                <button className="ghost" onClick={resetQuizSession}>Ulangi kuis</button>
              )}
            </div>
          )}

          {submitted && !!totalQuestions && (
            <div className="quizScore">
              <div className="scoreNumber">{scorePercent}</div>
              <div>
                <small>NILAI AKHIR</small>
                <strong>{correctFixed + correctEssay} jawaban dinilai benar · {gradedCount} soal dinilai</strong>
                {essayQuizzes.length !== gradableEssayResults.length && (
                  <span className="muted">{essayQuizzes.length - gradableEssayResults.length} essay tidak cukup sumber untuk dinilai.</span>
                )}
              </div>
            </div>
          )}

          <div className="quizList">
            {fixedQuizzes.map((quiz, index) => (
              <article className="dataCard quizCard" key={quiz.id}>
                <div className="quizCardHead">
                  <small>PILIHAN GANDA · SOAL {index + 1}</small>
                  <button className="dangerSmall" onClick={() => removeQuiz(quiz.id)}>Hapus</button>
                </div>
                <h3>{quiz.question}</h3>
                {quiz.choices.map((choice) => (
                  <button
                    key={choice}
                    disabled={submitted}
                    className={answers[quiz.id] === choice ? "choice selected" : "choice"}
                    onClick={() => setAnswers((value) => ({ ...value, [quiz.id]: choice }))}
                  >
                    {choice}
                  </button>
                ))}
                {submitted && (
                  <div className={answers[quiz.id] === quiz.correct_answer ? "answerState ok" : "answerState bad"}>
                    {answers[quiz.id] === quiz.correct_answer ? "Benar" : "Salah"} · Jawaban: {quiz.correct_answer}
                    {quiz.explanation && <><br />{quiz.explanation}</>}
                  </div>
                )}
              </article>
            ))}

            {essayQuizzes.map((quiz, index) => {
              const result = essayResults[quiz.id];
              return (
                <article className="dataCard quizCard essayCard" key={quiz.id}>
                  <div className="quizCardHead">
                    <small>ESSAY AI · SOAL {fixedQuizzes.length + index + 1}</small>
                    <button className="dangerSmall" onClick={() => removeQuiz(quiz.id)}>Hapus</button>
                  </div>
                  <h3>{quiz.question}</h3>
                  <textarea
                    rows={4}
                    disabled={submitted}
                    value={essayAnswers[quiz.id] || ""}
                    onChange={(e) => setEssayAnswers((current) => ({ ...current, [quiz.id]: e.target.value }))}
                    placeholder="Tulis jawabanmu..."
                  />
                  {submitted && result && (
                    <div className={result.correct ? "answerState ok" : "answerState bad"}>
                      <strong>{result.gradable ? (result.correct ? "Benar" : "Belum benar") : "Belum dapat dinilai"} · {result.score}/100</strong>
                      {result.feedback && <><br />{result.feedback}</>}
                      {result.basis && <><br /><small>Dasar Database: {result.basis}</small></>}
                    </div>
                  )}
                </article>
              );
            })}

            {!totalQuestions && <p className="muted">Belum ada kuis.</p>}
          </div>
        </>
      )}
    </section>
  );
}

function AiModePicker({
  value,
  onChange,
  action,
  compact = false,
}: {
  value: AiMode;
  onChange: (mode: AiMode) => void;
  action: "ask" | "study" | "transcription" | "file_light" | "file_heavy";
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const selected = aiModes.find((item) => item.value === value) || aiModes[0];

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (target && wrapRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
    };
  }, [open]);

  const choose = (mode: AiMode) => {
    onChange(mode);
    setOpen(false);
  };

  return (
    <div ref={wrapRef} className={compact ? "aiModeSelect compact" : "aiModeSelect"}>
      <button
        type="button"
        className="aiModeTrigger"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <span>
          <strong>{selected.label}</strong>
          <small>{selected.provider === "Gemini" ? "Gemini 3.6" : "Local"} · {aiCost(action, selected.value)} cr</small>
        </span>
        <b>⌄</b>
      </button>

      {open && (
        <div className="aiModePopover">
          <div className="aiModeSectionLabel">LOCAL</div>
          {aiModes.filter((item) => item.provider === "Local").map((item) => (
            <button type="button" key={item.value} className={value === item.value ? "aiModeOption active" : "aiModeOption"} onClick={() => choose(item.value)}>
              <span className="modeCheck">{value === item.value ? "✓" : ""}</span>
              <span className="modeCopy">
                <strong>{item.label}</strong>
                <small>{item.hint}</small>
              </span>
              <span className="modeMeta">Local · 0 cr</span>
            </button>
          ))}

          <div className="aiModeDivider" />
          <div className="aiModeSectionLabel">GEMINI 3.6</div>
          {aiModes.filter((item) => item.provider === "Gemini").map((item) => (
            <button type="button" key={item.value} className={value === item.value ? "aiModeOption active" : "aiModeOption"} onClick={() => choose(item.value)}>
              <span className="modeCheck">{value === item.value ? "✓" : ""}</span>
              <span className="modeCopy">
                <strong>{item.label}</strong>
                <small>{item.hint}</small>
              </span>
              <span className="modeMeta">Gemini 3.6 · {aiCost(action, item.value)} cr</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CustomizeSheet({
  node,
  onClose,
  onSaved,
}: {
  node: StudyNode;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(node.title);
  const [emoji, setEmoji] = useState(node.emoji || "");
  const [cardColor, setCardColor] = useState(node.card_color || "default");
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    const { error } = await supabase
      .from("study_nodes")
      .update({
        title: title.trim(),
        emoji: emoji.trim(),
        card_color: cardColor,
        updated_at: new Date().toISOString(),
      })
      .eq("id", node.id);
    setBusy(false);
    if (error) return alert(error.message);
    onSaved();
  }

  return (
    <div className="sheetBackdrop" onMouseDown={onClose}>
      <section className="addSheet customizeSheet" onMouseDown={(e) => e.stopPropagation()}>
        <div className="sheetHead">
          <div>
            <p className="eyebrow">CUSTOMIZE</p>
            <h2>Sesuaikan tampilan</h2>
          </div>
          <button className="closeBtn" onClick={onClose}>×</button>
        </div>

        <form className="stack" onSubmit={save}>
          <label>
            Nama
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>

          <div>
            <span className="fieldLabel">Emoji</span>
            <div className="emojiRow">
              <button type="button" className={!emoji ? "emojiChoice active" : "emojiChoice"} onClick={() => setEmoji("")}>—</button>
              {nodeEmojis.map((item) => (
                <button type="button" key={item} className={emoji === item ? "emojiChoice active" : "emojiChoice"} onClick={() => setEmoji(item)}>{item}</button>
              ))}
            </div>
            <input className="emojiInput" value={emoji} onChange={(e) => setEmoji(e.target.value)} placeholder="Atau ketik emoji sendiri…" />
          </div>

          <div>
            <span className="fieldLabel">Warna kartu</span>
            <div className="colorRow">
              {nodeColors.map((item) => (
                <button
                  type="button"
                  key={item.value}
                  className={cardColor === item.value ? "colorOption active" : "colorOption"}
                  data-color={item.value}
                  onClick={() => setCardColor(item.value)}
                >
                  <span />
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="customPreview" data-color={cardColor}>
            <span>{emoji || iconFor(node.node_type)}</span>
            <div><small>{labels[node.node_type]}</small><strong>{title || node.title}</strong></div>
          </div>

          <button className="primary" disabled={busy || !title.trim()}>{busy ? "Menyimpan..." : "Simpan perubahan"}</button>
        </form>
      </section>
    </div>
  );
}

function BottomAskBar({
  session,
  scopeNodeId,
  scopeName,
  entries,
  nodes,
}: {
  session: Session;
  scopeNodeId: string | null;
  scopeName: string;
  entries: KnowledgeEntry[];
  nodes: StudyNode[];
}) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<Array<{ id: string; title: string; category: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [aiMode, setAiMode] = useState<AiMode>("simple");
  const [composerBottom, setComposerBottom] = useState(16);
  const [composerHeight, setComposerHeight] = useState(118);
  const dragRef = useRef<{ y: number; bottom: number } | null>(null);
  const composerRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    const saved = Number(window.localStorage.getItem("rb-composer-bottom") || "16");
    if (Number.isFinite(saved)) setComposerBottom(Math.max(12, Math.min(saved, 320)));
  }, []);

  useEffect(() => {
    const element = composerRef.current;
    if (!element) return;
    const update = () => setComposerHeight(element.getBoundingClientRect().height);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  function startDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    dragRef.current = { y: event.clientY, bottom: composerBottom };
    let latestBottom = composerBottom;
    event.currentTarget.setPointerCapture?.(event.pointerId);

    const move = (e: PointerEvent) => {
      if (!dragRef.current) return;
      const max = Math.min(320, Math.max(80, window.innerHeight * 0.42));
      const next = Math.max(12, Math.min(max, dragRef.current.bottom + dragRef.current.y - e.clientY));
      latestBottom = next;
      setComposerBottom(next);
    };
    const end = () => {
      dragRef.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.localStorage.setItem("rb-composer-bottom", String(Math.round(latestBottom)));
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: true });
  }

  function scopedLocalEntries() {
    if (!scopeNodeId) return entries;
    const ids = collectSubtreeIds(nodes, scopeNodeId);
    return entries.filter((item) => ids.includes(item.node_id));
  }

  function answerLocally(query: string) {
    const words = Array.from(new Set(
      query.toLowerCase().match(/[a-z0-9À-ÿ]{3,}/gi)?.map((word) => word.toLowerCase()) || []
    ));
    const ranked = scopedLocalEntries()
      .map((entry) => {
        const haystack = (entry.title + " " + entry.category + " " + entry.content).toLowerCase();
        const score = words.reduce((total, word) => total + (haystack.includes(word) ? 1 : 0), 0);
        return { entry, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    if (!ranked.length) {
      return {
        text: "Materi ini belum tersedia di database.",
        refs: [] as Array<{ id: string; title: string; category: string }>,
      };
    }

    const snippets = ranked.map(({ entry }) => {
      const sentences = entry.content
        .replace(/\s+/g, " ")
        .split(/(?<=[.!?])\s+/)
        .filter(Boolean);
      const matching = sentences
        .map((sentence) => ({
          sentence,
          score: words.reduce((total, word) => total + (sentence.toLowerCase().includes(word) ? 1 : 0), 0),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 2)
        .map((item) => item.sentence)
        .join(" ");
      return matching || entry.content.slice(0, 420);
    });

    return {
      text: snippets.join("\n\n"),
      refs: ranked.map(({ entry }) => ({ id: entry.id, title: entry.title, category: entry.category })),
    };
  }

  async function ask(e: FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;

    setBusy(true);
    setOpen(true);
    setAnswer("");
    setSources([]);

    if (aiMode === "simple") {
      const local = answerLocally(question.trim());
      setAnswer(local.text);
      setSources(local.refs);
      setBusy(false);
      return;
    }

    const response = await fetch("/api/ask", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + session.access_token,
      },
      body: JSON.stringify({ question, scopeNodeId, aiMode }),
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
        <div className="aiAnswer" style={{ bottom: composerBottom + composerHeight + 12 }}>
          <div className="aiAnswerHead">
            <div>
              <small title={scopeName}>{aiMode === "simple" ? "Simple · Local" : aiMode[0].toUpperCase() + aiMode.slice(1) + " · Gemini 3.6"} · {scopeName}</small>
              <strong>{question}</strong>
            </div>
            <button onClick={() => setOpen(false)}>×</button>
          </div>
          <div className="aiAnswerBody">{busy ? (aiMode === "simple" ? "Mencari secara Local..." : "Mencari di Database...") : answer || "..."}</div>
          {!!sources.length && (
            <div className="aiSources">
              {sources.map((source) => (
                <span key={source.id}>{source.title}</span>
              ))}
            </div>
          )}
        </div>
      )}

      <form ref={composerRef} className="bottomAsk gptComposer" style={{ bottom: composerBottom }} onSubmit={ask}>
        <button type="button" className="composerDragHandle" onPointerDown={startDrag} aria-label="Geser bar">
          <span />
        </button>
        <div className="askTopRow">
          <div className="askScope">AI · {scopeName}</div>
          <AiModePicker value={aiMode} onChange={setAiMode} action="ask" compact />
        </div>
        <textarea
          rows={1}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onInput={(e) => {
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = Math.min(el.scrollHeight, 140) + "px";
          }}
          placeholder="Tanya sesuatu dari Database..."
        />
        <button className="sendAsk" disabled={busy || !question.trim()}>{busy ? "..." : "↑"}</button>
      </form>
    </>
  );
}

function ThemePicker({
  value,
  onChange,
}: {
  value: "light" | "dark" | "system";
  onChange: (theme: "light" | "dark" | "system") => void;
}) {
  const [open, setOpen] = useState(false);
  const label = value === "light" ? "Terang" : value === "dark" ? "Gelap" : "Sistem";
  return (
    <div className="themePicker">
      <button className="themeTrigger" onClick={() => setOpen((current) => !current)} title="Tema">
        <span>{value === "light" ? "☀️" : value === "dark" ? "🌙" : "◐"}</span>
        <small>{label}</small>
      </button>
      {open && (
        <div className="themeMenu">
          {[
            { value: "light" as const, label: "Terang", icon: "☀️" },
            { value: "dark" as const, label: "Gelap", icon: "🌙" },
            { value: "system" as const, label: "Ikuti sistem", icon: "◐" },
          ].map((item) => (
            <button
              key={item.value}
              className={value === item.value ? "active" : ""}
              onClick={() => { onChange(item.value); setOpen(false); }}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
              {value === item.value && <b>✓</b>}
            </button>
          ))}
        </div>
      )}
    </div>
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

function isHeavyFile(file: File) {
  const mime = inferMime(file);
  return mime.startsWith("audio/") || mime.startsWith("video/") || mime.startsWith("image/") || mime === "application/pdf";
}

function inferMime(file: File) {
  const current = (file.type || "").split(";")[0].toLowerCase();
  if (current && current !== "application/octet-stream") return normalizeAudioMime(current);

  const ext = file.name.toLowerCase().split(".").pop() || "";
  const map: Record<string, string> = {
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
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

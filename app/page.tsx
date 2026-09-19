"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, PointerEvent as ReactPointerEvent } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

type NodeType = "material" | "submaterial" | "database" | "recording" | "flashcards" | "quiz" | "study";
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
type StudyPath = {
  id: string;
  user_id: string;
  node_id: string;
  source_node_ids: string[];
  ai_mode: "instant" | "medium" | "high";
  title: string;
  overview: string;
  focus_instruction: string;
  status: "processing" | "ready" | "error";
  error_message: string | null;
  created_at: string;
  updated_at: string;
};
type StudyUnit = {
  id: string;
  user_id: string;
  study_path_id: string;
  position: number;
  unit_level: "chapter" | "subchapter";
  title: string;
  teaching_text: string;
  recall_question: string;
  recall_choices: string[];
  recall_correct_answer: string;
  recall_explanation: string;
  is_unlocked: boolean;
  completed_at: string | null;
};

const aiModes: Array<{ value: AiMode; label: string; provider: "Local" | "Gemini"; hint: string; model: string }> = [
  { value: "simple", label: "Simple", provider: "Local", hint: "Browser · tanpa Gemini API", model: "Browser" },
  { value: "instant", label: "Instant", provider: "Gemini", hint: "Cepat · Free-first", model: "Gemini 2.5 Flash-Lite" },
  { value: "medium", label: "Medium", provider: "Gemini", hint: "Lebih teliti · Free-first", model: "Gemini 2.5 Flash" },
  { value: "high", label: "High", provider: "Gemini", hint: "Paling mendalam · fallback otomatis", model: "Gemini 3.6 Flash" },
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

const labels: Record<NodeType, string> = {
  material: "Materi",
  submaterial: "Materi",
  database: "Database",
  recording: "Rekaman",
  flashcards: "Flashcard",
  quiz: "Kuis",
  study: "Study",
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

        {current?.node_type === "study" && (
          <StudyPage
            session={session}
            user={user}
            node={current}
            nodes={nodes}
            entries={entries}
            onOpen={setCurrentId}
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
  const [kind, setKind] = useState<"folder" | "database" | "recording" | "flashcards" | "quiz" | "study">("folder");
  const [title, setTitle] = useState("");
  const [emoji, setEmoji] = useState("");
  const [cardColor, setCardColor] = useState("default");
  const [busy, setBusy] = useState(false);

  const options = [
    { value: "folder", label: "Materi / Submateri", hint: "Contoh: Farmasi, Penjaminan Mutu, Pertemuan 1" },
    { value: "database", label: "Database", hint: "Teks modul, DOCX, PDF, audio/video sumber" },
    { value: "recording", label: "Rekaman", hint: "Rekam suara + transkrip langsung dan versi tertata" },
    ...(parent ? [{ value: "study" as const, label: "Study", hint: "Pilih beberapa Database lalu belajar bertahap dengan recall quiz" }] : []),
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

  const localEntries = entries.filter((item) => item.node_id === node.id && !item.source_file_id);
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

    onChange();
    setFileStatus("Sedang diproses...");

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
            <div className="dataText"><RichText text={entry.content} /></div>
          </article>
        ))}

        {localFiles.map((file) => (
          <article className="dataCard" key={file.id}>
            <div className="dataHead">
              <div>
                <small>{file.processing_status === "processing" ? "Sedang diproses..." : file.processing_status === "ready" ? "Ready" : "Gagal diproses"} · {formatBytes(file.size_bytes)}</small>
                <h3>{file.file_name}</h3>
              </div>
              <button className="dangerSmall" onClick={() => removeFile(file)}>Hapus file</button>
            </div>

            {file.structured_text && (
              <details>
                <summary>Versi tertata</summary>
                <div className="dataText"><RichText text={file.structured_text} /></div>
              </details>
            )}
            {file.raw_text && (
              <details>
                <summary>Sumber mentah / verbatim</summary>
                <div className="dataText raw"><RichText text={file.raw_text} /></div>
              </details>
            )}
            {!!file.corrections?.length && <CorrectionList corrections={file.corrections} />}
          </article>
        ))}
      </section>
    </section>
  );
}


function StudyPage({
  session,
  user,
  node,
  nodes,
  entries,
  onOpen,
  onChange,
}: {
  session: Session;
  user: User;
  node: StudyNode;
  nodes: StudyNode[];
  entries: KnowledgeEntry[];
  onOpen: (id: string) => void;
  onChange: () => void;
}) {
  const [path, setPath] = useState<StudyPath | null>(null);
  const [units, setUnits] = useState<StudyUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [studyInstruction, setStudyInstruction] = useState("");
  const [aiMode, setAiMode] = useState<AiMode>("instant");
  const [recallAnswers, setRecallAnswers] = useState<Record<string, string>>({});
  const [recallFeedback, setRecallFeedback] = useState<Record<string, "correct" | "wrong">>({});
  const [quickDbOpen, setQuickDbOpen] = useState(false);
  const [quickDbName, setQuickDbName] = useState("");
  const [quickDbContent, setQuickDbContent] = useState("");
  const [quickDbCreatedId, setQuickDbCreatedId] = useState<string | null>(null);
  const [quickDbFile, setQuickDbFile] = useState<File | null>(null);
  const [quickDbAiMode, setQuickDbAiMode] = useState<AiMode>("simple");
  const [quickDbStatus, setQuickDbStatus] = useState("");
  const [quickBusy, setQuickBusy] = useState(false);
  const [quickFileBusy, setQuickFileBusy] = useState(false);

  const branchIds = useMemo(
    () => node.parent_id ? collectSubtreeIds(nodes, node.parent_id) : [],
    [nodes, node.parent_id]
  );
  const sourceDatabases = nodes.filter(
    (item) => branchIds.includes(item.id) && item.node_type === "database"
  );

  useEffect(() => {
    void loadStudy();
  }, [node.id]);

  async function loadStudy() {
    setLoading(true);
    const { data: pathData, error: pathError } = await supabase
      .from("study_paths")
      .select("*")
      .eq("node_id", node.id)
      .maybeSingle();

    if (pathError) {
      setLoading(false);
      return alert(pathError.message);
    }

    const nextPath = (pathData || null) as StudyPath | null;
    setPath(nextPath);

    if (!nextPath) {
      setUnits([]);
      setSelectedSources([]);
      setStudyInstruction("");
      setSetupOpen(true);
      setLoading(false);
      return;
    }

    setSelectedSources(nextPath.source_node_ids || []);
    setStudyInstruction(nextPath.focus_instruction || "");
    setAiMode(nextPath.ai_mode || "instant");

    const { data: unitData, error: unitError } = await supabase
      .from("study_units")
      .select("*")
      .eq("study_path_id", nextPath.id)
      .order("position", { ascending: true });

    if (unitError) {
      setLoading(false);
      return alert(unitError.message);
    }

    setUnits((unitData || []) as StudyUnit[]);
    setSetupOpen(nextPath.status === "error");
    setLoading(false);
  }

  function toggleSource(id: string) {
    setSelectedSources((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id]
    );
  }

  async function buildStudy() {
    if (!selectedSources.length) return alert("Pilih minimal satu Database.");
    if (aiMode === "simple") return alert("Study terarah membutuhkan Gemini 3.6.");

    setBuilding(true);
    const response = await fetch("/api/build-study", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + session.access_token,
      },
      body: JSON.stringify({
        studyNodeId: node.id,
        sourceNodeIds: selectedSources,
        studyInstruction: studyInstruction.trim(),
        aiMode,
      }),
    });

    const result = await response.json();
    setBuilding(false);

    if (!response.ok) return alert(result.error || "Gagal menyusun Study.");

    setSetupOpen(false);
    setRecallAnswers({});
    setRecallFeedback({});
    await loadStudy();
  }

  async function ensureQuickDatabase() {
    if (quickDbCreatedId) {
      return { id: quickDbCreatedId, title: quickDbName.trim() };
    }
    if (!node.parent_id) {
      alert("Study harus berada di dalam Materi.");
      return null;
    }
    if (!quickDbName.trim()) {
      alert("Isi nama Database terlebih dahulu.");
      return null;
    }

    const { data: created, error } = await supabase
      .from("study_nodes")
      .insert({
        user_id: user.id,
        parent_id: node.parent_id,
        title: quickDbName.trim(),
        node_type: "database",
        emoji: "🗂️",
        card_color: "sage",
      })
      .select("id")
      .single();

    if (error || !created) {
      alert(error?.message || "Gagal membuat Database.");
      return null;
    }

    setQuickDbCreatedId(created.id);
    setSelectedSources((current) => [...new Set([...current, created.id])]);
    onChange();
    return { id: created.id, title: quickDbName.trim() };
  }

  async function saveQuickDatabaseText(e: FormEvent) {
    e.preventDefault();
    if (!quickDbContent.trim()) return;

    setQuickBusy(true);
    const database = await ensureQuickDatabase();
    if (!database) {
      setQuickBusy(false);
      return;
    }

    const { error } = await supabase.from("knowledge_entries").insert({
      user_id: user.id,
      node_id: database.id,
      title: database.title,
      category: "",
      content: quickDbContent.trim(),
      raw_content: quickDbContent.trim(),
      source_type: "manual",
    });

    setQuickBusy(false);
    if (error) return alert(error.message);

    setQuickDbContent("");
    setQuickDbStatus("Teks sudah ditambahkan. Database otomatis dipilih sebagai sumber Study.");
    onChange();
  }

  async function uploadQuickDatabaseFile(e: FormEvent) {
    e.preventDefault();
    if (!quickDbFile) return;

    const mimeType = inferMime(quickDbFile);
    if (!mimeType) return alert("Jenis file belum didukung.");
    if (quickDbFile.size > 50 * 1024 * 1024) return alert("File maksimal 50 MB.");

    setQuickFileBusy(true);
    setQuickDbStatus("Mengupload...");

    const database = await ensureQuickDatabase();
    if (!database) {
      setQuickFileBusy(false);
      setQuickDbStatus("");
      return;
    }

    const safeName = quickDbFile.name.replace(/[^a-zA-Z0-9._-]+/g, "_");
    const path = user.id + "/" + database.id + "/" + crypto.randomUUID() + "-" + safeName;

    const upload = await supabase.storage
      .from("study-files")
      .upload(path, quickDbFile, { contentType: mimeType });

    if (upload.error) {
      setQuickFileBusy(false);
      setQuickDbStatus("");
      return alert(upload.error.message);
    }

    const { data: row, error } = await supabase
      .from("source_files")
      .insert({
        user_id: user.id,
        node_id: database.id,
        file_path: path,
        file_name: quickDbFile.name,
        mime_type: mimeType,
        size_bytes: quickDbFile.size,
        processing_status: "processing",
      })
      .select("*")
      .single();

    if (error) {
      await supabase.storage.from("study-files").remove([path]);
      setQuickFileBusy(false);
      setQuickDbStatus("");
      return alert(error.message);
    }

    onChange();
    setQuickDbStatus("Sedang diproses...");

    if (quickDbAiMode === "simple") {
      const localSupported =
        mimeType.startsWith("text/") ||
        mimeType === "application/json" ||
        mimeType === "application/xml";

      if (!localSupported) {
        await supabase.from("source_files").update({
          processing_status: "error",
          error_message: "Format ini membutuhkan Gemini. Pilih Instant, Medium, atau High.",
        }).eq("id", row.id);

        setQuickFileBusy(false);
        setQuickDbStatus("Simple · Local belum mendukung format ini.");
        onChange();
        return alert("Simple · Local saat ini untuk TXT, MD, CSV, JSON, dan XML. Untuk PDF, DOCX, PPTX, gambar, audio, atau video pilih Instant, Medium, atau High (Gemini).");
      }

      const rawText = (await quickDbFile.text()).trim();
      if (!rawText) {
        setQuickFileBusy(false);
        setQuickDbStatus("");
        return alert("File tidak berisi teks yang dapat dibaca.");
      }

      const { error: entryError } = await supabase
        .from("knowledge_entries")
        .insert({
          user_id: user.id,
          node_id: database.id,
          title: quickDbFile.name,
          category: "File Local",
          content: rawText,
          raw_content: rawText,
          source_type: "file",
          source_file_id: row.id,
        });

      if (entryError) {
        setQuickFileBusy(false);
        return alert(entryError.message);
      }

      await supabase.from("source_files").update({
        processing_status: "ready",
        raw_text: rawText,
        structured_text: rawText,
        corrections: [],
        error_message: null,
      }).eq("id", row.id);

      setQuickDbFile(null);
      setQuickFileBusy(false);
      setQuickDbStatus("Selesai dengan Simple · Local · 0 cr. Database otomatis dipilih sebagai sumber Study.");
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
        fileName: quickDbFile.name,
        mimeType,
        nodeId: database.id,
        aiMode: quickDbAiMode,
      }),
    });

    const result = await response.json();
    setQuickFileBusy(false);

    if (!response.ok) {
      setQuickDbStatus("File tersimpan, tetapi pemrosesan gagal.");
      onChange();
      return alert(result.error || "Gagal memproses file.");
    }

    setQuickDbFile(null);
    setQuickDbStatus("Selesai. File sudah menjadi isi Database dan otomatis dipilih sebagai sumber Study.");
    onChange();
  }

  function closeQuickDatabase() {
    setQuickDbOpen(false);
    setQuickDbName("");
    setQuickDbContent("");
    setQuickDbCreatedId(null);
    setQuickDbFile(null);
    setQuickDbAiMode("simple");
    setQuickDbStatus("");
  }

  async function checkRecall(unit: StudyUnit) {
    const answer = recallAnswers[unit.id];
    if (!answer) return;

    if (answer !== unit.recall_correct_answer) {
      setRecallFeedback((current) => ({ ...current, [unit.id]: "wrong" }));
      return;
    }

    const now = new Date().toISOString();
    const { error } = await supabase
      .from("study_units")
      .update({ completed_at: now })
      .eq("id", unit.id);

    if (error) return alert(error.message);

    const next = units.find((item) => item.position === unit.position + 1);
    if (next) {
      const { error: nextError } = await supabase
        .from("study_units")
        .update({ is_unlocked: true })
        .eq("id", next.id);
      if (nextError) return alert(nextError.message);
    }

    setRecallFeedback((current) => ({ ...current, [unit.id]: "correct" }));
    await loadStudy();
  }

  const completedCount = units.filter((unit) => unit.completed_at).length;
  const visibleUnits = units.filter((unit) => unit.completed_at || unit.is_unlocked);
  const isFinished = units.length > 0 && completedCount === units.length;
  const sourceNameMap = new Map(nodes.map((item) => [item.id, item.title]));

  if (loading) {
    return <section className="toolPage"><div className="loader">Memuat Study...</div></section>;
  }

  return (
    <section className="toolPage studyPage">
      <div className="toolHeader studyHero">
        <p className="eyebrow">STUDY</p>
        <h1>{node.emoji ? node.emoji + " " : ""}{node.title}</h1>
        <p className="muted">
          Pilih Database yang ingin dipelajari. Gemini 3.6 menyusun urutan belajar,
          membagi bab/subbab sesuai kompleksitas, lalu membuka materi berikutnya setelah recall benar.
        </p>

        {path?.status === "ready" && !setupOpen && (
          <div className="studyHeaderActions">
            <div className="studyProgressText">
              <strong>{completedCount}/{units.length}</strong>
              <span>unit selesai</span>
            </div>
            <button className="ghost" onClick={() => setSetupOpen(true)}>Atur sumber / susun ulang</button>
          </div>
        )}
      </div>

      {(setupOpen || !path) && (
        <section className="panel studySetup">
          <div className="studySetupHead">
            <div>
              <p className="eyebrow">SUMBER STUDY</p>
              <h2>Pilih Database</h2>
              <p className="muted">Bisa pilih lebih dari satu Database dalam cabang materi ini.</p>
            </div>
            {path?.status === "ready" && (
              <button className="ghost" onClick={() => setSetupOpen(false)}>Batal</button>
            )}
          </div>

          <div className="studySourceGrid">
            {sourceDatabases.map((database) => {
              const count = entries.filter((entry) => entry.node_id === database.id).length;
              const active = selectedSources.includes(database.id);
              return (
                <button
                  type="button"
                  key={database.id}
                  className={active ? "studySource active" : "studySource"}
                  onClick={() => toggleSource(database.id)}
                >
                  <span className="studySourceCheck">{active ? "✓" : ""}</span>
                  <span className="studySourceIcon">{database.emoji || "🗂️"}</span>
                  <span className="studySourceCopy">
                    <strong>{database.title}</strong>
                    <small>{count ? count + " isi Database" : "Belum ada isi"}</small>
                  </span>
                </button>
              );
            })}
            {!sourceDatabases.length && (
              <div className="emptyStudySource">Belum ada Database di cabang ini.</div>
            )}
          </div>

          <label className="studyInstructionField">
            Fokus belajar / instruksi khusus <span>opsional</span>
            <textarea
              rows={3}
              value={studyInstruction}
              onChange={(e) => setStudyInstruction(e.target.value)}
              placeholder='Contoh: "Saya mau fokus mempelajari aspek CPOB 2024 saja." Kosongkan jika ingin mempelajari seluruh materi dari Database terpilih.'
            />
            <small className="muted">
              Jika diisi, Gemini 3.6 akan memakai instruksi ini saat memilih urutan bab/subbab dan merangkum materi.
            </small>
          </label>

          <div className="studySetupTools">
            <button className="ghost" onClick={() => setQuickDbOpen((current) => !current)}>
              + Tambah Database dari sini
            </button>
            <AiModePicker value={aiMode} onChange={setAiMode} action="study" allowSimple={false} />
            <button className="primary" disabled={building || !selectedSources.length} onClick={buildStudy}>
              {building ? "Sedang menyusun urutan belajar..." : path ? "Susun ulang Study" : "Mulai susun Study"}
            </button>
          </div>

          {quickDbOpen && (
            <section className="quickDatabaseShortcut">
              <div className="quickDatabaseHead">
                <div>
                  <p className="eyebrow">DATABASE BARU</p>
                  <h2>Tambah Database dari Study</h2>
                  <p className="muted">Shortcut ini sama seperti halaman Database. Setelah ada isi, Database otomatis terpilih sebagai sumber Study.</p>
                </div>
                <button className="ghost" type="button" onClick={closeQuickDatabase}>Tutup</button>
              </div>

              <label className="quickDatabaseName">
                Nama Database
                <input
                  value={quickDbName}
                  onChange={(e) => setQuickDbName(e.target.value)}
                  placeholder="Contoh: Materi CPOB 2024"
                  required
                  disabled={Boolean(quickDbCreatedId)}
                />
              </label>

              <div className="toolGrid quickDatabaseGrid">
                <article className="panel">
                  <h2>Masukkan teks</h2>
                  <p className="muted">Langsung copy-paste isi modul, catatan, atau materi di sini. Nama dan konteks mengikuti Database serta jalur materi yang sedang dibuka.</p>
                  <form className="stack" onSubmit={saveQuickDatabaseText}>
                    <textarea
                      required
                      rows={14}
                      value={quickDbContent}
                      onChange={(e) => setQuickDbContent(e.target.value)}
                      placeholder="Paste teks materi di sini..."
                    />
                    <button className="primary" disabled={quickBusy || !quickDbName.trim() || !quickDbContent.trim()}>
                      {quickBusy ? "Menyimpan..." : "Tambahkan ke Database"}
                    </button>
                  </form>
                </article>

                <article className="panel">
                  <h2>Upload file</h2>
                  <p className="muted">PDF, DOCX, PPTX, TXT/MD/CSV/JSON, gambar, audio, dan video. Audio/video akan ditranskrip dulu.</p>
                  <form className="stack" onSubmit={uploadQuickDatabaseFile}>
                    <input
                      type="file"
                      accept=".pdf,.docx,.pptx,.txt,.md,.csv,.json,.xml,.mp3,.wav,.m4a,.aac,.ogg,.flac,.opus,.webm,.mp4,.mov,.png,.jpg,.jpeg,.webp"
                      onChange={(e) => setQuickDbFile(e.target.files?.[0] || null)}
                    />
                    <AiModePicker
                      value={quickDbAiMode}
                      onChange={setQuickDbAiMode}
                      action={quickDbFile && isHeavyFile(quickDbFile) ? "file_heavy" : "file_light"}
                    />
                    <button className="primary" disabled={!quickDbName.trim() || !quickDbFile || quickFileBusy}>
                      {quickFileBusy ? "Memproses..." : "Upload & olah"}
                    </button>
                  </form>
                  {quickDbStatus && <div className="notice">{quickDbStatus}</div>}
                </article>
              </div>

              {quickDbCreatedId && (
                <div className="quickDatabaseCreated">
                  <span>✓ Database <strong>{quickDbName}</strong> sudah dibuat dan dipilih untuk Study.</span>
                  <button className="ghost" type="button" onClick={() => onOpen(quickDbCreatedId)}>Buka halaman Database</button>
                </div>
              )}
            </section>
          )}

          {path?.status === "error" && path.error_message && (
            <div className="notice">Gagal menyusun sebelumnya: {path.error_message}</div>
          )}
        </section>
      )}

      {path?.status === "processing" && (
        <section className="panel studyProcessing">
          <div className="studyPulse" />
          <div>
            <strong>Sedang menyusun Study...</strong>
            <p>Gemini 3.6 sedang menentukan urutan bab/subbab dan membuat recall quiz.</p>
          </div>
        </section>
      )}

      {path?.status === "ready" && !setupOpen && (
        <>
          <section className="studyOverview">
            <div>
              <small>SUMBER</small>
              <div className="studySourceChips">
                {(path.source_node_ids || []).map((id) => (
                  <span key={id}>{sourceNameMap.get(id) || "Database"}</span>
                ))}
              </div>
            </div>
            {path.overview && (
              <div>
                <small>URUTAN BELAJAR</small>
                <p><RichText text={path.overview} /></p>
              </div>
            )}
            {path.focus_instruction && (
              <div>
                <small>FOKUS BELAJAR</small>
                <p><RichText text={path.focus_instruction} /></p>
              </div>
            )}
          </section>

          <div className="studyTimeline">
            {visibleUnits.map((unit) => {
              const completed = Boolean(unit.completed_at);
              const selected = recallAnswers[unit.id] || "";
              const feedback = recallFeedback[unit.id];

              if (completed) {
                return (
                  <details className="studyUnit completed" key={unit.id}>
                    <summary>
                      <span className="studyUnitNumber">✓</span>
                      <span>
                        <small>{unit.unit_level === "subchapter" ? "SUBBAB" : "BAB"} {unit.position}</small>
                        <strong>{unit.title}</strong>
                      </span>
                    </summary>
                    <div className="studyUnitBody">
                      <div className="studyTeaching"><RichText text={unit.teaching_text} /></div>
                      <div className="recallPassed">Recall selesai · <RichText text={unit.recall_explanation} /></div>
                    </div>
                  </details>
                );
              }

              return (
                <article className="studyUnit active" key={unit.id}>
                  <div className="studyUnitTitle">
                    <span className="studyUnitNumber">{unit.position}</span>
                    <div>
                      <small>{unit.unit_level === "subchapter" ? "SUBBAB" : "BAB"} {unit.position}</small>
                      <h2>{unit.title}</h2>
                    </div>
                  </div>

                  <div className="studyTeaching"><RichText text={unit.teaching_text} /></div>

                  <div className="recallBox">
                    <div className="recallHead">
                      <span>RECALL</span>
                      <strong>Cek pemahaman sebelum lanjut</strong>
                    </div>
                    <h3><RichText text={unit.recall_question} /></h3>

                    <div className="recallChoices">
                      {unit.recall_choices.map((choice) => (
                        <button
                          type="button"
                          key={choice}
                          className={selected === choice ? "selected" : ""}
                          onClick={() => {
                            setRecallAnswers((current) => ({ ...current, [unit.id]: choice }));
                            setRecallFeedback((current) => {
                              const next = { ...current };
                              delete next[unit.id];
                              return next;
                            });
                          }}
                        >
                          <RichText text={choice} />
                        </button>
                      ))}
                    </div>

                    {feedback === "wrong" && (
                      <div className="recallFeedback wrong">
                        Belum tepat. Baca lagi bagian di atas, lalu coba sekali lagi.
                      </div>
                    )}

                    {feedback === "correct" && (
                      <div className="recallFeedback correct">
                        Benar. <RichText text={unit.recall_explanation} />
                      </div>
                    )}

                    <button className="primary recallSubmit" disabled={!selected} onClick={() => checkRecall(unit)}>
                      Cek jawaban
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          {!isFinished && units.length > visibleUnits.length && (
            <div className="studyLockedHint">
              🔒 Materi berikutnya akan muncul setelah recall saat ini benar.
            </div>
          )}

          {isFinished && (
            <section className="studyComplete">
              <div>🏆</div>
              <h2>Study selesai</h2>
              <p>Kamu sudah melewati seluruh bab/subbab dan recall dari Database yang dipilih.</p>
              <button className="ghost" onClick={() => setSetupOpen(true)}>Pelajari sumber lain / susun ulang</button>
            </section>
          )}
        </>
      )}
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
  const liveTextRef = useRef("");

  const liveWsRef = useRef<WebSocket | null>(null);
  const liveReadyRef = useRef(false);
  const liveStoppingRef = useRef(false);
  const liveFinalRef = useRef("");
  const liveInterimRef = useRef("");
  const liveLastFinalRef = useRef("");
  const liveUsageRef = useRef<any>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const audioGainRef = useRef<GainNode | null>(null);
  const browserFallbackStartedRef = useRef(false);

  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [liveText, setLiveText] = useState("");
  const [liveSupported, setLiveSupported] = useState(true);
  const [liveEngine, setLiveEngine] = useState("Belum aktif");
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

  useEffect(() => {
    return () => {
      recordingRef.current = false;
      try { speechRef.current?.stop(); } catch {}
      stopGeminiLive(false);
      try {
        if (recRef.current?.state && recRef.current.state !== "inactive") recRef.current.stop();
      } catch {}
    };
  }, []);

  function setLiveTranscript(value: string) {
    const next = String(value || "").trim();
    liveTextRef.current = next;
    setLiveText(next);
  }

  function resetLiveTranscript() {
    speechFinalRef.current = "";
    liveFinalRef.current = "";
    liveInterimRef.current = "";
    liveLastFinalRef.current = "";
    liveUsageRef.current = null;
    liveReadyRef.current = false;
    browserFallbackStartedRef.current = false;
    setLiveTranscript("");
  }

  function startBrowserSpeech(asFallback = false) {
    if (browserFallbackStartedRef.current && asFallback) return;

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setLiveSupported(false);
      if (asFallback) setLiveEngine("Tidak tersedia");
      return false;
    }

    browserFallbackStartedRef.current = true;
    setLiveSupported(true);
    setLiveEngine(asFallback ? "Browser fallback · tanpa Gemini" : "Browser · tanpa Gemini");

    const recognition = new SpeechRecognition();
    recognition.lang = "id-ID";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event: any) => {
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const text = String(event.results[index][0]?.transcript || "").trim();
        if (!text) continue;
        if (event.results[index].isFinal) {
          speechFinalRef.current = (speechFinalRef.current + " " + text).trim();
        } else {
          interim = (interim + " " + text).trim();
        }
      }
      setLiveTranscript((speechFinalRef.current + " " + interim).trim());
    };

    recognition.onerror = (event: any) => {
      const code = String(event?.error || "");
      if (["not-allowed", "service-not-allowed", "audio-capture"].includes(code)) {
        setLiveSupported(false);
        setLiveEngine("Browser live tidak tersedia");
      }
    };

    recognition.onend = () => {
      if (recordingRef.current && speechRef.current === recognition) {
        window.setTimeout(() => {
          if (!recordingRef.current) return;
          try {
            recognition.start();
          } catch {}
        }, 250);
      }
    };

    speechRef.current = recognition;
    try {
      recognition.start();
      return true;
    } catch {
      setLiveSupported(false);
      setLiveEngine("Browser live tidak tersedia");
      return false;
    }
  }

  function stopBrowserSpeech() {
    try {
      speechRef.current?.stop();
    } catch {}
    speechRef.current = null;
  }

  function pcm16Base64(input: Float32Array, sourceRate: number) {
    const targetRate = 16000;
    const ratio = Math.max(1, sourceRate / targetRate);
    const targetLength = Math.max(1, Math.floor(input.length / ratio));
    const buffer = new ArrayBuffer(targetLength * 2);
    const view = new DataView(buffer);

    for (let i = 0; i < targetLength; i++) {
      const start = Math.floor(i * ratio);
      const end = Math.min(input.length, Math.floor((i + 1) * ratio));
      let sum = 0;
      let count = 0;
      for (let j = start; j < end; j++) {
        sum += input[j];
        count++;
      }
      const sample = Math.max(-1, Math.min(1, count ? sum / count : input[start] || 0));
      view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }

    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
    }
    return btoa(binary);
  }

  function startAudioPump(stream: MediaStream) {
    const AudioContextCtor =
      window.AudioContext || (window as any).webkitAudioContext;

    if (!AudioContextCtor) throw new Error("Web Audio tidak tersedia.");

    const context: AudioContext = new AudioContextCtor();
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    const gain = context.createGain();
    gain.gain.value = 0;

    source.connect(processor);
    processor.connect(gain);
    gain.connect(context.destination);

    processor.onaudioprocess = (event) => {
      const ws = liveWsRef.current;
      if (!recordingRef.current || !liveReadyRef.current || !ws || ws.readyState !== WebSocket.OPEN) return;
      try {
        const pcm = pcm16Base64(event.inputBuffer.getChannelData(0), context.sampleRate);
        ws.send(JSON.stringify({
          realtimeInput: {
            audio: {
              data: pcm,
              mimeType: "audio/pcm;rate=16000",
            },
          },
        }));
      } catch {}
    };

    audioContextRef.current = context;
    audioSourceRef.current = source;
    audioProcessorRef.current = processor;
    audioGainRef.current = gain;
  }

  function stopAudioPump() {
    try { audioProcessorRef.current?.disconnect(); } catch {}
    try { audioSourceRef.current?.disconnect(); } catch {}
    try { audioGainRef.current?.disconnect(); } catch {}
    const context = audioContextRef.current;
    if (context && context.state !== "closed") {
      void context.close().catch(() => {});
    }
    audioProcessorRef.current = null;
    audioSourceRef.current = null;
    audioGainRef.current = null;
    audioContextRef.current = null;
  }

  async function recordLiveUsage() {
    const usage = liveUsageRef.current;
    if (!usage) return;
    const input = Number(usage.promptTokenCount || 0);
    const output = Number(usage.responseTokenCount || 0);
    const thoughts = Number(usage.thoughtsTokenCount || 0);
    const total = Number(usage.totalTokenCount || input + output + thoughts);
    if (!total && !input && !output && !thoughts) return;

    await supabase.rpc("record_ai_model_usage", {
      model_name: "gemini-3.5-transcribe-live",
      input_tokens: input,
      output_tokens: output,
      thoughts_tokens: thoughts,
      total_tokens: total,
    }).then(({ error }) => {
      if (error) console.warn("[LIVE_USAGE_RECORD_FAILED]", error.message);
    });
  }

  async function startGeminiLiveSpeech(stream: MediaStream) {
    liveStoppingRef.current = false;
    setLiveEngine("Gemini 3.5 Transcribe Live · menghubungkan...");

    const response = await fetch("/api/live-transcribe-token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + session.access_token,
      },
      body: JSON.stringify({ aiMode }),
    });
    const data = await response.json();
    if (!response.ok || !data.token) {
      throw new Error(data.error || "Live Transcribe tidak tersedia.");
    }

    const ws = new WebSocket(
      "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=" +
        encodeURIComponent(data.token)
    );
    liveWsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        setup: {
          model: "models/gemini-3.5-transcribe-live",
          generationConfig: {
            responseModalities: ["TEXT"],
          },
          inputAudioTranscription: {
            languageCodes: ["id-ID"],
            mode: "VERBATIM",
          },
        },
      }));
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data || "{}"));

        if (message.setupComplete) {
          liveReadyRef.current = true;
          setLiveEngine("Gemini 3.5 Transcribe Live");
          startAudioPump(stream);
        }

        const server = message.serverContent;
        const interimText = String(server?.interimInputTranscription?.text || "").trim();
        const finalText = String(server?.inputTranscription?.text || "").trim();

        if (finalText) {
          if (finalText !== liveLastFinalRef.current) {
            liveLastFinalRef.current = finalText;
            liveFinalRef.current = (liveFinalRef.current + " " + finalText).trim();
          }
          liveInterimRef.current = "";
          setLiveTranscript(liveFinalRef.current);
        } else if (interimText) {
          liveInterimRef.current = interimText;
          setLiveTranscript((liveFinalRef.current + " " + interimText).trim());
        }

        if (message.usageMetadata) {
          liveUsageRef.current = message.usageMetadata;
        }
      } catch {}
    };

    ws.onerror = () => {
      if (!recordingRef.current || liveStoppingRef.current) return;
      setLiveEngine("Gemini Live gagal · Browser fallback");
      stopAudioPump();
      startBrowserSpeech(true);
    };

    ws.onclose = () => {
      liveReadyRef.current = false;
      stopAudioPump();
      if (recordingRef.current && !liveStoppingRef.current) {
        setLiveEngine("Gemini Live terputus · Browser fallback");
        startBrowserSpeech(true);
      }
    };
  }

  function stopGeminiLive(recordUsage = true) {
    liveStoppingRef.current = true;
    const ws = liveWsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
      } catch {}
    }
    stopAudioPump();

    window.setTimeout(() => {
      if (recordUsage) void recordLiveUsage();
      try { ws?.close(); } catch {}
      if (liveWsRef.current === ws) liveWsRef.current = null;
      liveReadyRef.current = false;
    }, 900);
  }

  async function start() {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Browser ini tidak menyediakan akses mikrofon.");
      }
      if (typeof MediaRecorder === "undefined") {
        throw new Error("Browser ini tidak mendukung perekaman audio.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      const preferredTypes = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
      ];
      const preferred = preferredTypes.find((type) => MediaRecorder.isTypeSupported(type)) || "";
      const recorder = preferred
        ? new MediaRecorder(stream, { mimeType: preferred })
        : new MediaRecorder(stream);

      chunksRef.current = [];
      recRef.current = recorder;
      setResult(null);
      resetLiveTranscript();

      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };

      recorder.onerror = (event: any) => {
        setStatus("Perekaman mengalami error, tetapi audio yang sudah terkumpul akan dipertahankan.");
        console.warn("[MEDIA_RECORDER_ERROR]", event?.error?.message || event?.error || "unknown");
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        if (!blob.size) {
          setBusy(false);
          setStatus("Rekaman kosong. Periksa izin mikrofon lalu coba lagi.");
          return;
        }
        await processRecording(blob);
      };

      startedRef.current = Date.now();
      elapsedRef.current = 0;
      setElapsed(0);
      recordingRef.current = true;
      setRecording(true);
      setStatus("Sedang merekam...");
      recorder.start(750);

      if (aiMode === "simple") {
        const started = startBrowserSpeech(false);
        if (!started) {
          setStatus("Sedang merekam. Transkrip browser tidak tersedia; audio tetap disimpan.");
        }
      } else {
        void startGeminiLiveSpeech(stream).catch((error: any) => {
          console.warn("[GEMINI_LIVE_START_FAILED]", error?.message || "unknown");
          if (!recordingRef.current) return;
          setStatus("Sedang merekam. Gemini Live tidak tersedia, memakai fallback browser.");
          const started = startBrowserSpeech(true);
          if (!started) setLiveEngine("Live transcript tidak tersedia · final transcript tetap dicoba setelah Stop");
        });
      }
    } catch (error: any) {
      const message =
        error?.name === "NotAllowedError"
          ? "Izin mikrofon ditolak. Izinkan mikrofon untuk situs ini lalu coba lagi."
          : error?.name === "NotFoundError"
            ? "Mikrofon tidak ditemukan."
            : error?.message || "Gagal memulai rekaman.";
      setStatus(message);
      alert(message);
    }
  }

  function stop() {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    setRecording(false);
    setStatus(
      aiMode === "simple"
        ? "Rekaman berhenti. Menyimpan transkrip browser..."
        : "Rekaman berhenti. Menyiapkan verbatim final & versi tertata..."
    );
    stopBrowserSpeech();
    stopGeminiLive(aiMode !== "simple");

    try {
      if (recRef.current?.state && recRef.current.state !== "inactive") {
        recRef.current.stop();
      }
    } catch (error: any) {
      setStatus("Gagal menghentikan recorder: " + (error?.message || "unknown"));
    }
  }

  async function processRecording(blob: Blob) {
    setBusy(true);
    const mimeType = normalizeAudioMime(blob.type);
    const subtype = mimeType.split("/")[1]?.split(";")[0] || "webm";
    const ext = subtype === "mp4" || subtype === "m4a" ? "m4a" : subtype;
    const path = user.id + "/" + crypto.randomUUID() + "." + ext;
    const title = "Rekaman " + new Date().toLocaleString("id-ID");
    const currentLiveTranscript = (liveTextRef.current || speechFinalRef.current || liveFinalRef.current).trim();

    const upload = await supabase.storage.from("recordings").upload(path, blob, { contentType: mimeType });
    if (upload.error) {
      setBusy(false);
      setStatus("Gagal upload audio.");
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
      setStatus("Gagal menyimpan data rekaman.");
      return alert(error.message);
    }

    if (aiMode === "simple") {
      if (!currentLiveTranscript) {
        setBusy(false);
        setStatus("Audio tersimpan. Browser tidak menghasilkan transkrip live.");
        onChange();
        return;
      }

      await supabase
        .from("recordings")
        .update({
          raw_transcript: currentLiveTranscript,
          structured_transcript: currentLiveTranscript,
          transcript: currentLiveTranscript,
          corrections: [],
        })
        .eq("id", row.id);

      setBusy(false);
      setResult({
        recordingId: row.id,
        raw: currentLiveTranscript,
        structured: currentLiveTranscript,
        summary: "",
        corrections: [],
        added: false,
      });
      setStatus("Selesai · Simple Browser · tanpa Gemini API.");
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
      if (currentLiveTranscript) {
        await supabase
          .from("recordings")
          .update({
            raw_transcript: currentLiveTranscript,
            structured_transcript: currentLiveTranscript,
            transcript: currentLiveTranscript,
            corrections: [],
          })
          .eq("id", row.id);

        setResult({
          recordingId: row.id,
          raw: currentLiveTranscript,
          structured: currentLiveTranscript,
          summary: "",
          corrections: [],
          added: false,
        });
        setStatus("Audio tersimpan. Model final sedang tidak tersedia; hasil live dipertahankan.");
        onChange();
        return;
      }

      setStatus("Audio tersimpan, tetapi transkripsi final belum berhasil. Bisa dicoba lagi nanti.");
      onChange();
      return alert(data.error || "Transkripsi gagal.");
    }

    setResult({
      recordingId: row.id,
      raw: data.rawTranscript || currentLiveTranscript,
      structured: data.structuredTranscript || data.rawTranscript || currentLiveTranscript,
      summary: data.summary || "",
      corrections: data.corrections || [],
      added: false,
    });
    setStatus(
      "Selesai · transkrip " +
        String(data.transcriptionModel || "Gemini") +
        (data.structuringModel ? " · dirapikan " + data.structuringModel : "")
    );
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
        <p className="muted">
          Simple memakai transkrip browser tanpa Gemini. Mode Gemini memakai Gemini 3.5 Transcribe Live untuk teks langsung,
          lalu membuat verbatim final dan versi tertata setelah Stop. Jika salah satu layanan gagal, audio dan hasil live yang sudah ada tetap dipertahankan.
        </p>
      </div>

      <article className="recordPanel">
        <div className="recordStatus">
          <span className={recording ? "recDot live" : "recDot"} />
          <div>
            <strong>{status}</strong>
            <span>{formatTime(elapsed)}</span>
          </div>
        </div>

        <div className="recordEngineInfo">
          <div>
            <small>MODE TRANSKRIP</small>
            <strong>{aiMode === "simple" ? "Simple · Browser · tanpa API" : liveEngine}</strong>
          </div>
          <AiModePicker value={aiMode} onChange={setAiMode} action="transcription" />
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
            {liveText ||
              (recording
                ? liveSupported
                  ? "Mendengarkan..."
                  : "Live transcript tidak tersedia. Audio tetap direkam dan final transcript akan dicoba setelah Stop."
                : "Tekan Mulai Rekam untuk mulai.")}
          </div>
        </div>

        {busy && (
          <div className="processingBox">
            <div className="spinner" />
            <div>
              <strong>Memproses rekaman...</strong>
              <p>Audio sudah disimpan. Hasil live tidak dibuang bila model final gagal.</p>
            </div>
          </div>
        )}

        {result && (
          <div className="finalTranscript">
            <h2>Hasil Rekaman</h2>

            <div className="resultSection">
              <strong>Versi tertata & terkonteks</strong>
              <div className="dataText"><RichText text={result.structured} /></div>
            </div>

            <details>
              <summary>Verbatim final</summary>
              <div className="dataText raw"><RichText text={result.raw} /></div>
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

function normalizeRichTextSource(text: string) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/(^|\n)([ \t]*)\*[ \t]+(?=\S)/g, "$1$2- ")
    .replace(/(^|\n)([ \t]*)•[ \t]+(?=\S)/g, "$1$2- ")
    .replace(/\*\*([^*\n]+)\*\*/g, "*$1*")
    .replace(/__([^_\n]+)__/g, "_$1_");
}

function RichText({ text, className = "" }: { text: string; className?: string }) {
  const value = normalizeRichTextSource(text);
  const parts: any[] = [];
  const pattern = /(\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(value))) {
    if (match.index > last) parts.push(value.slice(last, match.index));
    const token = match[0];

    if (token.startsWith("**") && token.endsWith("**")) {
      parts.push(<strong key={"b" + key++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("__") && token.endsWith("__")) {
      parts.push(<em key={"i" + key++}>{token.slice(2, -2)}</em>);
    } else if (token.startsWith("*") && token.endsWith("*")) {
      parts.push(<strong key={"b" + key++}>{token.slice(1, -1)}</strong>);
    } else if (token.startsWith("_") && token.endsWith("_")) {
      parts.push(<em key={"i" + key++}>{token.slice(1, -1)}</em>);
    } else {
      parts.push(token);
    }
    last = pattern.lastIndex;
  }

  if (last < value.length) parts.push(value.slice(last));
  return <span className={"richText " + className}>{parts}</span>;
}

function normalizeQuizAnswer(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.!?,;:]+$/g, "");
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
  type AiGradeResult = {
    gradable: boolean;
    correct: boolean;
    score: number;
    feedback: string;
    basis: string;
  };
  type ManualKind = "mcq-fixed" | "essay-fixed" | "mcq-ai" | "essay-ai";

  const mode = node.node_type === "flashcards" ? "flashcards" : "quiz";
  const localCards = cards.filter((item) => item.scope_node_id === node.id);
  const localQuizzes = quizzes.filter((item) => item.scope_node_id === node.id);

  const fixedMcq = localQuizzes.filter((item) => item.quiz_type === "mcq" && item.grading_mode === "fixed");
  const fixedEssay = localQuizzes.filter((item) => item.quiz_type === "essay" && item.grading_mode === "fixed");
  const aiQuizzes = localQuizzes.filter((item) => item.grading_mode === "ai");
  const aiMcq = aiQuizzes.filter((item) => item.quiz_type === "mcq");
  const aiEssay = aiQuizzes.filter((item) => item.quiz_type === "essay");

  const [busy, setBusy] = useState(false);
  const [grading, setGrading] = useState(false);
  const [flipped, setFlipped] = useState<Record<string, boolean>>({});
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [essayAnswers, setEssayAnswers] = useState<Record<string, string>>({});
  const [aiResults, setAiResults] = useState<Record<string, AiGradeResult>>({});
  const [submitted, setSubmitted] = useState(false);
  const [aiMode, setAiMode] = useState<AiMode>("simple");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualKind, setManualKind] = useState<ManualKind>("mcq-fixed");
  const [manualQuestion, setManualQuestion] = useState("");
  const [manualChoices, setManualChoices] = useState(["", "", "", ""]);
  const [manualCorrect, setManualCorrect] = useState(0);
  const [manualExpectedAnswer, setManualExpectedAnswer] = useState("");

  const answeredMcq = [...fixedMcq, ...aiMcq].filter((quiz) => answers[quiz.id]).length;
  const answeredEssay = [...fixedEssay, ...aiEssay].filter((quiz) => essayAnswers[quiz.id]?.trim()).length;
  const totalQuestions = localQuizzes.length;
  const answeredTotal = answeredMcq + answeredEssay;
  const allAnswered = totalQuestions > 0 && answeredTotal === totalQuestions;

  const correctFixedMcq = fixedMcq.filter((quiz) => answers[quiz.id] === quiz.correct_answer).length;
  const correctFixedEssay = fixedEssay.filter(
    (quiz) => normalizeQuizAnswer(essayAnswers[quiz.id] || "") === normalizeQuizAnswer(quiz.correct_answer || "")
  ).length;
  const gradableAiResults = aiQuizzes
    .map((quiz) => aiResults[quiz.id])
    .filter((item): item is AiGradeResult => !!item && item.gradable);
  const correctAi = gradableAiResults.filter((item) => item.correct).length;
  const gradedCount = fixedMcq.length + fixedEssay.length + gradableAiResults.length;
  const totalScorePoints =
    (correctFixedMcq + correctFixedEssay) * 100 +
    gradableAiResults.reduce((sum, item) => sum + item.score, 0);
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

    const isMcq = manualKind === "mcq-fixed" || manualKind === "mcq-ai";
    const isAi = manualKind === "mcq-ai" || manualKind === "essay-ai";
    const choices = manualChoices.map((item) => item.trim()).filter(Boolean);

    if (isMcq && choices.length < 2) {
      return alert("Isi minimal 2 pilihan jawaban.");
    }

    let correctAnswer = "";
    if (manualKind === "mcq-fixed") {
      correctAnswer = manualChoices[manualCorrect]?.trim();
      if (!correctAnswer || !choices.includes(correctAnswer)) {
        return alert("Pilih jawaban benar yang sudah diisi.");
      }
    }

    if (manualKind === "essay-fixed") {
      correctAnswer = manualExpectedAnswer.trim();
      if (!correctAnswer) return alert("Isi jawaban acuan untuk Essay.");
    }

    setBusy(true);
    const { error } = await supabase.from("quizzes").insert({
      user_id: session.user.id,
      material_id: null,
      scope_node_id: node.id,
      question: manualQuestion.trim(),
      choices: isMcq ? choices : [],
      correct_answer: correctAnswer,
      explanation: isAi
        ? "Dinilai Gemini 3.6 hanya berdasarkan Database."
        : manualKind === "essay-fixed"
          ? "Essay dinilai lokal berdasarkan jawaban acuan."
          : "Kuis dibuat manual.",
      quiz_type: isMcq ? "mcq" : "essay",
      grading_mode: isAi ? "ai" : "fixed",
    });
    setBusy(false);
    if (error) return alert(error.message);

    setManualQuestion("");
    setManualChoices(["", "", "", ""]);
    setManualCorrect(0);
    setManualExpectedAnswer("");
    setManualOpen(false);
    resetQuizSession();
    onChange();
  }

  function resetQuizSession() {
    setSubmitted(false);
    setAnswers({});
    setEssayAnswers({});
    setAiResults({});
  }

  async function finishQuiz() {
    if (!allAnswered) return;

    if (aiQuizzes.length) {
      if (aiMode === "simple") {
        return alert("Soal yang dinilai AI membutuhkan Gemini 3.6. Pilih Instant, Medium, atau High terlebih dahulu.");
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
          answers: aiQuizzes.map((quiz) => ({
            quizId: quiz.id,
            answer: quiz.quiz_type === "mcq" ? answers[quiz.id] : essayAnswers[quiz.id],
          })),
        }),
      });
      const data = await response.json();
      setGrading(false);

      if (!response.ok) return alert(data.error || "Gagal menilai jawaban AI.");

      const mapped: Record<string, AiGradeResult> = {};
      (data.results || []).forEach((item: any) => {
        mapped[String(item.id)] = {
          gradable: item.gradable !== false,
          correct: item.correct === true,
          score: Number(item.score || 0),
          feedback: String(item.feedback || ""),
          basis: String(item.basis || ""),
        };
      });
      setAiResults(mapped);
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
    setAiResults((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setSubmitted(false);
    onChange();
  }

  function quizLabel(quiz: Quiz) {
    if (quiz.quiz_type === "mcq" && quiz.grading_mode === "fixed") return "PILIHAN GANDA";
    if (quiz.quiz_type === "essay" && quiz.grading_mode === "fixed") return "ESSAY";
    if (quiz.quiz_type === "mcq" && quiz.grading_mode === "ai") return "PILIHAN GANDA DINILAI AI";
    return "ESSAY DINILAI AI";
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
              <small className="createLabel">AI / MODE PENILAIAN</small>
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

          <div className="quizKindTabs fourKinds">
            {[
              { value: "mcq-fixed" as ManualKind, label: "Pilihan Ganda" },
              { value: "essay-fixed" as ManualKind, label: "Essay" },
              { value: "mcq-ai" as ManualKind, label: "Pilihan ganda dinilai AI" },
              { value: "essay-ai" as ManualKind, label: "Essay dinilai AI" },
            ].map((item) => (
              <button
                type="button"
                key={item.value}
                className={manualKind === item.value ? "active" : ""}
                onClick={() => setManualKind(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <label>
            Pertanyaan
            <textarea rows={3} required value={manualQuestion} onChange={(e) => setManualQuestion(e.target.value)} placeholder="Tulis pertanyaan..." />
          </label>

          {(manualKind === "mcq-fixed" || manualKind === "mcq-ai") && (
            <>
              <div className="manualChoices">
                {manualChoices.map((choice, index) => (
                  <label className="manualChoiceRow" key={index}>
                    {manualKind === "mcq-fixed" ? (
                      <input
                        type="radio"
                        name="manual-correct"
                        checked={manualCorrect === index}
                        onChange={() => setManualCorrect(index)}
                        title="Jawaban benar"
                      />
                    ) : (
                      <span className="aiChoiceDot">AI</span>
                    )}
                    <span>{String.fromCharCode(65 + index)}</span>
                    <input
                      value={choice}
                      onChange={(e) => setManualChoices((current) => current.map((item, i) => i === index ? e.target.value : item))}
                      placeholder={"Pilihan " + String.fromCharCode(65 + index)}
                    />
                  </label>
                ))}
              </div>
              <small className="muted">
                {manualKind === "mcq-fixed"
                  ? "Lingkaran yang dipilih = jawaban benar."
                  : "Gemini 3.6 akan menentukan pilihan yang benar berdasarkan Database saat kuis dinilai."}
              </small>
            </>
          )}

          {manualKind === "essay-fixed" && (
            <label>
              Jawaban acuan
              <textarea
                rows={3}
                required
                value={manualExpectedAnswer}
                onChange={(e) => setManualExpectedAnswer(e.target.value)}
                placeholder="Tulis jawaban yang dianggap benar..."
              />
              <small className="muted">Mode Essay tanpa AI membandingkan jawaban secara lokal dengan jawaban acuan ini.</small>
            </label>
          )}

          {(manualKind === "mcq-ai" || manualKind === "essay-ai") && (
            <div className="essayInfo">
              <strong>Gemini 3.6 akan menentukan benar/salah.</strong>
              <span>Penilaian hanya memakai Database di materi induk. Public Web tidak dipakai untuk penilaian kuis.</span>
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
              <strong><RichText text={flipped[card.id] ? card.back : card.front} /></strong>
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
            </div>
          )}

          {submitted && !!totalQuestions && (
            <div className="quizScore">
              <div className="scoreNumber">{scorePercent}</div>
              <div>
                <small>NILAI AKHIR</small>
                <strong>{correctFixedMcq + correctFixedEssay + correctAi} jawaban dinilai benar · {gradedCount} soal dinilai</strong>
                {aiQuizzes.length !== gradableAiResults.length && (
                  <span className="muted">{aiQuizzes.length - gradableAiResults.length} soal AI tidak cukup sumber untuk dinilai.</span>
                )}
              </div>
            </div>
          )}

          <div className="quizList">
            {localQuizzes.map((quiz, index) => {
              const isMcq = quiz.quiz_type === "mcq";
              const answer = isMcq ? answers[quiz.id] || "" : essayAnswers[quiz.id] || "";
              const aiResult = aiResults[quiz.id];
              const fixedCorrect = isMcq
                ? answer === quiz.correct_answer
                : normalizeQuizAnswer(answer) === normalizeQuizAnswer(quiz.correct_answer || "");

              return (
                <article className="dataCard quizCard" key={quiz.id}>
                  <div className="quizCardHead">
                    <small>{quizLabel(quiz)} · SOAL {index + 1}</small>
                    <button className="dangerSmall" onClick={() => removeQuiz(quiz.id)}>Hapus</button>
                  </div>

                  <h3><RichText text={quiz.question} /></h3>

                  {isMcq ? (
                    quiz.choices.map((choice) => (
                      <button
                        key={choice}
                        disabled={submitted}
                        className={answers[quiz.id] === choice ? "choice selected" : "choice"}
                        onClick={() => setAnswers((value) => ({ ...value, [quiz.id]: choice }))}
                      >
                        <RichText text={choice} />
                      </button>
                    ))
                  ) : (
                    <textarea
                      rows={4}
                      disabled={submitted}
                      value={essayAnswers[quiz.id] || ""}
                      onChange={(e) => setEssayAnswers((current) => ({ ...current, [quiz.id]: e.target.value }))}
                      placeholder="Tulis jawabanmu..."
                    />
                  )}

                  {submitted && quiz.grading_mode === "fixed" && (
                    <div className={fixedCorrect ? "answerState ok" : "answerState bad"}>
                      <strong>{fixedCorrect ? "Benar" : "Salah"}</strong>
                      <br />
                      <span>{isMcq ? "Jawaban" : "Jawaban acuan"}: <RichText text={quiz.correct_answer} /></span>
                      {quiz.explanation && <><br /><RichText text={quiz.explanation} /></>}
                    </div>
                  )}

                  {submitted && quiz.grading_mode === "ai" && aiResult && (
                    <div className={aiResult.correct ? "answerState ok" : "answerState bad"}>
                      <strong>{aiResult.gradable ? (aiResult.correct ? "Benar" : "Belum benar") : "Belum dapat dinilai"} · {aiResult.score}/100</strong>
                      {aiResult.feedback && <><br /><RichText text={aiResult.feedback} /></>}
                      {aiResult.basis && <><br /><small>Dasar Database: <RichText text={aiResult.basis} /></small></>}
                    </div>
                  )}
                </article>
              );
            })}

            {!totalQuestions && <p className="muted">Belum ada kuis.</p>}
          </div>

          {!!totalQuestions && (
            <div className="quizFinishBar">
              {!submitted ? (
                <>
                  <div>
                    <strong>{answeredTotal}/{totalQuestions} terjawab</strong>
                    <span>{allAnswered ? "Semua soal sudah terjawab." : "Jawab semua soal sebelum melihat nilai."}</span>
                  </div>
                  <button
                    className="primary"
                    disabled={!allAnswered || grading}
                    onClick={finishQuiz}
                  >
                    {grading ? "Gemini 3.6 sedang menilai..." : "Selesai & lihat nilai"}
                  </button>
                </>
              ) : (
                <>
                  <div>
                    <strong>Nilai sudah dihitung</strong>
                    <span>Kamu bisa mengulang kuis dari awal.</span>
                  </div>
                  <button className="ghost" onClick={resetQuizSession}>Ulangi kuis</button>
                </>
              )}
            </div>
          )}
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
  allowSimple = true,
}: {
  value: AiMode;
  onChange: (mode: AiMode) => void;
  action: "ask" | "ask_web" | "study" | "transcription" | "file_light" | "file_heavy";
  compact?: boolean;
  allowSimple?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  void action;
  const visibleModes = allowSimple ? aiModes : aiModes.filter((item) => item.provider === "Gemini");
  const selected = visibleModes.find((item) => item.value === value) || visibleModes[0];

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
          <small>{selected.provider === "Gemini" ? selected.model + " · usage aktual" : "Browser · tanpa API"}</small>
        </span>
        <b>⌄</b>
      </button>

      {open && (
        <div className="aiModePopover">
          <div className="aiModeSectionLabel">BROWSER / TANPA API</div>
          {allowSimple && aiModes.filter((item) => item.provider === "Local").map((item) => (
            <button type="button" key={item.value} className={value === item.value ? "aiModeOption active" : "aiModeOption"} onClick={() => choose(item.value)}>
              <span className="modeCheck">{value === item.value ? "✓" : ""}</span>
              <span className="modeCopy">
                <strong>{item.label}</strong>
                <small>{item.hint}</small>
              </span>
              <span className="modeMeta">Browser · tanpa API</span>
            </button>
          ))}

          {allowSimple && <div className="aiModeDivider" />}
          <div className="aiModeSectionLabel">GEMINI MODELS</div>
          {aiModes.filter((item) => item.provider === "Gemini").map((item) => (
            <button type="button" key={item.value} className={value === item.value ? "aiModeOption active" : "aiModeOption"} onClick={() => choose(item.value)}>
              <span className="modeCheck">{value === item.value ? "✓" : ""}</span>
              <span className="modeCopy">
                <strong>{item.label}</strong>
                <small>{item.hint}</small>
              </span>
              <span className="modeMeta">{item.model}</span>
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
  type KnowledgeMode = "database" | "hybrid" | "web";

  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [answerModel, setAnswerModel] = useState("");
  const [sources, setSources] = useState<Array<{ id: string; title: string; category: string }>>([]);
  const [webSources, setWebSources] = useState<Array<{ title: string; uri: string }>>([]);
  const [warning, setWarning] = useState("");
  const [knowledgeMode, setKnowledgeMode] = useState<KnowledgeMode>("database");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [aiMode, setAiMode] = useState<AiMode>("simple");
  const [composerBottom, setComposerBottom] = useState(16);
  const [composerHeight, setComposerHeight] = useState(118);
  const dragRef = useRef<{ y: number; bottom: number } | null>(null);
  const composerRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    if (aiMode === "simple" && knowledgeMode !== "database") {
      setKnowledgeMode("database");
    }
  }, [aiMode, knowledgeMode]);

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

  function knowledgeModeLabel(mode: KnowledgeMode) {
    if (mode === "web") return "Web + Database";
    if (mode === "hybrid") return "AI + Database";
    return "Database";
  }

  async function ask(e: FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;

    setBusy(true);
    setOpen(true);
    setAnswer("");
    setAnswerModel("");
    setSources([]);
    setWebSources([]);
    setWarning("");

    if (aiMode === "simple") {
      const local = answerLocally(question.trim());
      setAnswer(local.text);
      setAnswerModel("Browser / Local");
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
      body: JSON.stringify({ question, scopeNodeId, aiMode, knowledgeMode }),
    });

    const data = await response.json();
    setBusy(false);

    if (!response.ok) {
      setAnswer(data.error || "Terjadi kesalahan.");
      return;
    }

    setAnswer(data.answer || "");
    setAnswerModel(String(data.model || ""));
    setSources(data.sources || []);
    setWebSources(data.webSources || []);
    setWarning(data.warning || "");
    if (data.knowledgeMode === "hybrid" || data.knowledgeMode === "web" || data.knowledgeMode === "database") {
      setKnowledgeMode(data.knowledgeMode);
    }
  }

  const activeKnowledgeLabel = knowledgeModeLabel(knowledgeMode);

  return (
    <>
      {open && (
        <div className="aiAnswer" style={{ bottom: composerBottom + composerHeight + 12 }}>
          <div className="aiAnswerHead">
            <div>
              <small title={scopeName}>
                {aiMode === "simple" ? "Simple · Browser" : aiMode[0].toUpperCase() + aiMode.slice(1)}
                {" · "}{activeKnowledgeLabel}
                {answerModel ? " · " + answerModel : ""}
                {" · "}{scopeName}
              </small>
              <strong>{question}</strong>
            </div>
            <button onClick={() => setOpen(false)}>×</button>
          </div>
          {warning && <div className="aiWarning"><RichText text={warning} /></div>}
          <div className="aiAnswerBody">
            {busy
              ? aiMode === "simple"
                ? "Mencari secara lokal di Database..."
                : knowledgeMode === "web"
                  ? "Mencari di Database dan Web..."
                  : knowledgeMode === "hybrid"
                    ? "Menganalisis Database + pengetahuan AI..."
                    : "Mencari di Database..."
              : <RichText text={answer || "..."} />}
          </div>
          {(!!sources.length || !!webSources.length) && (
            <div className="aiSources">
              {sources.map((source) => (
                <span key={source.id}>Database · {source.title}</span>
              ))}
              {webSources.map((source) => (
                <a key={source.uri} href={source.uri} target="_blank" rel="noreferrer">
                  Web · {source.title}
                </a>
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
          <div className="askScope" title={scopeName}>AI · {scopeName}</div>
          <div className="askControls">
            <div className="knowledgeModePicker" role="group" aria-label="Sumber jawaban">
              <button
                type="button"
                className={knowledgeMode === "database" ? "active" : ""}
                onClick={() => setKnowledgeMode("database")}
                title="Jawab hanya dari Database yang dipilih"
              >
                DB
              </button>
              <button
                type="button"
                className={knowledgeMode === "hybrid" ? "active" : ""}
                disabled={aiMode === "simple"}
                onClick={() => setKnowledgeMode("hybrid")}
                title="Database utama + pengetahuan internal model, tanpa browsing"
              >
                AI+DB
              </button>
              <button
                type="button"
                className={knowledgeMode === "web" ? "active" : ""}
                disabled={aiMode === "simple"}
                onClick={() => setKnowledgeMode("web")}
                title="Database + Google Search"
              >
                🌐 Web
              </button>
            </div>
            <AiModePicker
              value={aiMode}
              onChange={setAiMode}
              action={knowledgeMode === "web" ? "ask_web" : "ask"}
              compact
            />
          </div>
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
          placeholder={
            knowledgeMode === "web"
              ? "Tanya dari Database + Web..."
              : knowledgeMode === "hybrid"
                ? "Tanya dari Database + pengetahuan AI..."
                : "Tanya sesuatu dari Database..."
          }
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

function formatTokenUsage(value: number) {
  if (value >= 1_000_000) return (value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1) + "M";
  if (value >= 1_000) return (value / 1_000).toFixed(value >= 100_000 ? 0 : 1) + "K";
  return String(value);
}

function AiCreditBadge() {
  const [totalTokens, setTotalTokens] = useState<number | null>(null);
  const [inputTokens, setInputTokens] = useState(0);
  const [outputTokens, setOutputTokens] = useState(0);
  const [activeAccounts, setActiveAccounts] = useState(0);

  useEffect(() => {
    let active = true;

    async function load() {
      const { data } = await supabase.rpc("get_ai_usage_today");
      if (!active || !data) return;
      setTotalTokens(Number(data.total_tokens ?? 0));
      setInputTokens(Number(data.input_tokens ?? 0));
      setOutputTokens(Number(data.output_tokens ?? 0));
      const activeCount = Number(data.actual_active_accounts ?? data.active_accounts ?? 0);
      setActiveAccounts(Number.isFinite(activeCount) ? activeCount : 0);
    }

    void load();
    const timer = window.setInterval(load, 15000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <span
      className="aiCreditPill"
      title={
        "Usage asli dari Gemini API · input " +
        formatTokenUsage(inputTokens) +
        " token · output " +
        formatTokenUsage(outputTokens) +
        " token · " +
        activeAccounts +
        " akun aktif hari ini"
      }
    >
      Gemini hari ini: {totalTokens === null ? "..." : formatTokenUsage(totalTokens) + " token"} · {activeAccounts} aktif
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
          <span><RichText text={item.heard} /></span>
          <b>→</b>
          <span><RichText text={item.corrected} /></span>
          {item.basis && <small><RichText text={item.basis} /></small>}
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
  if (type === "study") return "ST";
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

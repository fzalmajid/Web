"use client";

// Production UI baseline: Choose Model + AI / Database / Web + Plugin center.

import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, PointerEvent as ReactPointerEvent } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import {
  AI_MODEL_CATALOG,
  defaultSelection,
  legacyModeForSelection,
  modelCapability,
  modelProvider,
  providerModelId,
  selectionFromLegacyMode,
  type AiEffort,
  type AiModelId,
  type AiSelection,
} from "@/lib/aiModels";

const AUTH_REDIRECT_URL = "https://web-fzalmajid.vercel.app";

type NodeType = "material" | "submaterial" | "database" | "recording" | "flashcards" | "quiz" | "study";
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
  source_kind?: "file" | "link";
  source_url?: string | null;
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
  ai_model?: AiModelId | null;
  ai_effort?: AiEffort | null;
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

const GOOGLE_OAUTH_CLIENT_ID =
  process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID ||
  "42957287889-qgsdslbqcipbuatleep800hjb8na9s25.apps.googleusercontent.com";

function getSessionGeminiKey() {
  if (typeof window === "undefined") return "";
  return String(window.sessionStorage.getItem("rb-user-gemini-key") || "").trim();
}

function getSessionOpenAIKey() {
  if (typeof window === "undefined") return "";
  return String(window.sessionStorage.getItem("rb-user-openai-key") || "").trim();
}

function getSessionAnthropicKey() {
  if (typeof window === "undefined") return "";
  return String(window.sessionStorage.getItem("rb-user-anthropic-key") || "").trim();
}


type LocalAiKind = "lmstudio" | "ollama" | "custom";
type LocalAiConfig = {
  kind: LocalAiKind;
  endpoint: string;
  apiKey: string;
  models: string[];
};

function getSessionLocalAiConfig(): LocalAiConfig {
  if (typeof window === "undefined") {
    return { kind: "lmstudio", endpoint: "", apiKey: "", models: [] };
  }
  const kind = String(window.sessionStorage.getItem("rb-local-ai-kind") || "lmstudio") as LocalAiKind;
  const endpoint = String(window.sessionStorage.getItem("rb-local-ai-endpoint") || "").trim();
  const apiKey = String(window.sessionStorage.getItem("rb-local-ai-key") || "").trim();
  return {
    kind,
    endpoint,
    apiKey,
    models: getStoredModelIds("rb-local-ai-models"),
  };
}

function localAiPresetEndpoint(kind: LocalAiKind) {
  if (kind === "ollama") return "http://localhost:11434/v1";
  if (kind === "lmstudio") return "http://localhost:1234/v1";
  return "";
}

function localAiModelId(model: string): AiModelId {
  return ("local-openai:" + model) as AiModelId;
}


type McpTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, any>;
};

type McpConfig = {
  url: string;
  token: string;
  sessionId: string;
  tools: McpTool[];
};

function getSessionMcpConfig(): McpConfig {
  if (typeof window === "undefined") return { url: "", token: "", sessionId: "", tools: [] };
  let tools: McpTool[] = [];
  try {
    const parsed = JSON.parse(String(window.sessionStorage.getItem("rb-mcp-tools") || "[]"));
    if (Array.isArray(parsed)) tools = parsed;
  } catch {}
  return {
    url: String(window.sessionStorage.getItem("rb-mcp-url") || "").trim(),
    token: String(window.sessionStorage.getItem("rb-mcp-token") || "").trim(),
    sessionId: String(window.sessionStorage.getItem("rb-mcp-session") || "").trim(),
    tools,
  };
}

function parseMcpResponseText(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch {}

  const events = trimmed
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter((line) => line && line !== "[DONE]");

  for (let index = events.length - 1; index >= 0; index--) {
    try {
      return JSON.parse(events[index]);
    } catch {}
  }
  return {};
}

async function mcpRpc(
  url: string,
  token: string,
  method: string,
  params: Record<string, any> | undefined,
  sessionId = "",
  notification = false
) {
  const id = notification ? undefined : Date.now();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      ...(id === undefined ? {} : { id }),
      method,
      ...(params === undefined ? {} : { params }),
    }),
  });

  const nextSessionId = response.headers.get("Mcp-Session-Id") || sessionId;
  const text = await response.text();
  const payload = parseMcpResponseText(text);

  if (!response.ok || payload?.error) {
    throw new Error(
      String(payload?.error?.message || "MCP request gagal (" + response.status + ").")
    );
  }

  return {
    result: payload?.result,
    sessionId: nextSessionId,
  };
}

async function ensureMcpSession(config: McpConfig) {
  if (!config.url) return config;
  if (config.sessionId && config.tools.length) return config;

  const initialized = await mcpRpc(
    config.url,
    config.token,
    "initialize",
    {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "Ruang Belajar", version: "1.0" },
    },
    ""
  );
  const sessionId = initialized.sessionId;
  await mcpRpc(
    config.url,
    config.token,
    "notifications/initialized",
    {},
    sessionId,
    true
  );
  const listed = await mcpRpc(config.url, config.token, "tools/list", {}, sessionId);
  const tools = Array.isArray(listed.result?.tools) ? listed.result.tools : [];

  window.sessionStorage.setItem("rb-mcp-session", listed.sessionId || sessionId);
  window.sessionStorage.setItem("rb-mcp-tools", JSON.stringify(tools));
  return { ...config, sessionId: listed.sessionId || sessionId, tools };
}

function emitPluginChange() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("rb-plugin-change"));
}

function getStoredModelIds(key: string) {
  if (typeof window === "undefined") return [] as string[];
  try {
    const value = JSON.parse(String(window.sessionStorage.getItem(key) || "[]"));
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    return [];
  }
}

function setStoredModelIds(key: string, ids: unknown[]) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(key, JSON.stringify(ids.map(String).filter(Boolean)));
}

function activeGeminiModelIds() {
  const own = getSessionGoogleGeminiAuth().accessToken || getSessionGeminiKey();
  return own ? getStoredModelIds("rb-gemini-models") : getStoredModelIds("rb-shared-gemini-models");
}

function getSessionGoogleGeminiAuth() {
  if (typeof window === "undefined") return { accessToken: "", projectId: "" };
  const accessToken = String(window.sessionStorage.getItem("rb-google-gemini-token") || "").trim();
  const projectId = String(window.sessionStorage.getItem("rb-google-gemini-project") || "").trim();
  const expiresAt = Number(window.sessionStorage.getItem("rb-google-gemini-exp") || "0");

  if (accessToken && expiresAt && Date.now() >= expiresAt - 30_000) {
    window.sessionStorage.removeItem("rb-google-gemini-token");
    window.sessionStorage.removeItem("rb-google-gemini-exp");
    return { accessToken: "", projectId };
  }

  return { accessToken, projectId };
}

function aiRequestHeaders(session: Session, selection?: AiSelection) {
  const googleAuth = getSessionGoogleGeminiAuth();
  const geminiKey = googleAuth.accessToken && googleAuth.projectId ? "" : getSessionGeminiKey();
  const openAIKey = getSessionOpenAIKey();
  const anthropicKey = getSessionAnthropicKey();

  return {
    "Content-Type": "application/json",
    Authorization: "Bearer " + session.access_token,
    ...(googleAuth.accessToken && googleAuth.projectId
      ? {
          "X-RB-Google-Access-Token": googleAuth.accessToken,
          "X-RB-Google-Project": googleAuth.projectId,
        }
      : geminiKey
        ? { "X-RB-Gemini-Key": geminiKey }
        : {}),
    ...(openAIKey ? { "X-RB-OpenAI-Key": openAIKey } : {}),
    ...(anthropicKey ? { "X-RB-Anthropic-Key": anthropicKey } : {}),
    ...(selection ? { "X-RB-AI-Model": selection.model, "X-RB-AI-Effort": selection.effort } : {}),
  };
}

function loadGoogleIdentityScript() {
  return new Promise<void>((resolve, reject) => {
    if ((window as any).google?.accounts?.oauth2) return resolve();

    const existing = document.querySelector<HTMLScriptElement>('script[data-rb-google-oauth="1"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Google Identity Services gagal dimuat.")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.dataset.rbGoogleOauth = "1";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google Identity Services gagal dimuat."));
    document.head.appendChild(script);
  });
}

async function checkLeakedPassword(password: string) {
  const bytes = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  const sha1 = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  const response = await fetch("/api/password-range", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prefix }),
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Pemeriksaan keamanan password sedang tidak tersedia.");
  }

  const match = Array.isArray(data.suffixes)
    ? data.suffixes.find((item: any) => String(item?.suffix || "").toUpperCase() === suffix)
    : null;

  return {
    leaked: Boolean(match),
    count: Number(match?.count || 0),
  };
}

const labels: Record<NodeType, string> = {
  material: "Materi",
  submaterial: "Materi",
  database: "Folder",
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
  const [resendBusy, setResendBusy] = useState(false);

  function signupPasswordError(value: string) {
    if (value.length < 6) return "Password minimal 6 karakter.";
    return "";
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMessage("");

    if (mode === "signup") {
      const policyError = signupPasswordError(password);
      if (policyError) {
        setMessage(policyError);
        return;
      }

      setBusy(true);
      try {
        const leaked = await checkLeakedPassword(password);
        if (leaked.leaked) {
          setBusy(false);
          setMessage(
            "Password ini ditemukan dalam data kebocoran publik dan tidak boleh digunakan. Pilih password unik yang belum pernah dipakai di layanan lain."
          );
          return;
        }
      } catch (error: any) {
        setBusy(false);
        setMessage(error?.message || "Pemeriksaan keamanan password gagal. Coba lagi.");
        return;
      }
    } else {
      setBusy(true);
    }

    const result =
      mode === "login"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: AUTH_REDIRECT_URL },
          });

    if (result.error) setMessage(result.error.message);
    else if (mode === "signup" && !result.data.session) {
      setMessage("Akun dibuat. Klik link verifikasi di email; akun akan langsung terverifikasi dan kembali ke Ruang Belajar.");
    }

    setBusy(false);
  }

  async function resendVerification() {
    const target = email.trim();
    if (!target) {
      setMessage("Masukkan email akun yang ingin diverifikasi.");
      return;
    }

    setResendBusy(true);
    setMessage("");
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: target,
      options: { emailRedirectTo: AUTH_REDIRECT_URL },
    });
    setResendBusy(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage("Email verifikasi baru sudah dikirim. Gunakan email TERBARU; link lama bisa masih mengarah ke localhost.");
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
            <input
              type="password"
              required
              minLength={6}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {mode === "signup" && (
              <small className="muted">Minimal 6 karakter. Password yang pernah bocor tidak dapat digunakan.</small>
            )}
          </label>
          <button className="primary" disabled={busy}>
            {busy ? "Memproses..." : mode === "login" ? "Masuk" : "Buat akun"}
          </button>
        </form>

        {message && <div className="notice">{message}</div>}

        <button className="textBtn" onClick={() => setMode(mode === "login" ? "signup" : "login")}>
          {mode === "login" ? "Belum punya akun? Daftar" : "Sudah punya akun? Masuk"}
        </button>
        <button className="textBtn" type="button" disabled={resendBusy} onClick={resendVerification}>
          {resendBusy ? "Mengirim..." : "Kirim ulang email verifikasi"}
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    void loadAll();
  }, [refreshKey]);

  useEffect(() => {
    const openPlugins = () => setSettingsOpen(true);
    window.addEventListener("rb-open-plugins", openPlugins);
    return () => window.removeEventListener("rb-open-plugins", openPlugins);
  }, []);

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
            session={session}
            user={user}
            current={current}
            children={children}
            nodes={nodes}
            entries={entries}
            files={files}
            recordings={recordings}
            onOpen={setCurrentId}
            onAdd={() => setAddOpen(true)}
            onCustomize={setCustomizeNode}
            onDelete={removeNode}
            onChange={refresh}
          />
        ) : null}

        {current?.node_type === "database" && (
          <DatabasePage
            session={session}
            user={user}
            node={current}
            entries={entries}
            files={files}
            recordings={recordings}
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
        onChange={refresh}
      />

      {settingsOpen && (
        <div className="sheetBackdrop" onMouseDown={() => setSettingsOpen(false)}>
          <section className="addSheet settingsSheet pluginSheet" onMouseDown={(e) => e.stopPropagation()}>
            <div className="sheetHead">
              <div>
                <p className="eyebrow">AI PLUGINS</p>
                <h2>+ Plugin</h2>
              </div>
              <button className="closeBtn" onClick={() => setSettingsOpen(false)}>×</button>
            </div>

            <p className="muted pluginIntro">
              Hubungkan provider milik user. Model dari provider yang belum terhubung tidak akan muncul di Choose Model.
            </p>

            <div className="pluginSection">
              <small className="pluginSectionTitle">CLOUD AI</small>
              <div className="pluginGrid">
                <article className="pluginCard">
                  <div className="pluginLogo">G</div>
                  <div className="pluginCopy">
                    <strong>Gemini</strong>
                    <small>Google Cloud/Gemini API milik user. OAuth Google + project sendiri.</small>
                  </div>
                  <GeminiAccountConnection session={session} />
                </article>

                <article className="pluginCard">
                  <div className="pluginLogo">GPT</div>
                  <div className="pluginCopy">
                    <strong>OpenAI</strong>
                    <small>Gunakan OpenAI API account user untuk GPT dan Web Search.</small>
                  </div>
                  <ApiProviderConnection session={session} provider="openai" />
                </article>

                <article className="pluginCard">
                  <div className="pluginLogo">C</div>
                  <div className="pluginCopy">
                    <strong>Claude</strong>
                    <small>Gunakan Anthropic API account user dan web search Claude.</small>
                  </div>
                  <ApiProviderConnection session={session} provider="anthropic" />
                </article>
              </div>
            </div>

            <div className="pluginSection">
              <small className="pluginSectionTitle">LOCAL DEVICE / CUSTOM ENDPOINT</small>
              <div className="pluginGrid pluginGridTwo">
                <article className="pluginCard">
                  <div className="pluginLogo">⌁</div>
                  <div className="pluginCopy">
                    <strong>Local AI</strong>
                    <small>LM Studio, Ollama, vLLM, atau endpoint OpenAI-compatible. Model berjalan di perangkat/server user.</small>
                  </div>
                  <LocalAiConnection />
                </article>

                <article className="pluginCard">
                  <div className="pluginLogo">MCP</div>
                  <div className="pluginCopy">
                    <strong>MCP Server</strong>
                    <small>Hubungkan tools/app lain lewat Model Context Protocol. Tool dapat dipanggil model lokal yang mendukung function calling.</small>
                  </div>
                  <McpConnection />
                </article>
              </div>
            </div>
          </section>
        </div>
      )}

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
          session={session}
          user={user}
          parent={current}
          onClose={() => setAddOpen(false)}
          onAdded={() => {
            setAddOpen(false);
            refresh();
          }}
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


function isFolderLikeNode(node: StudyNode) {
  return node.node_type === "material" || node.node_type === "submaterial" || node.node_type === "database";
}

function clientReadableTextFile(file: File) {
  const mime = inferMime(file);
  return (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/xml" ||
    /\.(txt|md|csv|json|xml)$/i.test(file.name)
  );
}

async function saveRawFileToFolder(user: User, nodeId: string, file: File) {
  const mimeType = inferMime(file) || "application/octet-stream";
  if (file.size > 50 * 1024 * 1024) throw new Error("File maksimal 50 MB.");

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_");
  const path = user.id + "/" + nodeId + "/" + crypto.randomUUID() + "-" + safeName;

  const upload = await supabase.storage.from("study-files").upload(path, file, { contentType: mimeType });
  if (upload.error) throw upload.error;

  let rawText = "";
  if (clientReadableTextFile(file)) {
    try { rawText = (await file.text()).trim(); } catch {}
  }

  const { data: row, error } = await supabase
    .from("source_files")
    .insert({
      user_id: user.id,
      node_id: nodeId,
      file_path: path,
      file_name: file.name,
      mime_type: mimeType,
      size_bytes: file.size,
      processing_status: "ready",
      raw_text: rawText || null,
      structured_text: null,
      corrections: [],
      error_message: null,
      source_kind: "file",
      source_url: null,
    })
    .select("*")
    .single();

  if (error) {
    await supabase.storage.from("study-files").remove([path]);
    throw error;
  }

  if (rawText) {
    const { error: entryError } = await supabase.from("knowledge_entries").insert({
      user_id: user.id,
      node_id: nodeId,
      title: file.name,
      category: "RAW file",
      content: rawText,
      raw_content: rawText,
      source_type: "file",
      source_file_id: row.id,
    });
    if (entryError) {
      await supabase.from("source_files").delete().eq("id", row.id);
      await supabase.storage.from("study-files").remove([path]);
      throw entryError;
    }
  }

  return row as SourceFile;
}

async function moveExplorerItemToFolder(
  kind: "file" | "recording" | "entry",
  id: string,
  targetNodeId: string
) {
  if (kind === "file") {
    const { error } = await supabase.from("source_files").update({ node_id: targetNodeId }).eq("id", id);
    if (error) throw error;
    const { error: entryError } = await supabase
      .from("knowledge_entries")
      .update({ node_id: targetNodeId })
      .eq("source_file_id", id);
    if (entryError) throw entryError;
    return;
  }

  if (kind === "recording") {
    const { data: recording, error: readError } = await supabase
      .from("recordings")
      .select("knowledge_entry_id")
      .eq("id", id)
      .single();
    if (readError) throw readError;

    const { error } = await supabase.from("recordings").update({ node_id: targetNodeId }).eq("id", id);
    if (error) throw error;

    if (recording?.knowledge_entry_id) {
      const { error: entryError } = await supabase
        .from("knowledge_entries")
        .update({ node_id: targetNodeId })
        .eq("id", recording.knowledge_entry_id);
      if (entryError) throw entryError;
    }
    return;
  }

  const { error } = await supabase.from("knowledge_entries").update({ node_id: targetNodeId }).eq("id", id);
  if (error) throw error;
}

function setExplorerDragData(
  event: any,
  kind: "file" | "recording" | "entry",
  id: string
) {
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("application/x-rb-explorer-item", JSON.stringify({ kind, id }));
}

function FolderPage({
  session,
  user,
  current,
  children,
  entries,
  files,
  recordings,
  onOpen,
  onAdd,
  onCustomize,
  onDelete,
  onChange,
}: {
  session: Session;
  user: User;
  current: StudyNode | null;
  children: StudyNode[];
  nodes: StudyNode[];
  entries: KnowledgeEntry[];
  files: SourceFile[];
  recordings: Recording[];
  onOpen: (id: string) => void;
  onAdd: () => void;
  onCustomize: (node: StudyNode) => void;
  onDelete: (node: StudyNode) => void;
  onChange: () => void;
}) {
  const [dropActive, setDropActive] = useState(false);
  const [dropBusy, setDropBusy] = useState(false);

  const localFiles = current ? files.filter((item) => item.node_id === current.id) : [];
  const localRecordings = current ? recordings.filter((item) => item.node_id === current.id) : [];
  const recordingEntryIds = new Set(
    localRecordings.map((item) => item.knowledge_entry_id).filter(Boolean)
  );
  const localEntries = current
    ? entries.filter(
        (item) =>
          item.node_id === current.id &&
          !item.source_file_id &&
          !recordingEntryIds.has(item.id)
      )
    : [];

  const hasAssets = !!(localFiles.length || localRecordings.length || localEntries.length);

  async function uploadFiles(targetNodeId: string, list: FileList | File[]) {
    const incoming = Array.from(list);
    if (!incoming.length) return;
    setDropBusy(true);
    try {
      for (const file of incoming) {
        await saveRawFileToFolder(user, targetNodeId, file);
      }
      onChange();
    } catch (error: any) {
      alert(error?.message || "Gagal menyimpan file.");
    } finally {
      setDropBusy(false);
      setDropActive(false);
    }
  }

  async function moveDroppedItem(event: any, targetNodeId: string) {
    const raw = event.dataTransfer?.getData("application/x-rb-explorer-item");
    if (!raw) return false;
    try {
      const item = JSON.parse(raw);
      if (!["file", "recording", "entry"].includes(item?.kind) || !item?.id) return false;
      await moveExplorerItemToFolder(item.kind, String(item.id), targetNodeId);
      onChange();
      return true;
    } catch (error: any) {
      alert(error?.message || "Gagal memindahkan item.");
      return true;
    }
  }

  async function handlePageDrop(event: any) {
    event.preventDefault();
    setDropActive(false);
    if (!current) return;
    if (await moveDroppedItem(event, current.id)) return;
    if (event.dataTransfer?.files?.length) {
      await uploadFiles(current.id, event.dataTransfer.files);
    }
  }

  async function handleFolderDrop(event: any, target: StudyNode) {
    event.preventDefault();
    event.stopPropagation();
    if (!isFolderLikeNode(target)) return;
    if (await moveDroppedItem(event, target.id)) return;
    if (event.dataTransfer?.files?.length) {
      await uploadFiles(target.id, event.dataTransfer.files);
    }
  }

  async function removeEntry(id: string) {
    if (!confirm("Hapus catatan ini dari folder?")) return;
    const { error } = await supabase.from("knowledge_entries").delete().eq("id", id);
    if (error) alert(error.message);
    else onChange();
  }

  async function removeFile(file: SourceFile) {
    if (!confirm("Hapus file ini dari folder?")) return;
    await supabase.from("knowledge_entries").delete().eq("source_file_id", file.id);
    if (file.source_kind !== "link") {
      await supabase.storage.from("study-files").remove([file.file_path]);
    }
    const { error } = await supabase.from("source_files").delete().eq("id", file.id);
    if (error) alert(error.message);
    else onChange();
  }

  async function removeRecording(item: Recording) {
    if (!confirm("Hapus rekaman ini dari folder?")) return;
    await supabase.storage.from("recordings").remove([item.file_path]);
    if (item.knowledge_entry_id) {
      await supabase.from("knowledge_entries").delete().eq("id", item.knowledge_entry_id);
    }
    const { error } = await supabase.from("recordings").delete().eq("id", item.id);
    if (error) alert(error.message);
    else onChange();
  }

  return (
    <section
      className={dropActive ? "folderPage explorerDropActive" : "folderPage"}
      onDragOver={(event) => {
        if (!current) return;
        event.preventDefault();
        setDropActive(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDropActive(false);
      }}
      onDrop={handlePageDrop}
    >
      <div className="folderTitle folderTitleRow">
        <div>
          <p className="eyebrow">{current ? "FOLDER BELAJAR" : "RUANG BELAJAR"}</p>
          <h1>{current ? (current.emoji ? current.emoji + " " : "") + current.title : "Materi saya"}</h1>
          {current && (
            <p className="muted explorerHint">
              Folder ini sekaligus Database. Drop file/foto/audio di sini, atau tekan + untuk menambah file, link, teks, rekaman, subfolder, Study, Flashcard, atau Kuis.
            </p>
          )}
        </div>
        {current && <button className="ghost customizeTop" onClick={() => onCustomize(current)}>Sesuaikan</button>}
      </div>

      {!!children.length && (
        <div className="nodeGrid explorerNodeGrid">
          {children.map((node) => (
            <article
              className="nodeCard"
              data-color={node.card_color || "default"}
              key={node.id}
              onDragOver={(event) => {
                if (!isFolderLikeNode(node)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }}
              onDrop={(event) => void handleFolderDrop(event, node)}
            >
              <button className="nodeOpen" onClick={() => onOpen(node.id)}>
                <span className="nodeIcon">{node.emoji || (isFolderLikeNode(node) ? "📁" : iconFor(node.node_type))}</span>
                <div>
                  <small>{isFolderLikeNode(node) ? "Folder" : labels[node.node_type]}</small>
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

      {current && (
        <section className="folderAssets">
          <div className="folderAssetsHead">
            <div>
              <small>ISI FOLDER · RAW/ORIGINAL</small>
              <strong>{localFiles.length + localRecordings.length + localEntries.length} item</strong>
            </div>
            <span>{dropBusy ? "Mengupload..." : "Tarik & drop file ke area folder"}</span>
          </div>

          {!hasAssets && (
            <div className="explorerEmpty">
              <span>📂</span>
              <p>Belum ada file atau catatan. Drop file di sini atau tekan +.</p>
            </div>
          )}

          <div className="explorerItems">
            {localEntries.map((entry) => (
              <article
                className="explorerTextItem"
                key={entry.id}
                draggable
                onDragStart={(event) => setExplorerDragData(event, "entry", entry.id)}
              >
                <div className="explorerItemMain">
                  <span className="explorerFileIcon">📝</span>
                  <div>
                    <small>{entry.category || "Catatan RAW"}</small>
                    <strong>{entry.title}</strong>
                  </div>
                </div>
                <details>
                  <summary>Lihat isi</summary>
                  <div className="dataText raw"><RichText text={entry.raw_content || entry.content} /></div>
                </details>
                <button className="dangerSmall" type="button" onClick={() => removeEntry(entry.id)}>Hapus</button>
              </article>
            ))}

            {localFiles.map((file) => (
              <DatabaseFileCard
                key={file.id}
                file={file}
                draggable
                onDragStart={(event) => setExplorerDragData(event, "file", file.id)}
                onDelete={() => removeFile(file)}
              />
            ))}

            {localRecordings.map((item) => (
              <DatabaseStoredRecording
                key={item.id}
                item={item}
                draggable
                onDragStart={(event) => setExplorerDragData(event, "recording", item.id)}
                onDelete={() => removeRecording(item)}
              />
            ))}
          </div>
        </section>
      )}

      {!children.length && !hasAssets && !current && (
        <div className="emptyFolder">
          <p>Belum ada folder. Tekan + untuk membuat folder pertama.</p>
        </div>
      )}

      {dropActive && current && (
        <div className="explorerDropOverlay">
          <strong>Drop ke {current.title}</strong>
          <small>File asli akan disimpan sebagai RAW/original.</small>
        </div>
      )}

      <button className="bigPlus" onClick={onAdd} aria-label="Tambah">+</button>
    </section>
  );
}

function AddSheet({
  session,
  user,
  parent,
  onClose,
  onCreated,
  onAdded,
}: {
  session: Session;
  user: User;
  parent: StudyNode | null;
  onClose: () => void;
  onCreated: (id: string) => void;
  onAdded: () => void;
}) {
  const [kind, setKind] = useState<
    "folder" | "file" | "link" | "text" | "recording" | "flashcards" | "quiz" | "study"
  >("folder");
  const [title, setTitle] = useState("");
  const [emoji, setEmoji] = useState("");
  const [cardColor, setCardColor] = useState("default");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [textContent, setTextContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const options = [
    { value: "folder", label: "Folder", hint: "Buat folder / subfolder materi" },
    ...(parent
      ? [
          { value: "file" as const, label: "Upload file / foto", hint: "PDF, dokumen, gambar, audio, video, atau file mentah" },
          { value: "link" as const, label: "Masukkan link", hint: "Simpan halaman web sebagai sumber RAW" },
          { value: "text" as const, label: "Masukkan teks", hint: "Catatan atau materi mentah langsung ke folder" },
          { value: "recording" as const, label: "🎙️ Rekam audio", hint: "Rekaman + transkrip verbatim langsung ke folder" },
          { value: "study" as const, label: "Study", hint: "Belajar bertahap dari isi folder" },
        ]
      : []),
    { value: "flashcards", label: "Flashcard", hint: "Latihan kartu dari isi folder" },
    { value: "quiz", label: "Kuis", hint: "Soal dari isi folder" },
  ] as const;

  async function createNode(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const nodeType: NodeType =
      kind === "folder"
        ? parent ? "submaterial" : "material"
        : kind as "flashcards" | "quiz" | "study";

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

  async function addFile(e: FormEvent) {
    e.preventDefault();
    if (!parent || !selectedFile) return;
    setBusy(true);
    setStatus("Menyimpan file asli...");
    try {
      await saveRawFileToFolder(user, parent.id, selectedFile);
      setStatus("File RAW/original sudah masuk folder.");
      onAdded();
    } catch (error: any) {
      setStatus("");
      alert(error?.message || "Gagal menyimpan file.");
    } finally {
      setBusy(false);
    }
  }

  async function addLink(e: FormEvent) {
    e.preventDefault();
    if (!parent || !linkUrl.trim()) return;
    setBusy(true);
    setStatus("Membaca link RAW...");
    const response = await fetch("/api/import-link", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + session.access_token,
      },
      body: JSON.stringify({ nodeId: parent.id, url: linkUrl.trim() }),
    });
    const result = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      setStatus("");
      return alert(result.error || "Gagal membaca link.");
    }
    setStatus("Link RAW sudah masuk folder.");
    onAdded();
  }

  async function addText(e: FormEvent) {
    e.preventDefault();
    if (!parent || !textContent.trim()) return;
    setBusy(true);
    const finalTitle = title.trim() || "Catatan - " + new Date().toLocaleString("id-ID");
    const { error } = await supabase.from("knowledge_entries").insert({
      user_id: user.id,
      node_id: parent.id,
      title: finalTitle,
      category: "Catatan RAW",
      content: textContent.trim(),
      raw_content: textContent.trim(),
      source_type: "manual",
    });
    setBusy(false);
    if (error) return alert(error.message);
    onAdded();
  }

  return (
    <div className="sheetBackdrop" onMouseDown={onClose}>
      <section className="addSheet explorerAddSheet" onMouseDown={(e) => e.stopPropagation()}>
        <div className="sheetHead">
          <div>
            <p className="eyebrow">TAMBAH</p>
            <h2>{parent ? "Tambahkan ke " + parent.title : "Buat di Beranda"}</h2>
          </div>
          <button className="closeBtn" onClick={onClose}>×</button>
        </div>

        <div className="typeChoices explorerTypeChoices">
          {options.map((option) => (
            <button
              type="button"
              key={option.value}
              className={kind === option.value ? "typeChoice active" : "typeChoice"}
              onClick={() => {
                setKind(option.value as typeof kind);
                setStatus("");
              }}
            >
              <strong>{option.label}</strong>
              <small>{option.hint}</small>
            </button>
          ))}
        </div>

        {kind === "file" && parent && (
          <form className="stack" onSubmit={addFile}>
            <label>
              Pilih file
              <input
                type="file"
                accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.md,.csv,.json,.xml,.mp3,.wav,.m4a,.aac,.ogg,.flac,.opus,.webm,.mp4,.mov,.png,.jpg,.jpeg,.webp"
                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
              />
            </label>
            <p className="muted">File asli disimpan apa adanya. AI membaca RAW/original saat menjawab.</p>
            <button className="primary" disabled={busy || !selectedFile}>
              {busy ? "Menyimpan..." : "Upload ke folder"}
            </button>
          </form>
        )}

        {kind === "link" && parent && (
          <form className="stack" onSubmit={addLink}>
            <label>
              Link
              <input
                type="url"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://..."
                required
              />
            </label>
            <button className="primary" disabled={busy || !linkUrl.trim()}>
              {busy ? "Membaca..." : "Masukkan link"}
            </button>
          </form>
        )}

        {kind === "text" && parent && (
          <form className="stack" onSubmit={addText}>
            <label>
              Judul (opsional)
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Judul catatan" />
            </label>
            <label>
              Teks RAW
              <textarea
                rows={10}
                value={textContent}
                onChange={(e) => setTextContent(e.target.value)}
                placeholder="Paste atau ketik materi apa adanya..."
                required
              />
            </label>
            <button className="primary" disabled={busy || !textContent.trim()}>
              {busy ? "Menyimpan..." : "Masukkan ke folder"}
            </button>
          </form>
        )}

        {kind === "recording" && parent && (
          <div className="explorerRecorderSheet">
            <DatabaseAudioRecorder
              session={session}
              user={user}
              node={parent}
              onChange={onAdded}
            />
          </div>
        )}

        {(kind === "folder" || kind === "study" || kind === "flashcards" || kind === "quiz") && (
          <form className="stack" onSubmit={createNode}>
            <label>
              Nama
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={kind === "folder" ? "Contoh: Pertemuan 1" : "Nama " + options.find((item) => item.value === kind)?.label}
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
        )}

        {status && <div className="notice">{status}</div>}
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
  recordings,
  onChange,
}: {
  session: Session;
  user: User;
  node: StudyNode;
  entries: KnowledgeEntry[];
  files: SourceFile[];
  recordings: Recording[];
  onChange: () => void;
}) {
  const [content, setContent] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);
  const [fileStatus, setFileStatus] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkStatus, setLinkStatus] = useState("");
  const [aiSelection, setAiSelection] = useState<AiSelection>(defaultSelection("local"));
  const aiMode = legacyModeForSelection(aiSelection);

  const localRecordings = recordings.filter((item) => item.node_id === node.id);
  const recordingEntryIds = new Set(localRecordings.map((item) => item.knowledge_entry_id).filter(Boolean));
  const localEntries = entries.filter(
    (item) => item.node_id === node.id && !item.source_file_id && !recordingEntryIds.has(item.id)
  );
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

    if (aiSelection.model === "local") {
      const localMime = inferMime(selectedFile);
      const localSupported =
        localMime.startsWith("text/") ||
        localMime === "application/json" ||
        localMime === "application/xml";

      if (!localSupported) {
        await supabase.from("source_files").update({
          processing_status: "error",
          error_message: "Format ini membutuhkan model Gemini.",
        }).eq("id", row.id);
        setFileBusy(false);
        setFileStatus("Local belum mendukung format ini.");
        onChange();
        return alert("Local saat ini untuk TXT, MD, CSV, JSON, dan XML. Untuk PDF, DOCX, PPTX, gambar, audio, atau video pilih model Gemini.");
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
      setFileStatus("Selesai dengan Local · tanpa API.");
      onChange();
      return;
    }

    const response = await fetch("/api/import-file", {
      method: "POST",
      headers: aiRequestHeaders(session, aiSelection),
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

  async function importLink(e: FormEvent) {
    e.preventDefault();
    if (!linkUrl.trim()) return;

    setLinkBusy(true);
    setLinkStatus("Membaca link...");
    const response = await fetch("/api/import-link", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + session.access_token,
      },
      body: JSON.stringify({ nodeId: node.id, url: linkUrl.trim() }),
    });
    const result = await response.json().catch(() => ({}));
    setLinkBusy(false);

    if (!response.ok) {
      setLinkStatus("");
      return alert(result.error || "Gagal membaca link.");
    }

    setLinkUrl("");
    setLinkStatus("Link sudah masuk Database sebagai sumber RAW.");
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
    if (file.source_kind !== "link") {
      await supabase.storage.from("study-files").remove([file.file_path]);
    }
    const { error } = await supabase.from("source_files").delete().eq("id", file.id);
    if (error) alert(error.message);
    else onChange();
  }

  async function removeDatabaseRecording(item: Recording) {
    if (!confirm("Hapus rekaman audio dan transkripnya dari Database?")) return;
    await supabase.storage.from("recordings").remove([item.file_path]);
    if (item.knowledge_entry_id) {
      await supabase.from("knowledge_entries").delete().eq("id", item.knowledge_entry_id);
    }
    const { error } = await supabase.from("recordings").delete().eq("id", item.id);
    if (error) alert(error.message);
    else onChange();
  }

  return (
    <section className="toolPage">
      <div className="toolHeader">
        <p className="eyebrow">DATABASE</p>
        <h1>{node.title}</h1>
        <p className="muted">Masukkan teks, link, file, foto, audio, video, atau PDF. Sumber RAW/original disimpan dan menjadi sumber utama AI saat Database dipakai.</p>
      </div>

      <div className="toolGrid">
        <article className="panel">
          <h2>Masukkan teks</h2>
          <p className="muted">Langsung copy-paste isi modul, catatan, atau materi di sini. Nama dan konteks mengikuti Database serta jalur materi yang sedang dibuka.</p>
          <form className="stack" onSubmit={saveText}>
            <textarea
              required
              rows={10}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Paste atau ketik teks materi di sini..."
            />
            <button className="primary" disabled={busy || !content.trim()}>
              {busy ? "Menyimpan..." : "Tambahkan teks"}
            </button>
          </form>

          <div className="databaseRecorderDivider" />
          <DatabaseAudioRecorder
            session={session}
            user={user}
            node={node}
            onChange={onChange}
          />
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
              value={aiSelection}
              onChange={setAiSelection}
              action={selectedFile && isHeavyFile(selectedFile) ? "file_heavy" : "file_light"}
            />
            <button className="primary" disabled={!selectedFile || fileBusy}>
              {fileBusy ? "Memproses..." : "Upload & olah"}
            </button>
          </form>
          {fileStatus && <div className="notice">{fileStatus}</div>}

          <div className="databaseRecorderDivider" />
          <h2>Masukkan link</h2>
          <p className="muted">Halaman web dibaca sebagai sumber RAW dan disimpan ke Database.</p>
          <form className="stack" onSubmit={importLink}>
            <input
              type="url"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="https://..."
              required
            />
            <button className="primary" disabled={linkBusy || !linkUrl.trim()}>
              {linkBusy ? "Membaca..." : "Tambahkan link"}
            </button>
          </form>
          {linkStatus && <div className="notice">{linkStatus}</div>}
        </article>
      </div>

      <section className="databaseList">
        <h2>Isi Database</h2>
        {!localEntries.length && !localFiles.length && !localRecordings.length && <p className="muted">Belum ada isi.</p>}

        {localEntries.map((entry) => (
          <article className="dataCard" key={entry.id}>
            <div className="dataHead">
              <div>
                <small>{entry.category || entry.source_type}</small>
                <h3>{entry.title}</h3>
              </div>
              <button className="dangerSmall" onClick={() => removeEntry(entry.id)}>Hapus</button>
            </div>
            <div className="dataText raw"><RichText text={entry.raw_content || entry.content} /></div>
            {entry.raw_content && entry.content && entry.raw_content !== entry.content && (
              <details>
                <summary>Versi tertata</summary>
                <div className="dataText"><RichText text={entry.content} /></div>
              </details>
            )}
          </article>
        ))}

        {localFiles.map((file) => (
          <DatabaseFileCard
            key={file.id}
            file={file}
            onDelete={() => removeFile(file)}
          />
        ))}

        {localRecordings.map((item) => (
          <DatabaseStoredRecording
            key={item.id}
            item={item}
            onDelete={() => removeDatabaseRecording(item)}
          />
        ))}
      </section>
    </section>
  );
}


async function downloadStorageObject(bucket: string, path: string, fileName: string) {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error || !data) {
    alert(error?.message || "File tidak dapat didownload.");
    return;
  }

  const url = URL.createObjectURL(data);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function DatabaseFileCard({
  file,
  onDelete,
  draggable = false,
  onDragStart,
}: {
  file: SourceFile;
  onDelete: () => void;
  draggable?: boolean;
  onDragStart?: (event: any) => void;
}) {
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewBusy, setPreviewBusy] = useState(false);
  const isLink = file.source_kind === "link" || Boolean(file.source_url);
  const isImage = file.mime_type.startsWith("image/");
  const isAudio = file.mime_type.startsWith("audio/");
  const isVideo = file.mime_type.startsWith("video/");
  const isPdf = file.mime_type === "application/pdf";
  const canInlinePreview = isImage || isAudio || isVideo || isPdf;

  async function preview() {
    if (isLink) {
      const url = file.source_url || file.file_path;
      if (url) window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    setPreviewBusy(true);
    const { data, error } = await supabase.storage
      .from("study-files")
      .createSignedUrl(file.file_path, 60 * 60);
    setPreviewBusy(false);

    if (error || !data?.signedUrl) {
      alert(error?.message || "File belum dapat dibuka.");
      return;
    }

    if (canInlinePreview) {
      setPreviewUrl((current) => current ? "" : data.signedUrl);
    } else {
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <article className="dataCard mediaDataCard" draggable={draggable} onDragStart={onDragStart}>
      <div className="dataHead">
        <div>
          <small>
            {isLink
              ? "Link RAW"
              : file.processing_status === "processing"
                ? "Sedang diproses..."
                : file.processing_status === "ready"
                  ? "Ready"
                  : "Gagal diproses"}
            {!isLink && " · " + formatBytes(file.size_bytes)}
          </small>
          <h3>{file.file_name}</h3>
        </div>
        <div className="mediaCardActions">
          <button className="ghost" type="button" disabled={previewBusy} onClick={preview}>
            {isLink
              ? "Buka sumber"
              : previewBusy
                ? "Membuka..."
                : previewUrl
                  ? "Tutup"
                  : canInlinePreview
                    ? "Lihat / Putar"
                    : "Buka"}
          </button>
          {!isLink && (
            <button
              className="ghost"
              type="button"
              onClick={() => downloadStorageObject("study-files", file.file_path, file.file_name)}
            >
              Download
            </button>
          )}
          <button className="dangerSmall" type="button" onClick={onDelete}>Hapus</button>
        </div>
      </div>

      {previewUrl && isImage && (
        <div className="databaseMediaPreview">
          <img src={previewUrl} alt={file.file_name} />
        </div>
      )}
      {previewUrl && isAudio && (
        <div className="databaseMediaPreview">
          <audio controls preload="metadata" src={previewUrl} />
        </div>
      )}
      {previewUrl && isVideo && (
        <div className="databaseMediaPreview">
          <video controls preload="metadata" src={previewUrl} />
        </div>
      )}
      {previewUrl && isPdf && (
        <div className="databaseMediaPreview pdfPreview">
          <iframe title={file.file_name} src={previewUrl} />
        </div>
      )}

      {file.raw_text && (
        <details open>
          <summary>RAW / original source</summary>
          <div className="dataText raw"><RichText text={file.raw_text} /></div>
        </details>
      )}
      {file.structured_text && file.structured_text !== file.raw_text && (
        <details>
          <summary>Versi tertata</summary>
          <div className="dataText"><RichText text={file.structured_text} /></div>
        </details>
      )}
      {!!file.corrections?.length && <CorrectionList corrections={file.corrections} />}
    </article>
  );
}

function DatabaseStoredRecording({
  item,
  onDelete,
  draggable = false,
  onDragStart,
}: {
  item: Recording;
  onDelete: () => void;
  draggable?: boolean;
  onDragStart?: (event: any) => void;
}) {
  const [audioUrl, setAudioUrl] = useState("");
  const [busy, setBusy] = useState(false);

  async function toggleAudio() {
    if (audioUrl) {
      setAudioUrl("");
      return;
    }

    setBusy(true);
    const { data, error } = await supabase.storage
      .from("recordings")
      .createSignedUrl(item.file_path, 60 * 60);
    setBusy(false);

    if (error || !data?.signedUrl) {
      alert(error?.message || "Rekaman belum dapat dibuka.");
      return;
    }
    setAudioUrl(data.signedUrl);
  }

  const ext = (item.mime_type || "audio/webm").split("/")[1]?.split(";")[0] || "webm";
  const fileName = item.title.replace(/[^a-zA-Z0-9._-]+/g, "_") + "." + ext;

  return (
    <article className="dataCard mediaDataCard recordingInDatabase" draggable={draggable} onDragStart={onDragStart}>
      <div className="dataHead">
        <div>
          <small>Rekaman audio · {formatTime(item.duration_seconds || 0)}</small>
          <h3>{item.title}</h3>
        </div>
        <div className="mediaCardActions">
          <button className="ghost" type="button" disabled={busy} onClick={toggleAudio}>
            {busy ? "Membuka..." : audioUrl ? "Tutup audio" : "Dengarkan"}
          </button>
          <button
            className="ghost"
            type="button"
            onClick={() => downloadStorageObject("recordings", item.file_path, fileName)}
          >
            Download
          </button>
          <button className="dangerSmall" type="button" onClick={onDelete}>Hapus</button>
        </div>
      </div>

      {audioUrl && (
        <div className="databaseMediaPreview">
          <audio controls autoPlay preload="metadata" src={audioUrl} />
        </div>
      )}

      {(item.raw_transcript || item.transcript || item.structured_transcript) && (
        <details open className="transcriptPanel">
          <summary>Transkrip mentah / verbatim</summary>
          <div className="dataText raw">
            <RichText text={item.raw_transcript || item.transcript || item.structured_transcript || ""} />
          </div>
        </details>
      )}
    </article>
  );
}

function DatabaseAudioRecorder({
  session,
  user,
  node,
  onChange,
}: {
  session: Session;
  user: User;
  node: StudyNode;
  onChange: () => void;
}) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const speechRef = useRef<any>(null);
  const transcriptRef = useRef("");
  const liveDraftRef = useRef("");
  const liveTimerRef = useRef<number | null>(null);
  const startedRef = useRef(0);

  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [liveText, setLiveText] = useState("");
  const [status, setStatus] = useState("Rekam audio langsung ke Database.");

  useEffect(() => {
    return () => {
      try { speechRef.current?.stop(); } catch {}
      try {
        if (recorderRef.current?.state && recorderRef.current.state !== "inactive") {
          recorderRef.current.stop();
        }
      } catch {}
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (liveTimerRef.current) window.clearInterval(liveTimerRef.current);
    };
  }, []);

  function startSpeechRecognition() {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return false;

    const recognition = new SpeechRecognition();
    recognition.lang = "id-ID";
    recognition.continuous = true;
    recognition.interimResults = true;
    transcriptRef.current = "";

    recognition.onresult = (event: any) => {
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const text = String(event.results[index][0]?.transcript || "").trim();
        if (!text) continue;
        if (event.results[index].isFinal) {
          transcriptRef.current = (transcriptRef.current + " " + text).trim();
        } else {
          interim = (interim + " " + text).trim();
        }
      }
      liveDraftRef.current = (transcriptRef.current + " " + interim).trim();
    };

    recognition.onerror = () => {};
    recognition.onend = () => {
      if (speechRef.current === recognition && recorderRef.current?.state === "recording") {
        try { recognition.start(); } catch {}
      }
    };
    speechRef.current = recognition;
    try {
      recognition.start();
      if (liveTimerRef.current) window.clearInterval(liveTimerRef.current);
      liveTimerRef.current = window.setInterval(() => {
        const draft = liveDraftRef.current.trim();
        if (draft) setLiveText(draft);
      }, 20000);
      return true;
    } catch {
      speechRef.current = null;
      return false;
    }
  }

  async function start() {
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw new Error("Browser ini belum mendukung perekaman audio.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 48000,
        },
      });
      streamRef.current = stream;

      const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
      const mimeType = candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 128000 })
        : new MediaRecorder(stream, { audioBitsPerSecond: 128000 });

      chunksRef.current = [];
      transcriptRef.current = "";
      liveDraftRef.current = "";
      setLiveText("");
      recorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        await saveRecording(blob);
      };

      startedRef.current = Date.now();
      recorder.start(700);
      startSpeechRecognition();
      setRecording(true);
      setStatus("Sedang merekam · transkrip mentah diperbarui tiap ±20 detik.");
    } catch (error: any) {
      const message =
        error?.name === "NotAllowedError"
          ? "Izin mikrofon ditolak. Izinkan mikrofon untuk situs ini."
          : error?.message || "Gagal memulai rekaman.";
      setStatus(message);
    }
  }

  function stop() {
    if (!recording) return;
    setRecording(false);
    const finalDraft = liveDraftRef.current.trim();
    if (finalDraft) setLiveText(finalDraft);
    if (liveTimerRef.current) {
      window.clearInterval(liveTimerRef.current);
      liveTimerRef.current = null;
    }
    setStatus("Menyimpan rekaman mentah...");
    try { speechRef.current?.stop(); } catch {}
    speechRef.current = null;
    try {
      if (recorderRef.current?.state && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
    } catch {}
  }

  async function saveRecording(blob: Blob) {
    if (!blob.size) {
      setStatus("Rekaman kosong.");
      return;
    }

    setBusy(true);
    const mimeType = normalizeAudioMime(blob.type || "audio/webm");
    const subtype = mimeType.split("/")[1]?.split(";")[0] || "webm";
    const ext = subtype === "mp4" || subtype === "m4a" ? "m4a" : subtype;
    const path = user.id + "/database/" + node.id + "/" + crypto.randomUUID() + "." + ext;
    const title = "Rekaman - " + new Date().toLocaleString("id-ID");
    const duration = Math.max(1, Math.round((Date.now() - startedRef.current) / 1000));

    const upload = await supabase.storage.from("recordings").upload(path, blob, { contentType: mimeType });
    if (upload.error) {
      setBusy(false);
      setStatus("Gagal upload rekaman.");
      return alert(upload.error.message);
    }

    const { data: row, error: rowError } = await supabase
      .from("recordings")
      .insert({
        user_id: user.id,
        node_id: node.id,
        title,
        file_path: path,
        mime_type: mimeType,
        duration_seconds: duration,
      })
      .select("*")
      .single();

    if (rowError) {
      await supabase.storage.from("recordings").remove([path]);
      setBusy(false);
      setStatus("Gagal menyimpan rekaman.");
      return alert(rowError.message);
    }

    const browserDraft = liveDraftRef.current.trim() || transcriptRef.current.trim() || liveText.trim();
    let raw = browserDraft;

    setStatus("Mendengarkan audio asli secara verbatim · tanpa koreksi Database...");
    const transcriptionSelection = defaultSelection("gemini-2.5-flash", "transcription");
    const response = await fetch("/api/transcribe", {
      method: "POST",
      headers: aiRequestHeaders(session, transcriptionSelection),
      body: JSON.stringify({
        recordingId: row.id,
        filePath: path,
        mimeType,
        purpose: "recording",
        contextNodeId: node.id,
        browserTranscript: browserDraft,
        aiMode: legacyModeForSelection(transcriptionSelection),
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok) {
      raw = String(data.rawTranscript || browserDraft).trim();
    }

    let knowledgeEntryId: string | null = null;
    if (raw) {
      const { data: entry, error: entryError } = await supabase
        .from("knowledge_entries")
        .insert({
          user_id: user.id,
          node_id: node.id,
          title,
          category: "Rekaman audio",
          content: raw,
          raw_content: raw,
          source_type: "transcript",
        })
        .select("id")
        .single();

      if (!entryError && entry?.id) knowledgeEntryId = entry.id;

      await supabase
        .from("recordings")
        .update({
          transcript: raw,
          raw_transcript: raw,
          structured_transcript: raw,
          corrections: [],
          knowledge_entry_id: knowledgeEntryId,
        })
        .eq("id", row.id);
    }

    setBusy(false);
    setLiveText("");
    transcriptRef.current = "";
    setStatus(
      raw
        ? "Rekaman + transkrip mentah sudah masuk Database. Belum dirapikan atau dikoreksi."
        : "Audio sudah masuk Database. Transkrip belum tersedia; audio tetap bisa didengar ulang."
    );
    onChange();
  }

  return (
    <div className="databaseAudioRecorder">
      <div className="databaseRecorderHead">
        <div>
          <strong>Rekam audio</strong>
          <small>{status}</small>
        </div>
        <span className={recording ? "recDot live" : "recDot"} />
      </div>

      {liveText && (
        <div className="databaseLiveTranscript">
          <small>Transkrip live · update tiap ±20 detik · verbatim</small>
          <div className="dataText raw">{liveText}</div>
        </div>
      )}

      <div className="recordActions compactRecordActions">
        <button className="ghost" type="button" disabled={recording || busy} onClick={start}>
          {busy ? "Menyimpan..." : "🎙️ Rekam audio"}
        </button>
        <button className="stopBtn" type="button" disabled={!recording} onClick={stop}>⏹️ Stop</button>
      </div>
    </div>
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
  const [aiSelection, setAiSelection] = useState<AiSelection>(defaultSelection("gemini-2.5-flash"));
  const aiMode = legacyModeForSelection(aiSelection);
  const [recallAnswers, setRecallAnswers] = useState<Record<string, string>>({});
  const [recallFeedback, setRecallFeedback] = useState<Record<string, "correct" | "wrong">>({});
  const [quickDbOpen, setQuickDbOpen] = useState(false);
  const [quickDbName, setQuickDbName] = useState("");
  const [quickDbContent, setQuickDbContent] = useState("");
  const [quickDbCreatedId, setQuickDbCreatedId] = useState<string | null>(null);
  const [quickDbFile, setQuickDbFile] = useState<File | null>(null);
  const [quickDbAiSelection, setQuickDbAiSelection] = useState<AiSelection>(defaultSelection("local"));
  const quickDbAiMode = legacyModeForSelection(quickDbAiSelection);
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
    const legacySelection = selectionFromLegacyMode(nextPath.ai_mode || "instant");
    const storedModel = nextPath.ai_model as AiModelId | null | undefined;
    const storedEffort = nextPath.ai_effort as AiEffort | null | undefined;
    setAiSelection(
      storedModel && storedModel !== "local"
        ? {
            model: storedModel,
            effort: storedEffort || modelCapability(storedModel).defaultEffort,
          }
        : legacySelection
    );

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
    if (aiSelection.model === "local") return alert("Study terarah membutuhkan model Gemini.");

    setBuilding(true);
    const response = await fetch("/api/build-study", {
      method: "POST",
      headers: aiRequestHeaders(session, aiSelection),
      body: JSON.stringify({
        studyNodeId: node.id,
        sourceNodeIds: selectedSources,
        studyInstruction: studyInstruction.trim(),
        aiMode,
        aiModel: aiSelection.model,
        aiEffort: aiSelection.effort,
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

    if (quickDbAiSelection.model === "local") {
      const localSupported =
        mimeType.startsWith("text/") ||
        mimeType === "application/json" ||
        mimeType === "application/xml";

      if (!localSupported) {
        await supabase.from("source_files").update({
          processing_status: "error",
          error_message: "Format ini membutuhkan model Gemini.",
        }).eq("id", row.id);

        setQuickFileBusy(false);
        setQuickDbStatus("Local belum mendukung format ini.");
        onChange();
        return alert("Local saat ini untuk TXT, MD, CSV, JSON, dan XML. Untuk PDF, DOCX, PPTX, gambar, audio, atau video pilih model Gemini.");
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
      setQuickDbStatus("Selesai dengan Local · tanpa API. Database otomatis dipilih sebagai sumber Study.");
      onChange();
      return;
    }

    const response = await fetch("/api/import-file", {
      method: "POST",
      headers: aiRequestHeaders(session, quickDbAiSelection),
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
    setQuickDbAiSelection(defaultSelection("local"));
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
          Pilih Database yang ingin dipelajari. Model Gemini yang dipilih menyusun urutan belajar,
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
              Jika diisi, model Gemini yang aktif akan memakai instruksi ini saat memilih urutan bab/subbab dan merangkum materi.
            </small>
          </label>

          <div className="studySetupTools">
            <button className="ghost" onClick={() => setQuickDbOpen((current) => !current)}>
              + Tambah Database dari sini
            </button>
            <AiModePicker value={aiSelection} onChange={setAiSelection} action="study" allowLocal={false} />
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
                      value={quickDbAiSelection}
                      onChange={setQuickDbAiSelection}
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
            <p>Gemini sedang menentukan urutan bab/subbab dan membuat recall quiz.</p>
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
  const liveProviderRef = useRef<"shared-api-key" | "user-api-key" | "user-google-oauth">("shared-api-key");

  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const audioGainRef = useRef<GainNode | null>(null);
  const browserFallbackStartedRef = useRef(false);

  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [retryingId, setRetryingId] = useState("");
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
  const [aiSelection, setAiSelection] = useState<AiSelection>(defaultSelection("local", "transcription"));
  const aiMode = legacyModeForSelection(aiSelection);

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
    liveProviderRef.current = "shared-api-key";
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
    if (asFallback && liveTextRef.current && !speechFinalRef.current) {
      speechFinalRef.current = liveTextRef.current;
    }
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
    if (context.state === "suspended") {
      void context.resume().catch(() => {});
    }
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
      model_name: liveProviderRef.current + "|gemini-3.5-transcribe-live",
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
      headers: aiRequestHeaders(session, aiSelection),
      body: JSON.stringify({ aiMode }),
    });
    const data = await response.json();
    if (!response.ok || !data.token) {
      throw new Error(data.error || "Live Transcribe tidak tersedia.");
    }
    if (
      data.provider === "user-google-oauth" ||
      data.provider === "user-api-key" ||
      data.provider === "shared-api-key"
    ) {
      liveProviderRef.current = data.provider;
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
          stopBrowserSpeech();
          setLiveEngine("Gemini 3.5 Transcribe Live");
          setStatus("Sedang merekam · Gemini Live aktif.");
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
      setLiveEngine("Live browser");
      stopAudioPump();
      startBrowserSpeech(true);
    };

    ws.onclose = () => {
      liveReadyRef.current = false;
      stopAudioPump();
      if (recordingRef.current && !liveStoppingRef.current) {
        setLiveEngine("Live browser");
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
        await new Promise((resolve) => window.setTimeout(resolve, aiSelection.model === "local" ? 250 : 1100));
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

      if (aiSelection.model === "local") {
        const started = startBrowserSpeech(false);
        if (!started) {
          setStatus("Sedang merekam · audio tersimpan. Transkrip live browser tidak tersedia.");
        }
      } else {
        const browserStarted = startBrowserSpeech(true);
        setStatus(
          browserStarted
            ? "Sedang merekam · transkrip live aktif."
            : "Sedang merekam · audio tersimpan. Menyiapkan Gemini Live..."
        );
        void startGeminiLiveSpeech(stream).catch((error: any) => {
          console.warn("[GEMINI_LIVE_START_FAILED]", error?.message || "unknown");
          if (!recordingRef.current) return;
          const started = browserFallbackStartedRef.current || startBrowserSpeech(true);
          setLiveEngine(started ? "Live browser" : "Final transcript setelah Stop");
          setStatus(
            started
              ? "Sedang merekam · transkrip live aktif."
              : "Sedang merekam · audio tersimpan. Final transcript diproses setelah Stop."
          );
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
      aiSelection.model === "local"
        ? "Rekaman berhenti. Menyimpan transkrip browser..."
        : "Rekaman berhenti. Menyiapkan verbatim final & versi tertata..."
    );
    stopBrowserSpeech();
    stopGeminiLive(aiSelection.model !== "local");

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

    if (aiSelection.model === "local") {
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
      setStatus("Selesai · Local · Browser · tanpa Gemini API.");
      onChange();
      return;
    }

    const response = await fetch("/api/transcribe", {
      method: "POST",
      headers: aiRequestHeaders(session, aiSelection),
      body: JSON.stringify({
        recordingId: row.id,
        filePath: path,
        mimeType,
        contextNodeId: node.parent_id,
        browserTranscript: currentLiveTranscript,
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
        (data.structuringModel ? " · dirapikan " + data.structuringModel : "") +
        (data.warning ? " · " + String(data.warning) : "")
    );
    onChange();
  }

  async function retryTranscription(item: Recording) {
    if (aiSelection.model === "local") {
      return alert("Transkrip ulang audio tersimpan membutuhkan model Gemini.");
    }

    setRetryingId(item.id);
    setStatus("Mencoba transkrip ulang " + item.title + "...");

    const response = await fetch("/api/transcribe", {
      method: "POST",
      headers: aiRequestHeaders(session, aiSelection),
      body: JSON.stringify({
        recordingId: item.id,
        filePath: item.file_path,
        mimeType: item.mime_type || "audio/webm",
        contextNodeId: node.parent_id,
        browserTranscript: item.raw_transcript || item.transcript || "",
        aiMode,
      }),
    });
    const data = await response.json();
    setRetryingId("");

    if (!response.ok) {
      setStatus("Transkrip ulang belum berhasil. Audio tetap tersimpan.");
      return alert(data.error || "Transkripsi ulang gagal.");
    }

    setResult({
      recordingId: item.id,
      raw: data.rawTranscript || "",
      structured: data.structuredTranscript || data.rawTranscript || "",
      summary: data.summary || "",
      corrections: data.corrections || [],
      added: Boolean(item.knowledge_entry_id),
    });
    setStatus(
      "Transkrip ulang selesai · " +
        String(data.transcriptionModel || "Gemini") +
        (data.structuringModel ? " · dirapikan " + data.structuringModel : "") +
        (data.warning ? " · " + String(data.warning) : "")
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
        content: item.structured_transcript || item.raw_transcript,
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
          Raw Transcript selalu dipertahankan sebagai versi ucapan apa adanya. Versi tertata hanya merapikan tanda baca/paragraf dan koreksi istilah yang benar-benar didukung Database; Database tidak boleh mengganti isi rekaman.
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
            <strong>{aiSelection.model === "local" ? "Local · Browser · tanpa API" : liveEngine}</strong>
          </div>
          <div className={recording ? "recordModeLocked" : ""}>
            <AiModePicker
              value={aiSelection}
              onChange={setAiSelection}
              action="transcription"
              context="transcription"
            />
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

            <details open className="transcriptPanel">
              <summary>Versi tertata</summary>
              <div className="dataText"><RichText text={result.structured || result.raw} /></div>
            </details>

            <details open className="transcriptPanel">
              <summary>Raw Transcript / Verbatim</summary>
              <div className="dataText raw"><RichText text={result.raw || result.structured} /></div>
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
              onRetry={retryTranscription}
              retrying={retryingId === item.id}
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
  onRetry,
  retrying,
  onDelete,
}: {
  item: Recording;
  databases: StudyNode[];
  onAdd: (item: Recording, databaseId: string) => void;
  onRetry: (item: Recording) => void;
  retrying: boolean;
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
        <div className="recordHistoryActions">
          {!item.structured_transcript && (
            <button className="ghost" disabled={retrying} onClick={() => onRetry(item)}>
              {retrying ? "Mencoba..." : "Transkrip ulang"}
            </button>
          )}
          <button className="dangerSmall" onClick={() => onDelete(item)}>Hapus</button>
        </div>
      </div>

      {(item.structured_transcript || item.raw_transcript) && (
        <details open className="transcriptPanel">
          <summary>Versi tertata</summary>
          <div className="dataText">
            <RichText text={item.structured_transcript || item.raw_transcript || ""} />
          </div>
        </details>
      )}
      {(item.raw_transcript || item.structured_transcript) && (
        <details open className="transcriptPanel">
          <summary>Raw Transcript / Verbatim</summary>
          <div className="dataText raw">
            <RichText text={item.raw_transcript || item.structured_transcript || ""} />
          </div>
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
  const [aiSelection, setAiSelection] = useState<AiSelection>(defaultSelection("local"));
  const aiMode = legacyModeForSelection(aiSelection);
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

    if (aiSelection.model === "local") {
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
      headers: aiRequestHeaders(session, aiSelection),
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
        ? "Dinilai model Gemini aktif hanya berdasarkan Database."
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
      if (aiSelection.model === "local") {
        return alert("Soal yang dinilai AI membutuhkan model Gemini.");
      }

      setGrading(true);
      const response = await fetch("/api/grade-quiz", {
        method: "POST",
        headers: aiRequestHeaders(session, aiSelection),
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
            <AiModePicker value={aiSelection} onChange={setAiSelection} action="study" />
            <button className="primary inlinePrimary" onClick={generate} disabled={busy}>
              {busy ? "Membuat..." : "Buat Flashcard"}
            </button>
          </>
        ) : (
          <div className="quizCreateActions">
            <div>
              <small className="createLabel">AI / MODE PENILAIAN</small>
              <AiModePicker value={aiSelection} onChange={setAiSelection} action="study" />
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
                  : "Model Gemini aktif akan menentukan pilihan yang benar berdasarkan Database saat kuis dinilai."}
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
              <strong>Model Gemini aktif akan menentukan benar/salah.</strong>
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
                    {grading ? "Gemini sedang menilai..." : "Selesai & lihat nilai"}
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
  allowLocal = true,
  context = "general",
}: {
  value: AiSelection;
  onChange: (selection: AiSelection) => void;
  action: "ask" | "ask_web" | "study" | "transcription" | "file_light" | "file_heavy";
  compact?: boolean;
  allowLocal?: boolean;
  context?: "general" | "transcription" | "chat";
}) {
  const [open, setOpen] = useState(false);
  const [pluginRevision, setPluginRevision] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const refresh = () => setPluginRevision((value) => value + 1);
    window.addEventListener("rb-plugin-change", refresh);
    return () => window.removeEventListener("rb-plugin-change", refresh);
  }, []);

  useEffect(() => {
    if (getSessionGoogleGeminiAuth().accessToken || getSessionGeminiKey()) return;
    if (getStoredModelIds("rb-shared-gemini-models").length) return;

    let active = true;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) return;
      const response = await fetch("/api/gemini-models", {
        headers: { Authorization: "Bearer " + accessToken },
      });
      const payload = await response.json().catch(() => ({}));
      if (!active || !response.ok) return;
      const ids = Array.isArray(payload.models) ? payload.models.map((item: any) => String(item?.id || "")) : [];
      setStoredModelIds("rb-shared-gemini-models", ids);
      setPluginRevision((value) => value + 1);
    })();

    return () => {
      active = false;
    };
  }, []);

  const chatAction = action === "ask" || action === "ask_web";
  const openAIConnected = pluginRevision >= 0 && Boolean(getSessionOpenAIKey());
  const anthropicConnected = pluginRevision >= 0 && Boolean(getSessionAnthropicKey());
  const geminiIds = activeGeminiModelIds();
  const openAIIds = getStoredModelIds("rb-openai-models");
  const anthropicIds = getStoredModelIds("rb-anthropic-models");
  const localAiConfig = getSessionLocalAiConfig();
  const localModels = chatAction && localAiConfig.endpoint
    ? localAiConfig.models.map((model) => ({
        id: localAiModelId(model),
        provider: "local-openai" as const,
        label: model,
        subtitle:
          localAiConfig.kind === "lmstudio"
            ? "LM Studio · perangkat user"
            : localAiConfig.kind === "ollama"
              ? "Ollama · perangkat user"
              : "OpenAI-compatible · perangkat/user endpoint",
        contexts: ["chat" as const],
        efforts: [],
        defaultEffort: "none" as const,
        freeTier: true,
        freeWeb: false,
      }))
    : [];

  const knownIds = new Set(AI_MODEL_CATALOG.map((item) => item.id));
  const dynamicGeminiModels = chatAction
    ? geminiIds
        .filter((id) => !knownIds.has(id as AiModelId))
        .filter((id) => /^gemini-/i.test(id) && !/embedding|image|tts|live|transcribe/i.test(id))
        .map((id) => ({
          id: id as AiModelId,
          provider: "gemini" as const,
          label: id.replace(/^gemini-/, "Gemini ").replaceAll("-", " "),
          subtitle: "Gemini · tersedia pada provider aktif",
          contexts: ["chat" as const],
          efforts: [],
          defaultEffort: "none" as const,
          freeTier: true,
          freeWeb: false,
        }))
    : [];

  const dynamicOpenAIModels = chatAction && openAIConnected
    ? openAIIds
        .filter((id) => !AI_MODEL_CATALOG.some((item) => providerModelId(item.id) === id))
        .filter((id) => /^(gpt-|o\d|chatgpt-)/i.test(id) && !/audio|realtime|transcribe|image|embedding|tts|search-preview/i.test(id))
        .map((id) => ({
          id: ("openai:" + id) as AiModelId,
          provider: "openai" as const,
          label: id,
          subtitle: "OpenAI · tersedia di account/API user",
          contexts: ["chat" as const],
          efforts: [],
          defaultEffort: "none" as const,
          freeTier: false,
          freeWeb: false,
        }))
    : [];

  const dynamicAnthropicModels = chatAction && anthropicConnected
    ? anthropicIds
        .filter((id) => !AI_MODEL_CATALOG.some((item) => providerModelId(item.id) === id))
        .filter((id) => /^claude-/i.test(id))
        .map((id) => ({
          id: ("anthropic:" + id) as AiModelId,
          provider: "anthropic" as const,
          label: id,
          subtitle: "Claude · tersedia di account/API user",
          contexts: ["chat" as const],
          efforts: [],
          defaultEffort: "none" as const,
          freeTier: false,
          freeWeb: false,
        }))
    : [];

  const visibleModels = [
    ...AI_MODEL_CATALOG,
    ...dynamicGeminiModels,
    ...dynamicOpenAIModels,
    ...dynamicAnthropicModels,
    ...localModels,
  ].filter((item) => {
    if (!item.contexts.includes(context) || (!allowLocal && item.id === "local")) return false;
    if (item.provider === "gemini") {
      return !geminiIds.length || geminiIds.includes(providerModelId(item.id));
    }
    if (item.provider === "openai") {
      return chatAction && openAIConnected && (!openAIIds.length || openAIIds.includes(providerModelId(item.id)));
    }
    if (item.provider === "anthropic") {
      return chatAction && anthropicConnected && (!anthropicIds.length || anthropicIds.includes(providerModelId(item.id)));
    }
    return true;
  });
  const selected =
    visibleModels.find((item) => item.id === value.model) ||
    visibleModels.find((item) => item.id !== "local") ||
    visibleModels[0];
  const selectedEffort = selected?.efforts.find((item) => item.value === value.effort);

  function modelRouteLabel(item: (typeof visibleModels)[number]) {
    if (item.provider === "gemini") {
      return getSessionGoogleGeminiAuth().accessToken || getSessionGeminiKey()
        ? "Quota project/user"
        : "Shared";
    }
    if (item.provider === "openai" || item.provider === "anthropic") return "Quota user";
    if (item.provider === "local-openai") return "Perangkat user";
    return "";
  }

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

  function chooseModel(model: AiModelId) {
    const next = defaultSelection(model, context);
    onChange(next);
    if (!modelCapability(model).efforts.length) setOpen(false);
  }

  function chooseEffort(effort: AiEffort) {
    onChange({ model: selected.id, effort });
    setOpen(false);
  }

  return (
    <div ref={wrapRef} className={compact ? "aiModeSelect compact" : "aiModeSelect"}>
      <button
        type="button"
        className="aiModeTrigger chooseModelTrigger"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <span>
          <strong>Choose Model</strong>
          <small>
            {selected?.label || "Local"}
            {selected?.id !== "local" && selectedEffort ? " · " + selectedEffort.label : ""}
          </small>
        </span>
        <b>⌄</b>
      </button>

      {open && (
        <div className="aiModePopover aiModelPopover">
          <div className="modelPickerHead">
            <div>
              <span className="aiModeSectionLabel">CHOOSE MODEL</span>
              <strong>{selected?.label || "Local"}</strong>
            </div>
            <div className="modelPickerActions">
              <button
                type="button"
                className="modelPluginButton"
                onClick={() => {
                  setOpen(false);
                  window.dispatchEvent(new Event("rb-open-plugins"));
                }}
              >
                + Plugin
              </button>
              <button type="button" className="modelPickerClose" onClick={() => setOpen(false)}>×</button>
            </div>
          </div>

          <div className="modelCardGrid">
            {visibleModels.map((item) => (
              <button
                type="button"
                key={item.id}
                className={value.model === item.id ? "modelCard active" : "modelCard"}
                onClick={() => chooseModel(item.id)}
              >
                <span className="modelCardTop">
                  <strong>{item.label}</strong>
                  {value.model === item.id && <b>✓</b>}
                </span>
                <small>
                  {item.subtitle}
                  {modelRouteLabel(item) ? " · " + modelRouteLabel(item) : ""}
                </small>
              </button>
            ))}
          </div>

          {!!selected?.efforts.length && (
            <div className="modelEffortPanel">
              <div>
                <span className="aiModeSectionLabel">REASONING · {selected.label}</span>
                <small>Pilih tingkat penalaran untuk model ini.</small>
              </div>
              <div className="aiEffortGrid">
                {selected.efforts.map((effort) => (
                  <button
                    type="button"
                    key={effort.value}
                    className={value.effort === effort.value ? "aiEffortOption active" : "aiEffortOption"}
                    onClick={() => chooseEffort(effort.value)}
                  >
                    <strong>{effort.label}</strong>
                    <small>{effort.hint}</small>
                  </button>
                ))}
              </div>
            </div>
          )}
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
  onChange,
}: {
  session: Session;
  scopeNodeId: string | null;
  scopeName: string;
  entries: KnowledgeEntry[];
  nodes: StudyNode[];
  onChange: () => void;
}) {
  type SourceKind = "ai" | "database" | "web";

  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [answerModel, setAnswerModel] = useState("");
  const [sources, setSources] = useState<Array<{ id: string; title: string; category: string }>>([]);
  const [webSources, setWebSources] = useState<Array<{ title: string; uri: string }>>([]);
  const [warning, setWarning] = useState("");
  const [selectedSources, setSelectedSources] = useState<SourceKind[]>(["database"]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [aiSelection, setAiSelection] = useState<AiSelection>(defaultSelection("local", "chat"));
  const aiMode = legacyModeForSelection(aiSelection);
  const [composerBottom, setComposerBottom] = useState(16);
  const [composerHeight, setComposerHeight] = useState(118);
  const dragRef = useRef<{ y: number; bottom: number } | null>(null);
  const composerRef = useRef<HTMLFormElement | null>(null);
  const askVoiceRecorderRef = useRef<MediaRecorder | null>(null);
  const askVoiceChunksRef = useRef<Blob[]>([]);
  const askVoiceStreamRef = useRef<MediaStream | null>(null);
  const askVoiceSpeechRef = useRef<any>(null);
  const askVoiceTranscriptRef = useRef("");
  const askVoiceLiveDraftRef = useRef("");
  const askVoiceTimerRef = useRef<number | null>(null);
  const askVoiceStartedRef = useRef(0);
  const [askVoiceRecording, setAskVoiceRecording] = useState(false);
  const [askVoiceBusy, setAskVoiceBusy] = useState(false);
  const [askVoiceStatus, setAskVoiceStatus] = useState("");
  const [askVoiceDbId, setAskVoiceDbId] = useState("");
  const [pendingVoice, setPendingVoice] = useState<{
    id: string;
    path: string;
    title: string;
    mimeType: string;
    duration: number;
    transcript: string;
  } | null>(null);
  const askAttachmentInputRef = useRef<HTMLInputElement | null>(null);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [attachmentStatus, setAttachmentStatus] = useState("");
  const [attachmentDbId, setAttachmentDbId] = useState("");
  const [pendingAttachment, setPendingAttachment] = useState<{
    file: File;
    fileName: string;
    mimeType: string;
    rawText: string;
    filePath: string;
  } | null>(null);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [linkInputOpen, setLinkInputOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkStatus, setLinkStatus] = useState("");
  const [pendingLink, setPendingLink] = useState<{
    url: string;
    title: string;
    mimeType: string;
    rawText: string;
  } | null>(null);
  const [pendingTextSave, setPendingTextSave] = useState<string | null>(null);

  const askVoiceDatabases = useMemo(() => {
    const all = nodes.filter((item) => item.node_type === "database");
    if (!scopeNodeId) return all;
    const ids = new Set(collectSubtreeIds(nodes, scopeNodeId));
    const scoped = all.filter((item) => ids.has(item.id));
    return scoped.length ? scoped : all;
  }, [nodes, scopeNodeId]);

  useEffect(() => {
    if (aiSelection.model === "local") {
      setSelectedSources(["database"]);
    }
  }, [aiSelection.model]);

  useEffect(() => {
    if (!askVoiceDbId && askVoiceDatabases[0]) setAskVoiceDbId(askVoiceDatabases[0].id);
  }, [askVoiceDatabases, askVoiceDbId]);

  useEffect(() => {
    if (!attachmentDbId && askVoiceDatabases[0]) setAttachmentDbId(askVoiceDatabases[0].id);
  }, [askVoiceDatabases, attachmentDbId]);

  useEffect(() => {
    return () => {
      try { askVoiceSpeechRef.current?.stop(); } catch {}
      try {
        if (askVoiceRecorderRef.current?.state && askVoiceRecorderRef.current.state !== "inactive") {
          askVoiceRecorderRef.current.stop();
        }
      } catch {}
      askVoiceStreamRef.current?.getTracks().forEach((track) => track.stop());
      if (askVoiceTimerRef.current) window.clearInterval(askVoiceTimerRef.current);
    };
  }, []);

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

  function firstUrl(value: string) {
    return value.match(/https?:\/\/[^\s<>"')\]]+/i)?.[0] || "";
  }

  function wantsDatabaseSave(value: string) {
    const text = value.toLowerCase();
    const saveWord = /(masukin|masukkan|masukkin|simpan|save|tambahkan|tambahin)/i.test(text);
    return saveWord && /(database|\bdb\b)/i.test(text);
  }

  function suggestedDatabaseId(value: string) {
    const lower = value.toLowerCase();
    const exact = askVoiceDatabases
      .slice()
      .sort((a, b) => b.title.length - a.title.length)
      .find((item) => lower.includes(item.title.toLowerCase()));
    return exact?.id || attachmentDbId || askVoiceDatabases[0]?.id || "";
  }

  async function prepareAskLink(rawUrl: string) {
    const url = rawUrl.trim();
    if (!url) return;
    setLinkBusy(true);
    setLinkStatus("Membaca link RAW langsung...");
    const response = await fetch("/api/ask-link", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + session.access_token,
      },
      body: JSON.stringify({ url }),
    });
    const result = await response.json().catch(() => ({}));
    setLinkBusy(false);

    if (!response.ok) {
      setLinkStatus("");
      alert(result.error || "Link tidak dapat dibaca.");
      return;
    }

    setPendingLink({
      url: String(result.url || url),
      title: String(result.title || url),
      mimeType: String(result.mimeType || "text/html"),
      rawText: String(result.rawText || ""),
    });
    setLinkDraft("");
    setLinkInputOpen(false);
    setAttachMenuOpen(false);
    setLinkStatus("Link RAW siap dipakai AI. Belum disimpan ke Database.");
  }

  function discardPendingLink() {
    setPendingLink(null);
    setLinkStatus("Link diabaikan.");
  }

  async function savePendingLinkToDatabase() {
    if (!pendingLink || !attachmentDbId) return;
    const target = askVoiceDatabases.find((item) => item.id === attachmentDbId);
    if (!target) return;

    setLinkBusy(true);
    setLinkStatus("Menyimpan link RAW ke Database...");
    const response = await fetch("/api/import-link", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + session.access_token,
      },
      body: JSON.stringify({ nodeId: target.id, url: pendingLink.url }),
    });
    const result = await response.json().catch(() => ({}));
    setLinkBusy(false);

    if (!response.ok) {
      setLinkStatus("");
      return alert(result.error || "Gagal menyimpan link.");
    }

    setPendingLink(null);
    setLinkStatus("Link RAW sudah masuk Database: " + target.title + ".");
    onChange();
  }

  async function saveQuestionTextToDatabase() {
    const text = String(pendingTextSave || question).trim();
    if (!text || !attachmentDbId) return;
    const target = askVoiceDatabases.find((item) => item.id === attachmentDbId);
    if (!target) return;

    setAttachmentBusy(true);
    const { error } = await supabase.from("knowledge_entries").insert({
      user_id: session.user.id,
      node_id: target.id,
      title: "Catatan dari AI Bar - " + new Date().toLocaleString("id-ID"),
      category: "Teks dari AI Bar",
      content: text,
      raw_content: text,
      source_type: "manual",
    });
    setAttachmentBusy(false);

    if (error) return alert(error.message);
    setPendingTextSave(null);
    setAttachmentStatus("Teks sudah masuk Database: " + target.title + ".");
    onChange();
  }

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
        const haystack = (entry.title + " " + entry.category + " " + (entry.raw_content || entry.content)).toLowerCase();
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
      const sentences = (entry.raw_content || entry.content)
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
      return matching || (entry.raw_content || entry.content).slice(0, 420);
    });

    return {
      text: snippets.join("\n\n"),
      refs: ranked.map(({ entry }) => ({ id: entry.id, title: entry.title, category: entry.category })),
    };
  }


  function localAiDatabaseContext(query: string) {
    const words = Array.from(new Set(
      query.toLowerCase().match(/[a-z0-9À-ÿ]{3,}/gi)?.map((word) => word.toLowerCase()) || []
    ));
    const ranked = scopedLocalEntries()
      .map((entry) => {
        const haystack = (entry.title + " " + entry.category + " " + (entry.raw_content || entry.content)).toLowerCase();
        const score = words.reduce((total, word) => total + (haystack.includes(word) ? 1 : 0), 0);
        return { entry, score };
      })
      .sort((a, b) => b.score - a.score)
      .filter((item, index) => item.score > 0 || index < 4)
      .slice(0, 10);

    let used = 0;
    const chunks: string[] = [];
    const refs: Array<{ id: string; title: string; category: string }> = [];

    for (const { entry } of ranked) {
      const raw = String(entry.raw_content || entry.content || "").trim();
      const structured = String(entry.content || "").trim();
      const chunk = (
        "[" + entry.title + " · " + entry.category + " · RAW/ORIGINAL]\n" +
        raw +
        (structured && structured !== raw
          ? "\n\n[VERSI TERTATA · BANTUAN]\n" + structured
          : "")
      ).trim();
      if (!chunk) continue;
      const remaining = 18000 - used;
      if (remaining <= 0) break;
      const clipped = chunk.slice(0, remaining);
      chunks.push(clipped);
      refs.push({ id: entry.id, title: entry.title, category: entry.category });
      used += clipped.length;
    }

    return { context: chunks.join("\n\n---\n\n"), refs };
  }

  async function askLocalOpenAI(query: string) {
    const config = getSessionLocalAiConfig();
    if (!config.endpoint) {
      throw new Error("Local AI belum terhubung. Buka + Plugin lalu hubungkan LM Studio, Ollama, atau endpoint OpenAI-compatible.");
    }
    if (selectedSources.includes("web")) {
      throw new Error("Web Search Ruang Belajar tidak dijalankan oleh model lokal. Pilih model cloud untuk memakai Web.");
    }

    const useAi = selectedSources.includes("ai");
    const useDatabase = selectedSources.includes("database");
    const database = useDatabase ? localAiDatabaseContext(query) : { context: "", refs: [] as Array<{ id: string; title: string; category: string }> };

    if (useDatabase && !useAi && !database.context) {
      return {
        text: "Materi ini belum tersedia di database.",
        refs: database.refs,
        model: providerModelId(aiSelection.model),
      };
    }

    const rules = [
      "Anda adalah tutor Ruang Belajar.",
      "Sumber dipilih user:",
      "- AI: " + (useAi ? "AKTIF" : "TIDAK"),
      "- Database: " + (useDatabase ? "AKTIF" : "TIDAK"),
      "- Web: TIDAK",
      "",
      useAi
        ? "Anda boleh memakai pengetahuan internal model."
        : "Jangan gunakan pengetahuan internal model sebagai sumber fakta. Jawab hanya dari Database yang diberikan.",
      useDatabase
        ? "Gunakan Database pribadi di bawah sebagai sumber."
        : "Jangan mengklaim memakai Database karena Database tidak dipilih.",
      "Jawab jelas, ringkas, dan terstruktur.",
    ];

    if (useDatabase && !useAi) {
      rules.push('Jika Database tidak cukup, jawab persis: "Materi ini belum tersedia di database."');
    }

    const prompt = [
      rules.join("\n"),
      "",
      "PERTANYAAN:",
      query,
      useDatabase ? "\nDATABASE PRIBADI RAW/ORIGINAL:\n" + (database.context || "(kosong)") : "",
      pendingAttachment?.rawText
        ? "\nLAMPIRAN RAW/ORIGINAL · " + pendingAttachment.fileName + ":\n" + pendingAttachment.rawText
        : "",
      pendingLink?.rawText
        ? "\nLINK RAW DIRECT · " + pendingLink.url + ":\n" + pendingLink.rawText
        : "",
    ].join("\n");

    const base = config.endpoint.replace(/\/+$/, "");
    const messages: any[] = [
      { role: "system", content: "Ikuti instruksi sumber Ruang Belajar dengan ketat." },
      { role: "user", content: prompt },
    ];

    let mcp: McpConfig | null = null;
    try {
      const savedMcp = getSessionMcpConfig();
      if (savedMcp.url) mcp = await ensureMcpSession(savedMcp);
    } catch {
      mcp = null;
    }

    const toolMap = new Map<string, McpTool>();
    const toolDefinitions = (mcp?.tools || []).slice(0, 40).map((tool, index) => {
      const safe =
        ("mcp_" + index + "_" + tool.name)
          .replace(/[^a-zA-Z0-9_-]/g, "_")
          .slice(0, 64);
      toolMap.set(safe, tool);
      return {
        type: "function",
        function: {
          name: safe,
          description: tool.description || ("MCP tool: " + tool.name),
          parameters:
            tool.inputSchema && typeof tool.inputSchema === "object"
              ? tool.inputSchema
              : { type: "object", properties: {} },
        },
      };
    });

    async function localCompletion(includeTools: boolean) {
      let response: Response;
      try {
        response = await fetch(base + "/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(config.apiKey ? { Authorization: "Bearer " + config.apiKey } : {}),
          },
          body: JSON.stringify({
            model: providerModelId(aiSelection.model),
            messages,
            stream: false,
            ...(includeTools && toolDefinitions.length
              ? { tools: toolDefinitions, tool_choice: "auto" }
              : {}),
          }),
        });
      } catch {
        throw new Error(
          "Browser tidak dapat menjangkau Local AI. Pastikan server aktif dan CORS mengizinkan origin https://web-fzalmajid.vercel.app."
        );
      }

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (includeTools && toolDefinitions.length) {
          return localCompletion(false);
        }
        throw new Error(
          String(data?.error?.message || data?.error || "Local AI gagal memproses request.")
        );
      }
      return data;
    }

    let data = await localCompletion(true);

    for (let round = 0; round < 2; round++) {
      const assistant = data?.choices?.[0]?.message;
      const toolCalls = Array.isArray(assistant?.tool_calls) ? assistant.tool_calls.slice(0, 4) : [];
      if (!toolCalls.length || !mcp) break;

      messages.push({
        role: "assistant",
        content: assistant?.content || "",
        tool_calls: toolCalls,
      });

      for (const toolCall of toolCalls) {
        const exposedName = String(toolCall?.function?.name || "");
        const original = toolMap.get(exposedName);
        if (!original) continue;

        let args: Record<string, any> = {};
        try {
          const raw = String(toolCall?.function?.arguments || "{}");
          args = JSON.parse(raw);
        } catch {}

        let result: any;
        try {
          const called = await mcpRpc(
            mcp.url,
            mcp.token,
            "tools/call",
            { name: original.name, arguments: args },
            mcp.sessionId
          );
          mcp.sessionId = called.sessionId || mcp.sessionId;
          window.sessionStorage.setItem("rb-mcp-session", mcp.sessionId);
          result = called.result;
        } catch (error: any) {
          result = { error: error?.message || "MCP tool gagal dijalankan." };
        }

        messages.push({
          role: "tool",
          tool_call_id: String(toolCall?.id || exposedName),
          content: JSON.stringify(result).slice(0, 16000),
        });
      }

      data = await localCompletion(true);
    }

    const content = data?.choices?.[0]?.message?.content;
    const text =
      typeof content === "string"
        ? content.trim()
        : Array.isArray(content)
          ? content.map((part: any) => String(part?.text || part?.content || "")).join("\n").trim()
          : "";

    if (!text) throw new Error("Local AI terhubung tetapi tidak mengembalikan teks.");

    return {
      text,
      refs: database.refs,
      model: providerModelId(aiSelection.model),
    };
  }

  function startAskSpeechRecognition() {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return false;

    const recognition = new SpeechRecognition();
    recognition.lang = "id-ID";
    recognition.continuous = true;
    recognition.interimResults = true;
    askVoiceTranscriptRef.current = "";

    recognition.onresult = (event: any) => {
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const text = String(event.results[index][0]?.transcript || "").trim();
        if (!text) continue;
        if (event.results[index].isFinal) {
          askVoiceTranscriptRef.current = (askVoiceTranscriptRef.current + " " + text).trim();
        } else {
          interim = (interim + " " + text).trim();
        }
      }
      askVoiceLiveDraftRef.current = (askVoiceTranscriptRef.current + " " + interim).trim();
    };

    recognition.onerror = () => {};
    recognition.onend = () => {
      if (askVoiceSpeechRef.current === recognition && askVoiceRecorderRef.current?.state === "recording") {
        try { recognition.start(); } catch {}
      }
    };
    askVoiceSpeechRef.current = recognition;
    try {
      recognition.start();
      if (askVoiceTimerRef.current) window.clearInterval(askVoiceTimerRef.current);
      askVoiceTimerRef.current = window.setInterval(() => {
        const draft = askVoiceLiveDraftRef.current.trim();
        if (draft) setQuestion(draft);
      }, 20000);
      return true;
    } catch {
      askVoiceSpeechRef.current = null;
      return false;
    }
  }

  async function discardPendingVoice(silent = false) {
    const current = pendingVoice;
    if (!current) return;
    await supabase.storage.from("recordings").remove([current.path]);
    await supabase.from("recordings").delete().eq("id", current.id);
    setPendingVoice(null);
    if (!silent) setAskVoiceStatus("Rekaman diabaikan. Teks pertanyaan tetap ada.");
    onChange();
  }

  async function startAskVoice() {
    try {
      if (pendingVoice) await discardPendingVoice(true);
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw new Error("Browser ini belum mendukung perekaman audio.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 48000,
        },
      });
      askVoiceStreamRef.current = stream;

      const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
      const mimeType = candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 128000 })
        : new MediaRecorder(stream, { audioBitsPerSecond: 128000 });

      askVoiceChunksRef.current = [];
      askVoiceTranscriptRef.current = "";
      askVoiceLiveDraftRef.current = "";
      askVoiceRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size) askVoiceChunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        askVoiceStreamRef.current = null;
        const blob = new Blob(askVoiceChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        await processAskVoice(blob);
      };

      askVoiceStartedRef.current = Date.now();
      recorder.start(650);
      const live = startAskSpeechRecognition();
      setAskVoiceRecording(true);
      setAskVoiceStatus(live ? "🎙️ Merekam · transkrip live mentah muncul tiap ±20 detik." : "🎙️ Merekam audio...");
    } catch (error: any) {
      setAskVoiceStatus(
        error?.name === "NotAllowedError"
          ? "Izin mikrofon ditolak. Izinkan mikrofon untuk situs ini."
          : error?.message || "Gagal memulai rekaman."
      );
    }
  }

  function stopAskVoice() {
    if (!askVoiceRecording) return;
    setAskVoiceRecording(false);
    const finalDraft = askVoiceLiveDraftRef.current.trim();
    if (finalDraft) setQuestion(finalDraft);
    if (askVoiceTimerRef.current) {
      window.clearInterval(askVoiceTimerRef.current);
      askVoiceTimerRef.current = null;
    }
    setAskVoiceBusy(true);
    setAskVoiceStatus("Menyiapkan transkrip mentah...");
    try { askVoiceSpeechRef.current?.stop(); } catch {}
    askVoiceSpeechRef.current = null;
    try {
      if (askVoiceRecorderRef.current?.state && askVoiceRecorderRef.current.state !== "inactive") {
        askVoiceRecorderRef.current.stop();
      }
    } catch {
      setAskVoiceBusy(false);
      setAskVoiceStatus("Gagal menghentikan rekaman.");
    }
  }

  async function processAskVoice(blob: Blob) {
    if (!blob.size) {
      setAskVoiceBusy(false);
      setAskVoiceStatus("Rekaman kosong.");
      return;
    }

    const mimeType = normalizeAudioMime(blob.type || "audio/webm");
    const subtype = mimeType.split("/")[1]?.split(";")[0] || "webm";
    const ext = subtype === "mp4" || subtype === "m4a" ? "m4a" : subtype;
    const path = session.user.id + "/questions/" + crypto.randomUUID() + "." + ext;
    const title = "Pertanyaan AI - " + new Date().toLocaleString("id-ID");
    const duration = Math.max(1, Math.round((Date.now() - askVoiceStartedRef.current) / 1000));

    const upload = await supabase.storage.from("recordings").upload(path, blob, { contentType: mimeType });
    if (upload.error) {
      setAskVoiceBusy(false);
      setAskVoiceStatus("Audio gagal disiapkan.");
      return alert(upload.error.message);
    }

    const { data: row, error: rowError } = await supabase
      .from("recordings")
      .insert({
        user_id: session.user.id,
        node_id: null,
        title,
        file_path: path,
        mime_type: mimeType,
        duration_seconds: duration,
      })
      .select("*")
      .single();

    if (rowError) {
      await supabase.storage.from("recordings").remove([path]);
      setAskVoiceBusy(false);
      return alert(rowError.message);
    }

    const browserDraft = askVoiceLiveDraftRef.current.trim() || askVoiceTranscriptRef.current.trim() || question.trim();
    let transcript = browserDraft;

    setAskVoiceStatus("Mendengarkan audio asli secara verbatim · fokus bunyi dan vokal, tanpa koreksi...");
    const transcriptionSelection = defaultSelection("gemini-2.5-flash", "transcription");
    const response = await fetch("/api/transcribe", {
      method: "POST",
      headers: aiRequestHeaders(session, transcriptionSelection),
      body: JSON.stringify({
        recordingId: row.id,
        filePath: path,
        mimeType,
        purpose: "question",
        contextNodeId: null,
        browserTranscript: browserDraft,
        aiMode: legacyModeForSelection(transcriptionSelection),
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok) {
      transcript = String(data.rawTranscript || "").trim() || browserDraft;
    }

    if (transcript) {
      setQuestion(transcript);
      await supabase
        .from("recordings")
        .update({
          transcript,
          raw_transcript: transcript,
          structured_transcript: transcript,
          corrections: [],
        })
        .eq("id", row.id);
    }

    setPendingVoice({
      id: row.id,
      path,
      title,
      mimeType,
      duration,
      transcript,
    });
    setAskVoiceBusy(false);
    setAskVoiceStatus(
      transcript
        ? "Transkrip mentah sudah masuk ke teks pertanyaan. Silakan edit sendiri bila perlu, lalu Abaikan atau Simpan ke Database."
        : "Audio siap. Transkrip otomatis belum tersedia; ketik/koreksi pertanyaan lalu simpan atau abaikan."
    );
  }

  async function savePendingVoiceToDatabase() {
    if (!pendingVoice || !askVoiceDbId) return;
    const target = askVoiceDatabases.find((item) => item.id === askVoiceDbId);
    if (!target) return;

    setAskVoiceBusy(true);
    const editedText = question.trim() || pendingVoice.transcript.trim();
    let entryId: string | null = null;

    if (editedText) {
      const { data: entry, error } = await supabase
        .from("knowledge_entries")
        .insert({
          user_id: session.user.id,
          node_id: target.id,
          title: pendingVoice.title,
          category: "Pertanyaan suara",
          content: editedText,
          raw_content: pendingVoice.transcript || editedText,
          source_type: "transcript",
        })
        .select("id")
        .single();

      if (error) {
        setAskVoiceBusy(false);
        return alert(error.message);
      }
      entryId = entry.id;
    }

    const { error } = await supabase
      .from("recordings")
      .update({
        node_id: target.id,
        knowledge_entry_id: entryId,
        transcript: editedText || pendingVoice.transcript || null,
        raw_transcript: pendingVoice.transcript || editedText || null,
        structured_transcript: editedText || pendingVoice.transcript || null,
      })
      .eq("id", pendingVoice.id);

    setAskVoiceBusy(false);
    if (error) return alert(error.message);

    setPendingVoice(null);
    setAskVoiceStatus("Audio dan transkrip sudah masuk Database: " + target.title + ".");
    onChange();
  }

  async function processAskAttachment(file: File) {
    if (file.size > 50 * 1024 * 1024) {
      alert("File maksimal 50 MB.");
      return;
    }

    if (pendingAttachment?.filePath) {
      await supabase.storage.from("study-files").remove([pendingAttachment.filePath]);
    }

    setAttachmentBusy(true);
    setAttachmentStatus("Membaca sumber RAW dan menyiapkan file asli...");
    const form = new FormData();
    form.append("file", file);
    form.append("aiMode", aiMode);

    const headers = aiRequestHeaders(session, aiSelection) as Record<string, string>;
    delete headers["Content-Type"];
    delete headers["content-type"];

    const response = await fetch("/api/ask-attachment", {
      method: "POST",
      headers,
      body: form,
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      setAttachmentBusy(false);
      setAttachmentStatus("");
      alert(result.error || "Gagal membaca lampiran.");
      return;
    }

    const mimeType = String(result.mimeType || inferMime(file));
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_");
    const filePath =
      session.user.id + "/questions/" + crypto.randomUUID() + "-" + safeName;
    const upload = await supabase.storage
      .from("study-files")
      .upload(filePath, file, { contentType: mimeType });

    setAttachmentBusy(false);
    if (upload.error) {
      setAttachmentStatus("");
      alert(upload.error.message);
      return;
    }

    setPendingAttachment({
      file,
      fileName: String(result.fileName || file.name),
      mimeType,
      rawText: String(result.rawText || ""),
      filePath,
    });
    setAttachMenuOpen(false);
    setAttachmentStatus(
      "File asli + RAW siap dibaca AI. Belum disimpan ke Database."
    );
  }

  async function discardPendingAttachment() {
    const current = pendingAttachment;
    if (current?.filePath) {
      await supabase.storage.from("study-files").remove([current.filePath]);
    }
    setPendingAttachment(null);
    setAttachmentStatus("Lampiran diabaikan.");
    if (askAttachmentInputRef.current) askAttachmentInputRef.current.value = "";
  }

  async function savePendingAttachmentToDatabase() {
    if (!pendingAttachment || !attachmentDbId) return;
    const target = askVoiceDatabases.find((item) => item.id === attachmentDbId);
    if (!target) return;

    setAttachmentBusy(true);
    setAttachmentStatus("Menyimpan file asli ke Database dan menyiapkan versi tertata...");

    const file = pendingAttachment.file;
    const mimeType = pendingAttachment.mimeType || inferMime(file);
    const path = pendingAttachment.filePath;

    const { data: row, error: fileError } = await supabase
      .from("source_files")
      .insert({
        user_id: session.user.id,
        node_id: target.id,
        file_path: path,
        file_name: file.name,
        mime_type: mimeType,
        size_bytes: file.size,
        processing_status: aiSelection.model === "local" ? "ready" : "processing",
        raw_text: pendingAttachment.rawText,
        structured_text: aiSelection.model === "local" ? pendingAttachment.rawText : null,
        corrections: [],
        source_kind: "file",
        source_url: null,
      })
      .select("id")
      .single();

    if (fileError) {
      setAttachmentBusy(false);
      setAttachmentStatus("");
      return alert(fileError.message);
    }

    if (aiSelection.model === "local") {
      const { error: entryError } = await supabase.from("knowledge_entries").insert({
        user_id: session.user.id,
        node_id: target.id,
        title: file.name,
        category: "Lampiran RAW",
        content: pendingAttachment.rawText || file.name,
        raw_content: pendingAttachment.rawText || file.name,
        source_type: "file",
        source_file_id: row.id,
      });
      setAttachmentBusy(false);
      if (entryError) return alert(entryError.message);
    } else {
      const response = await fetch("/api/import-file", {
        method: "POST",
        headers: aiRequestHeaders(session, aiSelection),
        body: JSON.stringify({
          sourceFileId: row.id,
          filePath: path,
          fileName: file.name,
          mimeType,
          nodeId: target.id,
          aiMode,
        }),
      });
      const result = await response.json().catch(() => ({}));
      setAttachmentBusy(false);

      if (!response.ok) {
        await supabase.from("knowledge_entries").insert({
          user_id: session.user.id,
          node_id: target.id,
          title: file.name,
          category: "Lampiran RAW",
          content: pendingAttachment.rawText || file.name,
          raw_content: pendingAttachment.rawText || file.name,
          source_type: "file",
          source_file_id: row.id,
        });
        setAttachmentStatus(
          "File asli sudah masuk Database; versi tertata belum selesai."
        );
        setPendingAttachment(null);
        onChange();
        return;
      }
    }

    setAttachmentStatus(
      "File asli + RAW sudah masuk Database: " + target.title + "."
    );
    setPendingAttachment(null);
    if (askAttachmentInputRef.current) askAttachmentInputRef.current.value = "";
    onChange();
  }

  function toggleSource(source: SourceKind) {
    const provider = modelProvider(aiSelection.model);
    if (source !== "database" && aiSelection.model === "local") {
      setAiSelection(defaultSelection("gemini-2.5-flash-lite", "chat"));
    } else if (source === "web" && provider === "local-openai") {
      setAiSelection(defaultSelection("gemini-2.5-flash-lite", "chat"));
    }

    setSelectedSources((current) => {
      if (current.includes(source)) {
        if (current.length === 1) return current;
        return current.filter((item) => item !== source);
      }
      return [...current, source];
    });
  }

  function sourcesLabel(value = selectedSources) {
    const ordered: SourceKind[] = ["ai", "database", "web"];
    const labels: Record<SourceKind, string> = {
      ai: "AI",
      database: "Database",
      web: "Web",
    };
    return ordered.filter((item) => value.includes(item)).map((item) => labels[item]).join(" + ");
  }

  async function ask(e: FormEvent) {
    e.preventDefault();
    if (!question.trim() || !selectedSources.length) return;

    const typedUrl = firstUrl(question);
    const effectiveUrl = pendingLink?.url || typedUrl;
    const wantsSave = wantsDatabaseSave(question);

    if (wantsSave) {
      const suggested = suggestedDatabaseId(question);
      if (suggested) setAttachmentDbId(suggested);
      if (!effectiveUrl && !pendingAttachment && !pendingVoice) {
        setPendingTextSave(question.trim());
      }
    }

    if (typedUrl && !pendingLink) {
      void prepareAskLink(typedUrl);
    }

    setBusy(true);
    setOpen(true);
    setAnswer("");
    setAnswerModel("");
    setSources([]);
    setWebSources([]);
    setWarning("");

    if (aiSelection.model === "local") {
      if (pendingAttachment?.rawText || pendingLink?.rawText) {
        const raw = [
          pendingAttachment?.rawText || "",
          pendingLink?.rawText || "",
        ].filter(Boolean).join("\n\n---\n\n");
        setAnswer(raw);
        setAnswerModel("Sumber RAW / Local");
        setSources([]);
        setBusy(false);
        return;
      }
      const local = answerLocally(question.trim());
      setAnswer(local.text);
      setAnswerModel("Browser / Local");
      setSources(local.refs);
      setBusy(false);
      return;
    }

    if (modelProvider(aiSelection.model) === "local-openai") {
      try {
        const local = await askLocalOpenAI(question.trim());
        setAnswer(local.text);
        setAnswerModel(local.model + " · Local");
        setSources(local.refs);
      } catch (error: any) {
        setAnswer(error?.message || "Local AI gagal menjawab.");
      } finally {
        setBusy(false);
      }
      return;
    }

    const attachmentRaw = [
      pendingAttachment?.rawText || "",
      pendingLink?.rawText || "",
    ].filter(Boolean).join("\n\n---\n\n");

    const response = await fetch("/api/ask", {
      method: "POST",
      headers: aiRequestHeaders(session, aiSelection),
      body: JSON.stringify({
        question,
        scopeNodeId,
        aiMode,
        sources: selectedSources,
        attachmentTitle:
          pendingAttachment?.fileName ||
          pendingLink?.title ||
          "",
        attachmentRaw,
        attachmentPath: pendingAttachment?.filePath || "",
        attachmentMimeType: pendingAttachment?.mimeType || "",
        attachmentUrl: effectiveUrl,
      }),
    });

    const data = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      setAnswer(data.error || "Model belum dapat memproses permintaan ini. Coba model lain.");
      return;
    }

    setAnswer(data.answer || "");
    setAnswerModel(String(data.model || ""));
    setSources(data.sources || []);
    setWebSources(data.webSources || []);
    setWarning(data.warning || "");
    if (Array.isArray(data.selectedSources) && data.selectedSources.length) {
      setSelectedSources(data.selectedSources);
    }
  }

  const activeSourcesLabel = sourcesLabel();

  return (
    <>
      {open && (
        <div className="aiAnswer" style={{ bottom: composerBottom + composerHeight + 12 }}>
          <div className="aiAnswerHead">
            <div>
              <small title={scopeName}>
                {aiSelection.model === "local"
                  ? "Local"
                  : modelCapability(aiSelection.model).label +
                    (modelCapability(aiSelection.model).efforts.length
                      ? " · " + modelCapability(aiSelection.model).efforts.find((item) => item.value === aiSelection.effort)?.label
                      : "")}
                {" · "}{activeSourcesLabel}
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
              ? "Memproses dari " + activeSourcesLabel + "..."
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
          <div className="askScope" title={scopeName}>{scopeName}</div>
          <div className="askControls">
            <div className="sourceToggleGroup" role="group" aria-label="Sumber jawaban">
              {([
                { id: "ai" as const, label: "AI" },
                { id: "database" as const, label: "Database" },
                { id: "web" as const, label: "Web" },
              ]).map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={selectedSources.includes(item.id) ? "sourceToggle active" : "sourceToggle"}
                  onClick={() => toggleSource(item.id)}
                  aria-pressed={selectedSources.includes(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <AiModePicker
              value={aiSelection}
              onChange={setAiSelection}
              action={selectedSources.includes("web") ? "ask_web" : "ask"}
              context="chat"
              compact
            />
          </div>
        </div>
        <div className="askInputRow">
          <input
            ref={askAttachmentInputRef}
            className="askAttachmentInput"
            type="file"
            accept=".pdf,.docx,.pptx,.txt,.md,.csv,.json,.xml,.mp3,.wav,.m4a,.aac,.ogg,.flac,.opus,.webm,.mp4,.mov,.png,.jpg,.jpeg,.webp"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void processAskAttachment(file);
            }}
          />
          <button
            type="button"
            className={attachMenuOpen ? "askAttach active" : "askAttach"}
            disabled={attachmentBusy}
            onClick={() => setAttachMenuOpen((value) => !value)}
            aria-label="Tambahkan file, foto, atau link"
            title="Tambahkan sumber"
          >
            {attachmentBusy ? "…" : "+"}
          </button>
          <button
            type="button"
            className={askVoiceRecording ? "askMic recording" : "askMic"}
            disabled={askVoiceBusy}
            onClick={askVoiceRecording ? stopAskVoice : startAskVoice}
            aria-label={askVoiceRecording ? "Stop rekam pertanyaan" : "Rekam pertanyaan"}
            title={askVoiceRecording ? "Stop rekam" : "Rekam pertanyaan"}
          >
            {askVoiceRecording ? "⏹️" : "🎙️"}
          </button>
          <textarea
            rows={1}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = Math.min(el.scrollHeight, 140) + "px";
            }}
            placeholder={askVoiceRecording ? "Sedang mendengarkan..." : "Tanya dari " + activeSourcesLabel + "..."}
          />
          <button className="sendAsk" disabled={busy || !question.trim() || !selectedSources.length}>
            {busy ? "..." : "↑"}
          </button>
        </div>

        {attachMenuOpen && (
          <div className="askAttachMenu">
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setAttachMenuOpen(false);
                askAttachmentInputRef.current?.click();
              }}
            >
              📎 File / Foto
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setLinkInputOpen(true);
                setAttachMenuOpen(false);
              }}
            >
              🔗 Link
            </button>
          </div>
        )}

        {linkInputOpen && (
          <div className="askLinkInputRow">
            <input
              type="url"
              value={linkDraft}
              onChange={(e) => setLinkDraft(e.target.value)}
              placeholder="https://..."
              autoFocus
            />
            <button
              type="button"
              className="primary"
              disabled={linkBusy || !linkDraft.trim()}
              onClick={() => void prepareAskLink(linkDraft)}
            >
              {linkBusy ? "Membaca..." : "Tambahkan"}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setLinkInputOpen(false);
                setLinkDraft("");
              }}
            >
              Batal
            </button>
          </div>
        )}

        {(askVoiceStatus || pendingVoice) && (
          <div className="askVoicePanel">
            {askVoiceStatus && <small>{askVoiceStatus}</small>}
            {pendingVoice && (
              <div className="askVoiceSaveRow">
                <select value={askVoiceDbId} onChange={(e) => setAskVoiceDbId(e.target.value)}>
                  <option value="">Pilih Database</option>
                  {askVoiceDatabases.map((database) => (
                    <option key={database.id} value={database.id}>{database.title}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="ghost"
                  disabled={askVoiceBusy}
                  onClick={() => discardPendingVoice(false)}
                >
                  Abaikan
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={askVoiceBusy || !askVoiceDbId}
                  onClick={savePendingVoiceToDatabase}
                >
                  Simpan ke Database
                </button>
              </div>
            )}
          </div>
        )}

        {(attachmentStatus || pendingAttachment) && (
          <div className="askAttachmentPanel">
            {attachmentStatus && <small>{attachmentStatus}</small>}
            {pendingAttachment && (
              <>
                <div className="askAttachmentName">
                  <strong>{pendingAttachment.fileName}</strong>
                  <small>{formatBytes(pendingAttachment.file.size)} · file asli + RAW siap dibaca AI</small>
                </div>
                <div className="askVoiceSaveRow">
                  <select value={attachmentDbId} onChange={(e) => setAttachmentDbId(e.target.value)}>
                    <option value="">Pilih Database</option>
                    {askVoiceDatabases.map((database) => (
                      <option key={database.id} value={database.id}>{database.title}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="ghost"
                    disabled={attachmentBusy}
                    onClick={() => void discardPendingAttachment()}
                  >
                    Abaikan
                  </button>
                  <button
                    type="button"
                    className="primary"
                    disabled={attachmentBusy || !attachmentDbId}
                    onClick={() => void savePendingAttachmentToDatabase()}
                  >
                    Simpan ke Database
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {(linkStatus || pendingLink) && (
          <div className="askAttachmentPanel">
            {linkStatus && <small>{linkStatus}</small>}
            {pendingLink && (
              <>
                <div className="askAttachmentName">
                  <strong>🔗 {pendingLink.title}</strong>
                  <small>{pendingLink.url} · sumber link RAW dibaca langsung</small>
                </div>
                <div className="askVoiceSaveRow">
                  <select value={attachmentDbId} onChange={(e) => setAttachmentDbId(e.target.value)}>
                    <option value="">Pilih Database</option>
                    {askVoiceDatabases.map((database) => (
                      <option key={database.id} value={database.id}>{database.title}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="ghost"
                    disabled={linkBusy}
                    onClick={discardPendingLink}
                  >
                    Abaikan
                  </button>
                  <button
                    type="button"
                    className="primary"
                    disabled={linkBusy || !attachmentDbId}
                    onClick={() => void savePendingLinkToDatabase()}
                  >
                    Simpan ke Database
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {pendingTextSave && (
          <div className="askAttachmentPanel">
            <small>Instruksi menyimpan ke Database terdeteksi. Teks tidak disimpan sebelum user menekan Simpan.</small>
            <div className="askAttachmentName">
              <strong>📝 Teks dari AI Bar</strong>
              <small>{pendingTextSave.slice(0, 180)}{pendingTextSave.length > 180 ? "…" : ""}</small>
            </div>
            <div className="askVoiceSaveRow">
              <select value={attachmentDbId} onChange={(e) => setAttachmentDbId(e.target.value)}>
                <option value="">Pilih Database</option>
                {askVoiceDatabases.map((database) => (
                  <option key={database.id} value={database.id}>{database.title}</option>
                ))}
              </select>
              <button
                type="button"
                className="ghost"
                disabled={attachmentBusy}
                onClick={() => setPendingTextSave(null)}
              >
                Abaikan
              </button>
              <button
                type="button"
                className="primary"
                disabled={attachmentBusy || !attachmentDbId}
                onClick={() => void saveQuestionTextToDatabase()}
              >
                Simpan ke Database
              </button>
            </div>
          </div>
        )}
      </form>
    </>
  );
}

function GeminiAccountConnection({ session }: { session: Session }) {
  type GoogleProject = { projectId: string; name: string; projectNumber: string };

  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<"none" | "google" | "api-key">("none");
  const [projectId, setProjectId] = useState("");
  const [projects, setProjects] = useState<GoogleProject[]>([]);
  const [manualProjectId, setManualProjectId] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  function syncConnectionState() {
    const google = getSessionGoogleGeminiAuth();
    if (google.accessToken && google.projectId) {
      setProvider("google");
      setProjectId(google.projectId);
      return;
    }
    if (getSessionGeminiKey()) {
      setProvider("api-key");
      setProjectId("");
      return;
    }
    setProvider("none");
    setProjectId("");
  }

  useEffect(() => {
    syncConnectionState();
  }, []);

  async function requestGoogleToken() {
    if (!GOOGLE_OAUTH_CLIENT_ID) {
      throw new Error(
        "Google connector belum dikonfigurasi admin. NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID perlu dipasang di Vercel. Untuk sementara API key manual tetap bisa dipakai."
      );
    }

    await loadGoogleIdentityScript();
    const google = (window as any).google;
    if (!google?.accounts?.oauth2?.initTokenClient) {
      throw new Error("Google Identity Services tidak tersedia.");
    }

    return await new Promise<{ access_token: string; expires_in: number }>((resolve, reject) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_OAUTH_CLIENT_ID,
        scope:
          "https://www.googleapis.com/auth/cloud-platform " +
          "https://www.googleapis.com/auth/generative-language.retriever",
        include_granted_scopes: true,
        callback: (response: any) => {
          if (response?.error || !response?.access_token) {
            reject(new Error(response?.error_description || "Izin Google tidak diberikan."));
            return;
          }
          resolve({
            access_token: String(response.access_token),
            expires_in: Number(response.expires_in || 3600),
          });
        },
        error_callback: () => reject(new Error("Jendela izin Google ditutup atau gagal dibuka.")),
      });

      client.requestAccessToken({ prompt: "consent" });
    });
  }

  async function connectGoogle() {
    setBusy(true);
    setMessage("");
    try {
      const token = await requestGoogleToken();
      window.sessionStorage.setItem("rb-google-gemini-token", token.access_token);
      window.sessionStorage.setItem(
        "rb-google-gemini-exp",
        String(Date.now() + Math.max(60, token.expires_in) * 1000)
      );

      const response = await fetch("/api/google-projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + session.access_token,
          "X-RB-Google-Access-Token": token.access_token,
        },
        body: "{}",
      });
      const data = await response.json();

      const nextProjects = Array.isArray(data.projects) ? data.projects : [];
      setProjects(nextProjects);

      if (!response.ok) {
        if (data.manualProjectAllowed) {
          setMessage(
            (data.error || "Daftar project Google tidak dapat dibaca otomatis.") +
              " Masukkan Project ID Google Cloud di bawah."
          );
          return;
        }
        throw new Error(data.error || "Project Google Cloud belum dapat dibaca.");
      }

      if (!nextProjects.length) {
        setMessage(
          "Akun Google sudah terhubung. Google belum mengembalikan project yang bisa dipakai otomatis; Project ID tetap tersedia sebagai fallback."
        );
      } else {
        const oauthProjectNumber = String(GOOGLE_OAUTH_CLIENT_ID).split("-")[0];
        const preferred =
          nextProjects.find((project: GoogleProject) => project.projectNumber === oauthProjectNumber) ||
          (nextProjects.length === 1 ? nextProjects[0] : null);

        if (preferred?.projectId) {
          setMessage("Akun Google terhubung. Menyiapkan Gemini otomatis...");
          await chooseGoogleProject(preferred.projectId);
          return;
        }

        setMessage("Akun Google terhubung. Pilih salah satu project Google Cloud yang tersedia.");
      }
    } catch (error: any) {
      setMessage(error?.message || "Gagal menghubungkan Google.");
    } finally {
      setBusy(false);
    }
  }

  async function chooseGoogleProject(nextProjectId: string) {
    const googleAuth = getSessionGoogleGeminiAuth();
    if (!googleAuth.accessToken) {
      setMessage("Izin Google sudah kedaluwarsa. Hubungkan Google lagi.");
      return;
    }

    setBusy(true);
    setMessage("");
    const response = await fetch("/api/check-google-gemini", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + session.access_token,
        "X-RB-Google-Access-Token": googleAuth.accessToken,
        "X-RB-Google-Project": nextProjectId,
      },
      body: "{}",
    });
    const data = await response.json();
    setBusy(false);

    if (!response.ok || data.valid === false) {
      setMessage(data.error || "Project belum dapat memakai Gemini API.");
      return;
    }

    window.sessionStorage.setItem("rb-google-gemini-project", nextProjectId);
    window.sessionStorage.removeItem("rb-user-gemini-key");
    const googleModelIds = Array.isArray(data.availableModels)
      ? data.availableModels.map((item: any) => String(item?.id || "")).filter(Boolean)
      : [];
    setStoredModelIds("rb-gemini-models", googleModelIds);
    emitPluginChange();
    setProvider("google");
    setProjectId(nextProjectId);

    const modelInfo =
      Array.isArray(data.recommendedAvailable) && data.recommendedAvailable.length
        ? " Model tersedia: " + data.recommendedAvailable.join(", ") + "."
        : "";
    setMessage(
      "Terhubung. Request berikutnya memakai quota Google Cloud project " +
        nextProjectId +
        "." +
        modelInfo
    );
  }

  async function connectApiKey() {
    const candidate = keyInput.trim() || getSessionGeminiKey();
    if (!candidate) {
      setMessage("Tempel Gemini API key dari Google AI Studio.");
      return;
    }

    setBusy(true);
    setMessage("");
    const response = await fetch("/api/check-gemini-key", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + session.access_token,
        "X-RB-Gemini-Key": candidate,
      },
      body: "{}",
    });
    const data = await response.json();
    setBusy(false);

    if (!response.ok || data.valid === false) {
      setMessage(data.error || "API key belum dapat dipakai.");
      return;
    }

    window.sessionStorage.setItem("rb-user-gemini-key", candidate);
    setStoredModelIds(
      "rb-gemini-models",
      Array.isArray(data.availableModels) ? data.availableModels.map(String) : []
    );
    window.sessionStorage.removeItem("rb-google-gemini-token");
    window.sessionStorage.removeItem("rb-google-gemini-project");
    window.sessionStorage.removeItem("rb-google-gemini-exp");
    setProvider("api-key");
    setProjectId("");
    setKeyInput("");
    emitPluginChange();
    setMessage("API key user aktif untuk sesi browser ini.");
  }

  function disconnect() {
    window.sessionStorage.removeItem("rb-user-gemini-key");
    window.sessionStorage.removeItem("rb-google-gemini-token");
    window.sessionStorage.removeItem("rb-google-gemini-project");
    window.sessionStorage.removeItem("rb-google-gemini-exp");
    window.sessionStorage.removeItem("rb-gemini-models");
    emitPluginChange();
    setProjects([]);
    setKeyInput("");
    setProvider("none");
    setProjectId("");
    setMessage("Gemini akun sendiri sudah diputus. Aplikasi kembali memakai provider bersama.");
  }

  const connected = provider !== "none";
  const providerLabel =
    provider === "google"
      ? "Google · " + projectId
      : provider === "api-key"
        ? "API key manual"
        : "Belum terhubung";

  return (
    <>
      <button
        className={connected ? "geminiConnect connected" : "geminiConnect"}
        onClick={() => setOpen(true)}
        title={connected ? "Integrasi Gemini aktif · " + providerLabel : "Hubungkan akun Google"}
      >
        {provider === "google" ? "Google terhubung ✓" : provider === "api-key" ? "Gemini terhubung ✓" : "Hubungkan Google"}
      </button>

      {open && (
        <div className="sheetBackdrop" onMouseDown={() => setOpen(false)}>
          <section className="addSheet geminiConnectSheet" onMouseDown={(e) => e.stopPropagation()}>
            <div className="sheetHead">
              <div>
                <p className="eyebrow">GEMINI SENDIRI</p>
                <h2>Hubungkan Google</h2>
              </div>
              <button className="closeBtn" onClick={() => setOpen(false)}>×</button>
            </div>

            <div className="geminiConnectionStatus">
              <small>STATUS</small>
              <strong>{providerLabel}</strong>
              <span>
                Token OAuth/API key disimpan hanya untuk sesi browser ini, bukan di Database Ruang Belajar.
              </span>
            </div>

            <div className="notice">
              Connector ini memakai <strong>Google Cloud / Gemini API project milik user</strong>.
              Jika akun punya Google AI Pro/Ultra, manfaat Developer Program dapat memberi kredit Cloud bulanan yang bisa diterapkan
              ke billing account user. Setelah kredit aktif, project yang sama dapat dipakai Ruang Belajar.
            </div>

            <div className="proCreditBox">
              <div>
                <strong>Punya Google AI Pro / Ultra?</strong>
                <small>
                  Klaim manfaat Google Developer Program, terapkan kredit Cloud ke billing account, lalu kembali dan pilih Project ID yang sama.
                </small>
              </div>
              <a
                className="ghost proCreditLink"
                href="https://developers.google.com/profile/u/me"
                target="_blank"
                rel="noreferrer"
              >
                Aktifkan kredit Pro
              </a>
            </div>

            <div className="googleConnectPrimary">
              <button className="primary" disabled={busy} onClick={connectGoogle}>
                {busy ? "Menghubungkan..." : provider === "google" ? "Hubungkan ulang Google" : "Hubungkan akun Google"}
              </button>
              {!GOOGLE_OAUTH_CLIENT_ID && (
                <small className="muted">
                  Admin belum memasang NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID, jadi tombol Google belum bisa membuka consent.
                </small>
              )}
            </div>

            {!!projects.length && (
              <div className="googleProjectList">
                <small>PILIH PROJECT GOOGLE CLOUD</small>
                {projects.map((project) => (
                  <button
                    type="button"
                    key={project.projectId}
                    className={projectId === project.projectId ? "googleProject active" : "googleProject"}
                    disabled={busy}
                    onClick={() => chooseGoogleProject(project.projectId)}
                  >
                    <span>
                      <strong>{project.name}</strong>
                      <small>{project.projectId}</small>
                    </span>
                    {projectId === project.projectId && <b>✓</b>}
                  </button>
                ))}
              </div>
            )}

            <div className="manualProjectConnect">
              <small>ATAU MASUKKAN PROJECT ID</small>
              <div className="manualProjectRow">
                <input
                  type="text"
                  value={manualProjectId}
                  onChange={(e) => setManualProjectId(e.target.value.trim())}
                  placeholder="contoh: ruang-belajar-123456"
                  autoComplete="off"
                />
                <button
                  type="button"
                  className="ghost"
                  disabled={busy || !manualProjectId}
                  onClick={() => chooseGoogleProject(manualProjectId)}
                >
                  Pakai Project ID
                </button>
              </div>
              <small className="muted">
                Project ID adalah ID teks Google Cloud, bukan nama project atau nomor project.
              </small>
            </div>

            <details className="advancedGeminiConnect">
              <summary>Advanced · API key manual</summary>
              <label className="geminiKeyField">
                Gemini API key
                <input
                  type="password"
                  autoComplete="off"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  placeholder={provider === "api-key" ? "API key sesi ini aktif" : "Tempel API key Google AI Studio"}
                />
                <small className="muted">
                  Fallback manual. Key hanya disimpan di sessionStorage browser dan tidak disimpan ke Supabase.
                </small>
              </label>
              <div className="geminiConnectActions">
                <button
                  className="ghost"
                  disabled={busy || (!keyInput.trim() && provider !== "api-key")}
                  onClick={connectApiKey}
                >
                  {busy ? "Memeriksa..." : "Pakai API key"}
                </button>
                <a className="textBtn" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
                  Google AI Studio
                </a>
              </div>
            </details>

            {connected && <button className="ghost" onClick={disconnect}>Putuskan koneksi Gemini sendiri</button>}
            {message && <div className="notice">{message}</div>}
          </section>
        </div>
      )}
    </>
  );
}

function LocalAiConnection() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<LocalAiKind>("lmstudio");
  const [endpoint, setEndpoint] = useState(localAiPresetEndpoint("lmstudio"));
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const saved = getSessionLocalAiConfig();
    setKind(saved.kind);
    setEndpoint(saved.endpoint || localAiPresetEndpoint(saved.kind));
    setApiKey(saved.apiKey);
    setModels(saved.models);
    setConnected(Boolean(saved.endpoint && saved.models.length));
  }, []);

  function chooseKind(next: LocalAiKind) {
    setKind(next);
    const preset = localAiPresetEndpoint(next);
    if (preset) setEndpoint(preset);
    if (next === "custom" && endpoint === localAiPresetEndpoint(kind)) setEndpoint("");
  }

  async function connect() {
    setBusy(true);
    setMessage("");

    const entered = endpoint.trim().replace(/\/+$/, "");
    const candidates =
      kind === "lmstudio"
        ? Array.from(new Set([entered, "http://127.0.0.1:1234/v1", "http://localhost:1234/v1"].filter(Boolean)))
        : kind === "ollama"
          ? Array.from(new Set([entered, "http://127.0.0.1:11434/v1", "http://localhost:11434/v1"].filter(Boolean)))
          : entered
            ? [entered]
            : [];

    if (!candidates.length) {
      setBusy(false);
      setMessage("Masukkan endpoint OpenAI-compatible.");
      return;
    }

    let lastError = "";
    try {
      for (const base of candidates) {
        try {
          const controller = new AbortController();
          const timer = window.setTimeout(() => controller.abort(), 2200);
          const response = await fetch(base + "/models", {
            method: "GET",
            headers: apiKey.trim() ? { Authorization: "Bearer " + apiKey.trim() } : {},
            signal: controller.signal,
          });
          window.clearTimeout(timer);
          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            lastError = String(data?.error?.message || data?.error || "Endpoint menolak request.");
            continue;
          }

          const available = Array.isArray(data?.data)
            ? data.data.map((item: any) => String(item?.id || "").trim()).filter(Boolean)
            : [];
          if (!available.length) {
            lastError = "Endpoint terhubung tetapi tidak mengembalikan model.";
            continue;
          }

          window.sessionStorage.setItem("rb-local-ai-kind", kind);
          window.sessionStorage.setItem("rb-local-ai-endpoint", base);
          if (apiKey.trim()) window.sessionStorage.setItem("rb-local-ai-key", apiKey.trim());
          else window.sessionStorage.removeItem("rb-local-ai-key");
          setStoredModelIds("rb-local-ai-models", available);
          setEndpoint(base);
          setModels(available);
          setConnected(true);
          emitPluginChange();
          setMessage(
            "Terhubung otomatis ke " + base + ". " +
              available.length +
              " model tersedia di Choose Model."
          );
          return;
        } catch (error: any) {
          lastError = error?.name === "AbortError" ? "Timeout saat mendeteksi local server." : String(error?.message || "Failed to fetch");
        }
      }

      setConnected(false);
      if (kind === "lmstudio") {
        setMessage(
          "LM Studio belum bisa diakses browser. Di LM Studio buka Developer → Start Server lalu aktifkan Enable CORS. " +
          "Atau jalankan: lms server start --cors"
        );
      } else if (kind === "ollama") {
        setMessage(
          "Ollama belum mengizinkan origin Ruang Belajar. Tambahkan https://web-fzalmajid.vercel.app ke OLLAMA_ORIGINS lalu restart Ollama."
        );
      } else {
        setMessage((lastError || "Endpoint belum dapat dihubungkan.") + " Pastikan endpoint aktif dan CORS mengizinkan Ruang Belajar.");
      }
    } finally {
      setBusy(false);
    }
  }

  function disconnect() {
    window.sessionStorage.removeItem("rb-local-ai-kind");
    window.sessionStorage.removeItem("rb-local-ai-endpoint");
    window.sessionStorage.removeItem("rb-local-ai-key");
    window.sessionStorage.removeItem("rb-local-ai-models");
    setModels([]);
    setConnected(false);
    emitPluginChange();
    setMessage("Local AI sudah diputus.");
  }

  return (
    <>
      <button
        type="button"
        className={connected ? "geminiConnect connected" : "geminiConnect"}
        onClick={() => setOpen(true)}
      >
        {connected ? "Terhubung ✓" : "Hubungkan lokal"}
      </button>

      {open && (
        <div className="sheetBackdrop" onMouseDown={() => setOpen(false)}>
          <section className="addSheet geminiConnectSheet" onMouseDown={(e) => e.stopPropagation()}>
            <div className="sheetHead">
              <div>
                <p className="eyebrow">LOCAL AI</p>
                <h2>AI di perangkat user</h2>
              </div>
              <button className="closeBtn" onClick={() => setOpen(false)}>×</button>
            </div>

            <div className="notice">
              Ruang Belajar menghubungi endpoint ini <strong>langsung dari browser user</strong>.
              Prompt tidak memakai quota Gemini/OpenAI pusat.
            </div>

            <div className="localProviderTabs">
              {([
                ["lmstudio", "LM Studio"],
                ["ollama", "Ollama"],
                ["custom", "Custom"],
              ] as Array<[LocalAiKind, string]>).map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  className={kind === value ? "active" : ""}
                  onClick={() => chooseKind(value)}
                >
                  {label}
                </button>
              ))}
            </div>

            <label className="geminiKeyField">
              OpenAI-compatible base URL
              <input
                type="text"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                placeholder="http://localhost:1234/v1"
                autoComplete="off"
              />
            </label>

            <label className="geminiKeyField">
              API key (opsional)
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Kosongkan jika local server tidak memakai key"
                autoComplete="off"
              />
            </label>

            {!!models.length && (
              <div className="localModelPreview">
                <small>MODEL TERDETEKSI</small>
                <span>{models.slice(0, 6).join(" · ")}{models.length > 6 ? " · +" + (models.length - 6) : ""}</span>
              </div>
            )}

            <div className="geminiConnectActions">
              <button className="primary" disabled={busy || !endpoint.trim()} onClick={connect}>
                {busy ? "Mendeteksi..." : connected ? "Deteksi ulang" : "Hubungkan"}
              </button>
              {connected && <button className="ghost" onClick={disconnect}>Putuskan</button>}
            </div>

            {message && <div className="notice">{message}</div>}
          </section>
        </div>
      )}
    </>
  );
}

function McpConnection() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [tools, setTools] = useState<McpTool[]>([]);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const saved = getSessionMcpConfig();
    setUrl(saved.url);
    setToken(saved.token);
    setTools(saved.tools);
    setConnected(Boolean(saved.url && saved.tools.length));
  }, []);

  async function connect() {
    const target = url.trim();
    if (!target) {
      setMessage("Masukkan URL MCP Streamable HTTP.");
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      const base: McpConfig = {
        url: target,
        token: token.trim(),
        sessionId: "",
        tools: [],
      };
      const ready = await ensureMcpSession(base);

      window.sessionStorage.setItem("rb-mcp-url", target);
      if (token.trim()) window.sessionStorage.setItem("rb-mcp-token", token.trim());
      else window.sessionStorage.removeItem("rb-mcp-token");
      window.sessionStorage.setItem("rb-mcp-session", ready.sessionId);
      window.sessionStorage.setItem("rb-mcp-tools", JSON.stringify(ready.tools));
      setTools(ready.tools);
      setConnected(true);
      emitPluginChange();
      setMessage(
        "MCP terhubung. " +
          ready.tools.length +
          " tool tersedia untuk model local/OpenAI-compatible yang mendukung function calling."
      );
    } catch (error: any) {
      setConnected(false);
      setMessage(
        (error?.message || "MCP belum dapat dihubungkan.") +
          " Pastikan server memakai Streamable HTTP dan mengizinkan CORS dari Ruang Belajar."
      );
    } finally {
      setBusy(false);
    }
  }

  function disconnect() {
    window.sessionStorage.removeItem("rb-mcp-url");
    window.sessionStorage.removeItem("rb-mcp-token");
    window.sessionStorage.removeItem("rb-mcp-session");
    window.sessionStorage.removeItem("rb-mcp-tools");
    setTools([]);
    setConnected(false);
    emitPluginChange();
    setMessage("MCP sudah diputus.");
  }

  return (
    <>
      <button
        type="button"
        className={connected ? "geminiConnect connected" : "geminiConnect"}
        onClick={() => setOpen(true)}
      >
        {connected ? "MCP ✓" : "Hubungkan MCP"}
      </button>

      {open && (
        <div className="sheetBackdrop" onMouseDown={() => setOpen(false)}>
          <section className="addSheet geminiConnectSheet" onMouseDown={(e) => e.stopPropagation()}>
            <div className="sheetHead">
              <div>
                <p className="eyebrow">MCP</p>
                <h2>Model Context Protocol</h2>
              </div>
              <button className="closeBtn" onClick={() => setOpen(false)}>×</button>
            </div>

            <div className="notice">
              Hubungkan MCP server milik user langsung dari browser. Ruang Belajar akan membaca <strong>tools/list</strong> dan
              model lokal yang mendukung function calling dapat memanggil tool tersebut.
            </div>

            <label className="geminiKeyField">
              Streamable HTTP URL
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://mcp.example.com/mcp"
                autoComplete="off"
              />
            </label>

            <label className="geminiKeyField">
              Bearer token (opsional)
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Kosongkan jika server tidak memerlukan token"
                autoComplete="off"
              />
            </label>

            {!!tools.length && (
              <div className="localModelPreview">
                <small>TOOLS TERDETEKSI</small>
                <span>
                  {tools.slice(0, 8).map((tool) => tool.name).join(" · ")}
                  {tools.length > 8 ? " · +" + (tools.length - 8) : ""}
                </span>
              </div>
            )}

            <div className="geminiConnectActions">
              <button className="primary" disabled={busy || !url.trim()} onClick={connect}>
                {busy ? "Menghubungkan..." : connected ? "Hubungkan ulang" : "Hubungkan"}
              </button>
              {connected && <button className="ghost" onClick={disconnect}>Putuskan</button>}
            </div>

            {message && <div className="notice">{message}</div>}
          </section>
        </div>
      )}
    </>
  );
}

function ApiProviderConnection({
  session,
  provider,
}: {
  session: Session;
  provider: "openai" | "anthropic";
}) {
  const config =
    provider === "openai"
      ? {
          label: "GPT / OpenAI",
          eyebrow: "OPENAI",
          storageKey: "rb-user-openai-key",
          modelsKey: "rb-openai-models",
          header: "X-RB-OpenAI-Key",
          endpoint: "/api/check-openai-key",
          placeholder: "Tempel OpenAI API key",
          help: "https://platform.openai.com/api-keys",
        }
      : {
          label: "Claude / Anthropic",
          eyebrow: "CLAUDE",
          storageKey: "rb-user-anthropic-key",
          modelsKey: "rb-anthropic-models",
          header: "X-RB-Anthropic-Key",
          endpoint: "/api/check-anthropic-key",
          placeholder: "Tempel Claude API key",
          help: "https://console.anthropic.com/settings/keys",
        };

  const [open, setOpen] = useState(false);
  const [connected, setConnected] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setConnected(Boolean(window.sessionStorage.getItem(config.storageKey)));
  }, [config.storageKey]);

  async function connect() {
    const candidate = keyInput.trim() || String(window.sessionStorage.getItem(config.storageKey) || "").trim();
    if (!candidate) {
      setMessage("Masukkan credential API user.");
      return;
    }

    setBusy(true);
    setMessage("");
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + session.access_token,
        [config.header]: candidate,
      },
      body: "{}",
    });
    const data = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok || data.valid === false) {
      setMessage(data.error || "Credential belum dapat dipakai.");
      return;
    }

    window.sessionStorage.setItem(config.storageKey, candidate);
    setStoredModelIds(
      config.modelsKey,
      Array.isArray(data.availableModels) ? data.availableModels.map(String) : []
    );
    setKeyInput("");
    setConnected(true);
    emitPluginChange();
    const models = Array.isArray(data.recommendedAvailable) ? data.recommendedAvailable : [];
    setMessage(
      "Terhubung untuk sesi browser ini." +
        (models.length ? " Model tersedia: " + models.join(", ") + "." : "")
    );
  }

  function disconnect() {
    window.sessionStorage.removeItem(config.storageKey);
    window.sessionStorage.removeItem(config.modelsKey);
    setConnected(false);
    setKeyInput("");
    emitPluginChange();
    setMessage("Plugin sudah diputus.");
  }

  return (
    <>
      <button
        type="button"
        className={connected ? "geminiConnect connected" : "geminiConnect"}
        onClick={() => setOpen(true)}
      >
        {connected ? "Terhubung ✓" : "Hubungkan API"}
      </button>

      {open && (
        <div className="sheetBackdrop" onMouseDown={() => setOpen(false)}>
          <section className="addSheet geminiConnectSheet" onMouseDown={(e) => e.stopPropagation()}>
            <div className="sheetHead">
              <div>
                <p className="eyebrow">{config.eyebrow}</p>
                <h2>{config.label}</h2>
              </div>
              <button className="closeBtn" onClick={() => setOpen(false)}>×</button>
            </div>

            <div className="notice">
              Credential disimpan hanya di <strong>sessionStorage browser</strong>. Ruang Belajar tidak menyimpannya di Supabase.
              Pemakaian dan biaya masuk ke account API milik user.
            </div>

            <label className="geminiKeyField">
              API credential
              <input
                type="password"
                autoComplete="off"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder={connected ? "Credential sesi ini aktif" : config.placeholder}
              />
            </label>

            <div className="geminiConnectActions">
              <button className="primary" disabled={busy || (!keyInput.trim() && !connected)} onClick={connect}>
                {busy ? "Memeriksa..." : connected ? "Periksa / ganti credential" : "Hubungkan"}
              </button>
              <a className="textBtn" href={config.help} target="_blank" rel="noreferrer">
                Buka console provider
              </a>
            </div>

            {connected && <button className="ghost" onClick={disconnect}>Putuskan plugin</button>}
            {message && <div className="notice">{message}</div>}
          </section>
        </div>
      )}
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
  const [modelUsage, setModelUsage] = useState<Array<{ model: string; requests: number; total_tokens: number }>>([]);

  useEffect(() => {
    let active = true;

    async function load() {
      const [daily, models] = await Promise.all([
        supabase.rpc("get_ai_usage_today"),
        supabase.rpc("get_ai_model_usage_today"),
      ]);
      if (!active) return;

      if (daily.data) {
        setTotalTokens(Number(daily.data.total_tokens ?? 0));
        setInputTokens(Number(daily.data.input_tokens ?? 0));
        setOutputTokens(Number(daily.data.output_tokens ?? 0));
        const activeCount = Number(daily.data.actual_active_accounts ?? daily.data.active_accounts ?? 0);
        setActiveAccounts(Number.isFinite(activeCount) ? activeCount : 0);
      }

      if (Array.isArray(models.data)) {
        setModelUsage(
          models.data.map((item: any) => ({
            model: String(item.model || "unknown"),
            requests: Number(item.requests || 0),
            total_tokens: Number(item.total_tokens || 0),
          }))
        );
      }
    }

    void load();
    const timer = window.setInterval(load, 15000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const modelBreakdown = modelUsage.length
    ? modelUsage
        .map((item) => {
          const [provider, model] = item.model.includes("|")
            ? item.model.split("|", 2)
            : ["legacy", item.model];
          const providerLabel =
            provider === "user-google-oauth"
              ? "Google user"
              : provider === "user-api-key"
                ? "API user"
                : provider === "shared-api-key"
                  ? "Shared"
                  : "Legacy";
          return providerLabel + " · " + model + ": " + formatTokenUsage(item.total_tokens) + " token / " + item.requests + " request";
        })
        .join(" · ")
    : "Belum ada breakdown model pada request baru.";

  return (
    <span
      className="aiCreditPill"
      title={
        "Usage asli Gemini API · input " +
        formatTokenUsage(inputTokens) +
        " token · output " +
        formatTokenUsage(outputTokens) +
        " token · " +
        activeAccounts +
        " akun aktif · " +
        modelBreakdown
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

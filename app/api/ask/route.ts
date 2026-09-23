import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import {
  geminiGenerateDetailed,
  GeminiWebSearchQuotaError,
  WHATSAPP_FORMAT_INSTRUCTION,
  type GeminiPart,
} from "@/lib/gemini";
import {
  openaiGenerateDetailed,
  anthropicGenerateDetailed,
  ExternalAiError,
  type ExternalAiAttachment,
} from "@/lib/externalAi";
import { annotateBibliographicWorks, buildKnowledgeContext, diversifyKnowledgeSources, fuseHybridKnowledge, prioritizeQuestionRelevantSources, getScopeKnowledge, getSelectedKnowledge, searchScopeKnowledge, searchSelectedKnowledge, searchSemanticKnowledge } from "@/lib/knowledge";
import {
  modelPlanForSelection,
  modelProvider,
  providerModelId,
  selectionFromHeaders,
} from "@/lib/aiModels";
import { geminiUserAuthFromHeaders } from "@/lib/geminiUserAuth";
import {
  aiModeInstruction,
  aiQuotaError,
  checkAiCredits,
  finalizeAiCredits,
  normalizeAiMode,
  recordAiTokenUsage,
} from "@/lib/aiQuota";
import { citationInstruction, citationStructuralWarnings, normalizeCitationOptions, type CitationOutput, type CitationStyle } from "@/lib/citations";
import { artifactPromptInstruction, detectArtifactFormat, type ArtifactFormat } from "@/lib/artifacts";

function bearer(req: NextRequest) {
  const h = req.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

function isWebSearchQuotaError(error: unknown) {
  return (
    error instanceof GeminiWebSearchQuotaError ||
    (typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "WEB_SEARCH_QUOTA")
  );
}

function isWebProviderFailure(error: any) {
  const status = Number(error?.statusCode || 0);
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  return (
    isWebSearchQuotaError(error) ||
    status === 400 ||
    status === 401 ||
    status === 403 ||
    status === 404 ||
    status === 429 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    /web.?search|grounding|quota|rate.?limit|not available|not supported|unsupported|temporarily unavailable|high demand/i.test(
      code + " " + message
    )
  );
}

async function openAIWebModelCandidates(apiKey: string, preferred = "") {
  if (!apiKey) return [] as string[];
  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: "Bearer " + apiKey },
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(data?.data)) return [] as string[];

    const available = data.data
      .map((item: any) => String(item?.id || "").trim())
      .filter(
        (id: string) =>
          /^gpt-/i.test(id) &&
          !/audio|realtime|transcribe|tts|image|embedding|search-preview/i.test(id)
      );

    const ranked = available.sort((a: string, b: string) => {
      const score = (id: string) =>
        (id === preferred ? 100 : 0) +
        (/gpt-5/i.test(id) ? 50 : 0) +
        (/gpt-4\.1/i.test(id) ? 30 : 0);
      return score(b) - score(a);
    });
    return Array.from(new Set<string>(ranked as string[])).slice(0, 8);
  } catch {
    return [] as string[];
  }
}

async function anthropicWebModelCandidates(apiKey: string, preferred = "") {
  if (!apiKey) return [] as string[];
  try {
    const response = await fetch("https://api.anthropic.com/v1/models?limit=100", {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(data?.data)) return [] as string[];

    const available = data.data
      .map((item: any) => String(item?.id || "").trim())
      .filter((id: string) => /^claude-/i.test(id));

    const ranked = available.sort((a: string, b: string) => {
      const score = (id: string) =>
        (id === preferred ? 100 : 0) +
        (/sonnet|opus|fable/i.test(id) ? 40 : 0) +
        (/haiku/i.test(id) ? 10 : 0);
      return score(b) - score(a);
    });
    return Array.from(new Set<string>(ranked as string[])).slice(0, 8);
  } catch {
    return [] as string[];
  }
}


type RawAsset = {
  name: string;
  mimeType: string;
  data?: string;
  rawText?: string;
  sourceUrl?: string;
  origin: "attachment" | "database-file" | "database-recording" | "database-link";
};

function normalizeRawMime(value: string) {
  return String(value || "application/octet-stream").split(";")[0].trim().toLowerCase();
}

function supportsDirectBinary(mimeType: string) {
  const mime = normalizeRawMime(mimeType);
  return (
    mime.startsWith("image/") ||
    mime.startsWith("audio/") ||
    mime.startsWith("video/") ||
    mime === "application/pdf" ||
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/xml"
  );
}

function isSafePublicUrl(raw: string) {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "::1" ||
      host.endsWith(".local") ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    ) return false;
    return true;
  } catch {
    return false;
  }
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code) => String.fromCharCode(parseInt(code, 16)));
}

function htmlToReadableText(html: string) {
  return decodeHtmlEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

async function fetchExactRawLink(rawUrl: string): Promise<RawAsset | null> {
  if (!isSafePublicUrl(rawUrl)) return null;
  try {
    const response = await fetch(rawUrl, {
      redirect: "follow",
      cache: "no-store",
      headers: {
        "User-Agent": "RuangBelajar/1.0",
        Accept: "text/html,application/xhtml+xml,application/pdf,image/*,text/plain,*/*",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return null;

    const mimeType = normalizeRawMime(response.headers.get("content-type") || "text/html");
    const name = (() => {
      try {
        const u = new URL(response.url || rawUrl);
        return u.hostname + (u.pathname === "/" ? "" : u.pathname);
      } catch {
        return rawUrl;
      }
    })();

    if (mimeType.includes("text/html") || mimeType.startsWith("text/") || mimeType === "application/json" || mimeType === "application/xml") {
      const text = await response.text();
      const readable = mimeType.includes("html") ? htmlToReadableText(text) : text.trim();
      return {
        name,
        mimeType,
        rawText: readable.slice(0, 70000),
        sourceUrl: rawUrl,
        origin: "database-link",
      };
    }

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > 12 * 1024 * 1024) {
      return {
        name,
        mimeType,
        rawText: "Sumber URL berupa file binary yang terlalu besar untuk dilampirkan langsung pada request ini.",
        sourceUrl: rawUrl,
        origin: "database-link",
      };
    }
    return {
      name,
      mimeType,
      data: Buffer.from(arrayBuffer).toString("base64"),
      sourceUrl: rawUrl,
      origin: "database-link",
    };
  } catch {
    return null;
  }
}

async function resolveRawScopeNodeIds(
  supabase: any,
  userId: string,
  scopeNodeId: string | null
): Promise<string[] | null> {
  const { data: nodes } = await supabase
    .from("study_nodes")
    .select("id,parent_id")
    .eq("user_id", userId);

  if (!Array.isArray(nodes) || !nodes.length) {
    return scopeNodeId ? [scopeNodeId] : null;
  }

  if (!scopeNodeId) return nodes.map((node: any) => String(node.id));

  const result = [scopeNodeId];
  let cursor = 0;
  while (cursor < result.length) {
    const parentId = result[cursor++];
    for (const node of nodes) {
      const id = String(node.id || "");
      if (node.parent_id === parentId && id && !result.includes(id)) result.push(id);
    }
  }
  return result;
}

function rawCandidateScore(question: string, ...values: Array<unknown>) {
  const haystack = values.map((value) => String(value || "").toLowerCase()).join(" ");
  const words = Array.from(
    new Set(question.toLowerCase().match(/[a-z0-9À-ÿ]{3,}/gi)?.map((word) => word.toLowerCase()) || [])
  );
  return words.reduce((score, word) => score + (haystack.includes(word) ? 1 : 0), 0);
}

async function loadDatabaseRawAssets(
  supabase: any,
  rows: any[],
  userId: string,
  scopeNodeId: string | null,
  question: string
): Promise<RawAsset[]> {
  const assets: RawAsset[] = [];
  const matchedSourceFileIds = new Set(
    rows.map((row) => String(row.source_file_id || "")).filter(Boolean)
  );
  const matchedEntryIds = new Set(
    rows.map((row) => String(row.id || "")).filter(Boolean)
  );
  const scopeNodeIds = await resolveRawScopeNodeIds(supabase, userId, scopeNodeId);

  let sourceFilesQuery = supabase
    .from("source_files")
    .select("id,user_id,node_id,file_path,file_name,mime_type,size_bytes,raw_text,source_kind,source_url,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(80);

  if (scopeNodeIds?.length) {
    sourceFilesQuery = sourceFilesQuery.in("node_id", scopeNodeIds);
  }

  const { data: sourceFiles } = await sourceFilesQuery;
  const rankedFiles = (sourceFiles || [])
    .map((file: any, index: number) => ({
      file,
      score:
        (matchedSourceFileIds.has(String(file.id)) ? 1000 : 0) +
        rawCandidateScore(question, file.file_name, file.source_url, String(file.raw_text || "").slice(0, 12000)) +
        Math.max(0, 0.2 - index * 0.001),
    }))
    .sort((a: any, b: any) => b.score - a.score);

  for (const { file } of rankedFiles) {
    if (assets.length >= 4) break;

    if (file.source_kind === "link" && file.source_url) {
      const live = await fetchExactRawLink(String(file.source_url));
      if (live) {
        live.origin = "database-link";
        assets.push(live);
      } else if (file.raw_text) {
        assets.push({
          name: file.file_name || file.source_url,
          mimeType: "text/plain",
          rawText: String(file.raw_text).slice(0, 70000),
          sourceUrl: String(file.source_url),
          origin: "database-link",
        });
      }
      continue;
    }

    const mimeType = normalizeRawMime(file.mime_type);
    const size = Number(file.size_bytes || 0);

    if (!supportsDirectBinary(mimeType) || size > 12 * 1024 * 1024) {
      if (file.raw_text) {
        assets.push({
          name: file.file_name || "Database file",
          mimeType: "text/plain",
          rawText: String(file.raw_text).slice(0, 70000),
          origin: "database-file",
        });
      }
      continue;
    }

    const { data: blob } = await supabase.storage.from("study-files").download(file.file_path);
    if (!blob || blob.size > 12 * 1024 * 1024) continue;
    const buffer = Buffer.from(await blob.arrayBuffer());
    assets.push({
      name: file.file_name || "Database file",
      mimeType,
      data: buffer.toString("base64"),
      rawText: file.raw_text ? String(file.raw_text).slice(0, 50000) : undefined,
      origin: "database-file",
    });
  }

  if (assets.length < 4) {
    let recordingsQuery = supabase
      .from("recordings")
      .select("id,user_id,node_id,title,file_path,mime_type,knowledge_entry_id,raw_transcript,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(60);

    if (scopeNodeIds?.length) {
      recordingsQuery = recordingsQuery.in("node_id", scopeNodeIds);
    }

    const { data: recordings } = await recordingsQuery;
    const rankedRecordings = (recordings || [])
      .map((recording: any, index: number) => ({
        recording,
        score:
          (matchedEntryIds.has(String(recording.knowledge_entry_id || "")) ? 1000 : 0) +
          rawCandidateScore(
            question,
            recording.title,
            String(recording.raw_transcript || "").slice(0, 12000)
          ) +
          Math.max(0, 0.2 - index * 0.001),
      }))
      .sort((a: any, b: any) => b.score - a.score);

    for (const { recording } of rankedRecordings) {
      if (assets.length >= 4) break;
      const mimeType = normalizeRawMime(recording.mime_type || "audio/webm");
      const { data: blob } = await supabase.storage.from("recordings").download(recording.file_path);
      if (!blob || blob.size > 12 * 1024 * 1024) continue;
      const buffer = Buffer.from(await blob.arrayBuffer());
      assets.push({
        name: recording.title || "Rekaman Database",
        mimeType,
        data: buffer.toString("base64"),
        rawText: recording.raw_transcript
          ? String(recording.raw_transcript).slice(0, 50000)
          : undefined,
        origin: "database-recording",
      });
    }
  }

  return assets;
}

async function loadExplicitRawFiles(
  supabase: any,
  userId: string,
  sourceFileIds: string[]
): Promise<RawAsset[]> {
  if (!sourceFileIds.length) return [];

  const { data: sourceFiles } = await supabase
    .from("source_files")
    .select("id,user_id,node_id,file_path,file_name,mime_type,size_bytes,raw_text,source_kind,source_url")
    .eq("user_id", userId)
    .in("id", sourceFileIds)
    .limit(12);

  const assets: RawAsset[] = [];
  for (const file of sourceFiles || []) {
    if (assets.length >= 5) break;

    if (file.source_kind === "link" && file.source_url) {
      const linked = await fetchExactRawLink(String(file.source_url));
      if (linked) {
        linked.origin = "database-link";
        assets.push(linked);
      } else if (file.raw_text) {
        assets.push({
          name: file.file_name || file.source_url,
          mimeType: "text/plain",
          rawText: String(file.raw_text).slice(0, 70000),
          sourceUrl: String(file.source_url),
          origin: "database-link",
        });
      }
      continue;
    }

    const mimeType = normalizeRawMime(file.mime_type);
    const size = Number(file.size_bytes || 0);
    if (!supportsDirectBinary(mimeType) || size > 12 * 1024 * 1024) {
      if (file.raw_text) {
        assets.push({
          name: file.file_name || "Database file",
          mimeType: "text/plain",
          rawText: String(file.raw_text).slice(0, 70000),
          origin: "database-file",
        });
      }
      continue;
    }

    const { data: blob } = await supabase.storage.from("study-files").download(file.file_path);
    if (!blob || blob.size > 12 * 1024 * 1024) continue;
    const buffer = Buffer.from(await blob.arrayBuffer());
    assets.push({
      name: file.file_name || "Database file",
      mimeType,
      data: buffer.toString("base64"),
      rawText: file.raw_text ? String(file.raw_text).slice(0, 50000) : undefined,
      origin: "database-file",
    });
  }

  return assets;
}

async function loadCurrentRawAttachment(
  supabase: any,
  userId: string,
  body: any
): Promise<RawAsset[]> {
  const assets: RawAsset[] = [];
  const path = String(body.attachmentPath || "").trim();
  const fileName = String(body.attachmentTitle || "Lampiran").trim().slice(0, 240);
  const mimeType = normalizeRawMime(body.attachmentMimeType || "application/octet-stream");

  if (path && path.startsWith(userId + "/")) {
    const { data: blob } = await supabase.storage.from("study-files").download(path);
    if (blob && blob.size <= 12 * 1024 * 1024 && supportsDirectBinary(mimeType)) {
      const buffer = Buffer.from(await blob.arrayBuffer());
      assets.push({
        name: fileName,
        mimeType,
        data: buffer.toString("base64"),
        rawText: String(body.attachmentRaw || "").trim().slice(0, 60000) || undefined,
        origin: "attachment",
      });
    }
  }

  const url = String(body.attachmentUrl || "").trim();
  if (url) {
    const linked = await fetchExactRawLink(url);
    if (linked) {
      linked.origin = "attachment";
      assets.push(linked);
    }
  }

  return assets;
}

function rawAssetText(assets: RawAsset[]) {
  return assets
    .filter((asset) => asset.rawText)
    .map((asset) => {
      const label = asset.sourceUrl
        ? `RAW LINK DIRECT · ${asset.sourceUrl}`
        : `RAW SOURCE · ${asset.name}`;
      return `${label}:\n${asset.rawText}`;
    })
    .join("\n\n---\n\n");
}

function geminiRawParts(prompt: string, assets: RawAsset[]): GeminiPart[] {
  const parts: GeminiPart[] = [{ text: prompt }];
  for (const asset of assets) {
    if (!asset.data || !supportsDirectBinary(asset.mimeType)) continue;
    parts.push({ text: `RAW FILE ASLI · ${asset.name} · ${asset.mimeType}. Baca file ini langsung; jangan menggantinya dengan hasil ekstraksi teks.` });
    parts.push({ inlineData: { mimeType: asset.mimeType, data: asset.data } });
  }
  return parts;
}

function externalRawAttachments(assets: RawAsset[]): ExternalAiAttachment[] {
  return assets
    .filter((asset) => asset.data && (
      asset.mimeType.startsWith("image/") ||
      asset.mimeType === "application/pdf" ||
      asset.mimeType.startsWith("text/")
    ))
    .slice(0, 4)
    .map((asset) => ({
      name: asset.name,
      mimeType: asset.mimeType,
      data: asset.data as string,
    }));
}

type SourceKind = "ai" | "database" | "web";

function normalizeSources(body: any): SourceKind[] {
  if (Array.isArray(body?.sources)) {
    const valid = body.sources
      .map((value: unknown) => String(value).toLowerCase())
      .filter((value: string): value is SourceKind =>
        value === "ai" || value === "database" || value === "web"
      );
    return Array.from(new Set(valid));
  }
  if (body?.knowledgeMode === "web" || body?.publicWeb) return ["database", "web"];
  if (body?.knowledgeMode === "hybrid") return ["ai", "database"];
  return ["database"];
}

function buildPrompt({
  question,
  context,
  useAi,
  useDatabase,
  useWeb,
  aiMode,
  attachmentTitle,
  attachmentRaw,
  citationStyle,
  citationOutputs,
  artifactFormat,
}: {
  question: string;
  context: string;
  useAi: boolean;
  useDatabase: boolean;
  useWeb: boolean;
  aiMode: ReturnType<typeof normalizeAiMode>;
  attachmentTitle?: string;
  attachmentRaw?: string;
  citationStyle: CitationStyle;
  citationOutputs: CitationOutput[];
  artifactFormat?: ArtifactFormat | null;
}) {
  const sections = ["PERTANYAAN:", question.trim()];

  if (attachmentRaw?.trim()) {
    sections.push(
      "",
      "LAMPIRAN RAW/ORIGINAL" + (attachmentTitle ? " · " + attachmentTitle : "") + ":",
      attachmentRaw.trim(),
      "",
      "Lampiran di atas adalah sumber mentah untuk pertanyaan ini. Jangan menggantinya dengan hasil ringkasan/rapihan."
    );
  }

  if (useDatabase) {
    sections.push("", "DATABASE PRIBADI:", context);
  }

  const rules = [
    "SUMBER YANG DIPILIH USER:",
    "- AI: " + (useAi ? "AKTIF" : "TIDAK"),
    "- Database: " + (useDatabase ? "AKTIF" : "TIDAK"),
    "- Web: " + (useWeb ? "AKTIF" : "TIDAK"),
    "",
    "Aturan:",
    "- Jika ada LAMPIRAN RAW/ORIGINAL, baca sumber mentah itu secara langsung dan jadikan isi literalnya sebagai konteks utama lampiran.",
    "- Untuk Database, prioritaskan RAW/ORIGINAL content. Versi tertata/ringkasan hanya bantuan dan tidak boleh menggantikan fakta yang ada pada raw.",
    "- TELUSURI sumber berbeda yang relevan terlebih dahulu. Bila banyak sumber berbeda mendukung pertanyaan, gunakan sebanyak mungkin dalam batas konteks tanpa memasukkan sumber yang tidak relevan.",
    "- Sebelum mengulang sitasi satu buku/file, periksa semua sumber BERBEDA yang sudah ditemukan dan gunakan yang memang mendukung klaim. Boleh mengulang sumber utama sesudah sumber relevan lain terwakili, atau bila klaim hanya didukung sumber utama.",
    "- Jika hanya ada satu atau dua sumber relevan, gunakan hanya itu. Jika tidak ada bukti relevan dalam Database, katakan tidak ditemukan; jangan membuat kutipan atau daftar pustaka palsu.",
    "- Fokus relevansi pada ISI sumber, bukan nama file atau judul. Jangan memasukkan, mengutip, atau menampilkan sumber yang hanya kebetulan memiliki judul mirip tetapi isi chunk tidak mendukung pertanyaan.",
    "- Sumber yang hanya menyebut topik secara sepintas tidak perlu dipakai. Lebih baik sedikit sumber yang sangat relevan daripada banyak sumber yang lemah/tidak cocok.",
    "- Jangan mengabaikan handbook/referensi utama hanya karena materi kuliah lain memakai istilah yang lebih mirip dengan pertanyaan.",
    "- Untuk daftar pustaka/sitasi Database, gunakan hanya sumber yang benar-benar dipakai untuk mendukung isi jawaban dan hadir pada konteks Database; jangan mengarang atau mengganti judul sumber.",
    "- Jika konteks Database memuat label HALAMAN PDF, angka itu adalah nomor halaman file PDF sumber. Untuk pertanyaan halaman/lokasi monografi, gunakan metadata halaman tersebut dan jangan menebak nomor halaman.",
    "- Jika user meminta memasukkan/menyimpan sesuatu ke Database, jangan pernah mengklaim bahwa penyimpanan sudah dilakukan. Jawab isi pertanyaannya seperlunya; aplikasi akan meminta konfirmasi lewat tombol Simpan ke Database.",
  ];

  if (useDatabase) {
    rules.push("- Gunakan Database pribadi sebagai sumber sesuai kebutuhan.");
  } else {
    rules.push("- Jangan mengklaim memakai Database pribadi karena Database tidak dipilih.");
  }

  if (useAi) {
    rules.push("- Anda boleh memakai pengetahuan internal model.");
  } else {
    rules.push("- Jangan memakai pengetahuan internal model sebagai sumber fakta yang berdiri sendiri.");
  }

  if (useWeb) {
    rules.push("- Gunakan web search provider untuk informasi publik yang relevan.");
    rules.push("- Jangan mengarang sumber atau URL.");
  } else {
    rules.push("- Jangan browsing internet.");
  }

  if (useDatabase && !useAi && !useWeb) {
    rules.push('- Jawab hanya dari Database. Jika tidak cukup, jawab persis: "Materi ini belum tersedia di database."');
  }

  if (useDatabase && useAi) {
    rules.push('- Bila fakta penting berasal dari pengetahuan internal model, tandai sebagai "Pengetahuan AI" bila perlu.');
  }

  if (artifactFormat) {
    rules.push(artifactPromptInstruction(artifactFormat));
  }

  rules.push(
    citationInstruction(citationStyle, citationOutputs),
    aiModeInstruction(aiMode),
    "- Jawab dengan jelas dan terstruktur.",
    WHATSAPP_FORMAT_INSTRUCTION
  );

  return sections.concat([""], rules).flat().join("\n");
}


/**
 * Extraction-only Database lookup. Runs without an LLM or provider API call.
 * The SQL RPC has already searched every eligible descendant folder, indexed
 * individual OCR/page chunks, and ranked by body content rather than filename.
 */
function expandPharmacyQuery(question: string) {
  // "PCT" is contextual: in a paracetamol monograph query, expand it to
  // medicine synonyms before FTS; do not assume it always means paracetamol.
  if (!/\bpct\b/i.test(question) ||
      !/\b(monografi|monograph|parasetamol|paracetamol|acetaminophen|analgesik|obat)\b/i.test(question)) {
    return question;
  }
  return question.replace(/\bpct\b/gi, "paracetamol parasetamol acetaminophen");
}

function databaseLookupTerms(question: string) {
  const ignored = new Set([
    "yang","dan","atau","dari","untuk","dengan","tentang","secara","detail",
    "tolong","saya","aku","mau","ingin","cari","carikan","temukan","lokasi",
    "dimana","mana","di","dalam","file","folder","database","sumber","materi",
    "monografi","monograph","halaman","berapa","page","find","locate","show",
    "the","and","for","with","from","about","please","me",
  ]);
  const words = (question.toLowerCase().match(/[a-z0-9À-ÿ]{3,}/gi) || [])
    .filter((word) => !ignored.has(word));
  const synonym: Record<string, string[]> = {
    pct: ["paracetamol","parasetamol","acetaminophen","acetaminofen"],
    paracetamol: ["parasetamol","acetaminophen","acetaminofen"],
    parasetamol: ["paracetamol","acetaminophen","acetaminofen"],
    acetaminophen: ["paracetamol","parasetamol"],
    acetaminofen: ["paracetamol","parasetamol"],
  };
  return Array.from(new Set(words.flatMap((word) => [word, ...(synonym[word] || [])])));
}

function formatDatabaseLookup(question: string, rows: any[]) {
  const terms = databaseLookupTerms(question);
  const grouped = new Map<string, any[]>();
  for (const row of rows) {
    const key = String(row.bibliographic_work_id || row.source_file_id || row.id);
    const group = grouped.get(key) || [];
    const repeatedPage = group.some((item) =>
      item.source_page_start === row.source_page_start &&
      String(item.raw_content || item.content || "").slice(0, 180) ===
      String(row.raw_content || row.content || "").slice(0, 180)
    );
    if (!repeatedPage && group.length < 3) group.push(row);
    grouped.set(key, group);
  }
  const parts = [
    "Ditemukan " + rows.length + " bagian isi dari " + grouped.size +
    " karya/referensi relevan di Database dan subfolder terpilih. " +
    "Bagian atau salinan PDF dari buku yang sama digabung menurut judul dan edisi; tiap halaman tetap memiliki lokasi tersendiri (pencarian ini tidak memakai kredit Gemini/GPT)."
  ];
  for (const group of Array.from(grouped.values()).slice(0, 24)) {
    const first = group[0];
    if (!first) continue;
    parts.push("**" + (first.bibliographic_work_title || first.title) + "**");
    for (const row of group) {
      const raw = String(row.raw_content || row.content || "").replace(/\s+/g, " ").trim();
      const lowered = raw.toLowerCase();
      let at = -1;
      for (const word of terms) {
        const index = lowered.indexOf(word);
        if (index >= 0 && (at < 0 || index < at)) at = index;
      }
      const startAt = Math.max(0, (at >= 0 ? at : 0) - 135);
      const snippet = raw.slice(startAt, Math.min(raw.length, startAt + 380)).trim();
      const pageLabel = row.source_page_start
        ? "Halaman PDF " + row.source_page_start +
          (row.source_page_end && row.source_page_end !== row.source_page_start
            ? "–" + row.source_page_end : "")
        : "Bagian isi";
      parts.push("- " + pageLabel +
        (snippet ? " — " + (startAt ? "…" : "") + snippet +
          (startAt + 380 < raw.length ? "…" : "") : ""));
    }
  }
  parts.push("Nomor halaman PDF bisa berbeda dari halaman cetak. Edisi berbeda tetap dianggap referensi berbeda; jangan membuat entri daftar pustaka baru hanya karena sumber sama berada di file/halaman berbeda.");
  return parts.join("\n\n");
}

export async function POST(req: NextRequest) {
  try {
    const token = bearer(req);
    if (!token) return NextResponse.json({ error: "Belum login." }, { status: 401 });

    const body = await req.json();
    const question = body.question;
    const scopeNodeId = body.scopeNodeId ?? null;
    const sourceNodeIds = Array.isArray(body.sourceNodeIds)
      ? body.sourceNodeIds.map((value: unknown) => String(value || "")).filter(Boolean).slice(0, 24)
      : [];
    const sourceFileIds = Array.isArray(body.sourceFileIds)
      ? body.sourceFileIds.map((value: unknown) => String(value || "")).filter(Boolean).slice(0, 40)
      : [];
    const hasExplicitDatabaseSources = sourceNodeIds.length > 0 || sourceFileIds.length > 0;
    const aiMode = normalizeAiMode(body.aiMode ?? "instant");
    const aiSelection = selectionFromHeaders(req.headers, "chat", aiMode);
    const selectedProvider = modelProvider(aiSelection.model);
    const selectedProviderModel = providerModelId(aiSelection.model);
    const geminiAuth = geminiUserAuthFromHeaders(req.headers);
    const openAIKey = String(req.headers.get("x-rb-openai-key") || "").trim();
    const anthropicKey = String(req.headers.get("x-rb-anthropic-key") || "").trim();
    const selectedSources = normalizeSources(body);
    const attachmentTitle = String(body.attachmentTitle || "").trim().slice(0, 240);
    const attachmentRaw = String(body.attachmentRaw || "").trim().slice(0, 60000);
    const attachmentUrl = String(body.attachmentUrl || "").trim();
    const { citationStyle, citationOutputs } = normalizeCitationOptions(body);
    const artifactFormat = detectArtifactFormat(String(question || ""));

    if (!question || typeof question !== "string" || question.trim().length < 3) {
      return NextResponse.json({ error: "Pertanyaan terlalu pendek." }, { status: 400 });
    }
    if (!selectedSources.length) {
      return NextResponse.json({ error: "Pilih minimal satu sumber: AI, Database, atau Web." }, { status: 400 });
    }

    const useAi = selectedSources.includes("ai");
    const useDatabase = selectedSources.includes("database");
    const useWeb = selectedSources.includes("web");

    if (selectedProvider === "local" && (useAi || useWeb)) {
      return NextResponse.json(
        { error: "Local hanya dapat memakai Database. Pilih model AI untuk sumber AI atau Web." },
        { status: 400 }
      );
    }
    if (selectedProvider === "openai" && !openAIKey) {
      return NextResponse.json({ error: "Plugin OpenAI belum terhubung." }, { status: 400 });
    }
    if (selectedProvider === "anthropic" && !anthropicKey) {
      return NextResponse.json({ error: "Plugin Claude belum terhubung." }, { status: 400 });
    }

    const supabase = createServerSupabase(token);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return NextResponse.json({ error: "Sesi tidak valid." }, { status: 401 });
    }

    // Cheap database retrieval runs BEFORE the LLM. Search broadly across the selected
    // folder and every descendant, then send only the strongest content/page chunks.
    const databaseSearchQuery = expandPharmacyQuery(question.trim());
    const searchLimit = 80; // Gather a broad candidate pool before source-level reranking.
    const contextSourceLimit = aiMode === "high" ? 48 : aiMode === "medium" ? 40 : 32;
    const fallbackLimit = aiMode === "high" ? 80 : aiMode === "medium" ? 60 : 40;
    let data: any[] = [];
    let semanticStatus = "not-requested";
    let semanticModel: string | null = null;
    let databaseWarning: string | null = null;
    const casualAiQuestion =
      useAi && !hasExplicitDatabaseSources && !attachmentRaw && !attachmentUrl &&
      !body.attachmentPath &&
      /^(?:hai|halo|hi|hello|assalamualaikum|assalamu'alaikum|pagi|siang|malam|apa kabar|terima kasih|makasih|test|tes|ping|halo gpt|hello gpt)[.!? ]*$/i.test(question.trim());

    if (useDatabase && !casualAiQuestion) {
      try {
      const lexical = hasExplicitDatabaseSources
        ? await searchSelectedKnowledge(
            supabase,
            databaseSearchQuery,
            sourceNodeIds,
            sourceFileIds,
            searchLimit
          )
        : await searchScopeKnowledge(supabase, databaseSearchQuery, scopeNodeId, searchLimit);

      // Independent embedding worker: no Gemini call or Gemini credits here.
      // Folder and file filters are rechecked by RLS-protected database SQL.
      const semantic = await searchSemanticKnowledge(
        supabase, databaseSearchQuery, scopeNodeId,
        sourceNodeIds, sourceFileIds, hasExplicitDatabaseSources, searchLimit
      );
      semanticStatus = semantic.status;
      semanticModel = semantic.model;
      data = fuseHybridKnowledge(lexical, semantic.rows, 120, question.trim(), semantic.model || "");

      const broadDatabaseQuestion =
        /\b(ringkas|rangkum|overview|gambaran|jelaskan materi|apa isi|pelajari semua|seluruh materi)\b/i.test(
          question.trim()
        );
      if (!data.length && broadDatabaseQuestion) {
        data = hasExplicitDatabaseSources
          ? await getSelectedKnowledge(
              supabase,
              sourceNodeIds,
              sourceFileIds,
              fallbackLimit
            )
          : await getScopeKnowledge(supabase, scopeNodeId, fallbackLimit);
      }
      // First identify the *published work* (edition/year), not just the PDF.
      // Multiple file chunks/copies of one edition become one bibliography unit.
      data = await annotateBibliographicWorks(supabase, data);
      // First relevant excerpt from each bibliographic work, then further pages.
      data = diversifyKnowledgeSources(
        prioritizeQuestionRelevantSources(data, question.trim()),
        contextSourceLimit, 3
      );
      } catch (databaseError: any) {
        // Retrieval timeouts (e.g. Postgres 57014 on large OCR books) must not
        // stop an otherwise valid AI-only conversational answer.
        console.warn("[DATABASE_RETRIEVAL_UNAVAILABLE]", {
          code: String(databaseError?.code || "unknown").slice(0, 30),
          reason: "Search failed; no database content was cited"
        });
        data = [];
        semanticStatus = "fallback";
        databaseWarning =
          "Pencarian materi pribadi sedang gagal sementara; jawaban berikut tidak didasarkan pada Database. " +
          "Jika butuh sitasi dokumen, coba lagi setelah indeks materi siap.";
        if (!useAi && !useWeb) {
          return NextResponse.json({ error: databaseWarning }, { status: 503 });
        }
      }
    }

    const semanticNotice = useDatabase && !databaseWarning && !casualAiQuestion
      ? semanticStatus === "index-pending"
        ? "Indeks embedding masih kosong. Jawaban/pencarian saat ini memakai isi teks RAW/OCR; model Hugging Face belum membantu pemeringkatan."
        : semanticStatus === "fallback"
          ? "Pencarian embedding sementara tidak tersedia; pencarian isi teks tetap dipakai."
          : undefined
      : undefined;

    const lookupOnly =
      useDatabase &&
      !useWeb &&
      /\b(carikan|cari|temukan|lokasi|dimana|di mana|halaman berapa|find|locate|search for|show me)\b/i.test(question) &&
      !/\b(jelaskan|ringkas|rangkum|uraikan|analisis|bandingkan|hitung|buat|tuliskan|explain|summarize|compare|analyze)\b/i.test(question) &&
      !attachmentRaw &&
      !attachmentUrl &&
      !body.attachmentPath;

    if (lookupOnly && databaseWarning) {
      return NextResponse.json({ error: databaseWarning }, { status: 503 });
    }

    if (lookupOnly) {
      return NextResponse.json({
        answer: data.length
          ? formatDatabaseLookup(question, data)
          : "Tidak ditemukan kecocokan dalam isi materi yang sudah berhasil diindeks pada folder dan subfolder terpilih. Periksa apakah OCR/RAW seluruh halaman berstatus siap.",
        sources: Array.from(new Map(data.map((row) => [
          String(row.bibliographic_work_id || row.source_file_id || row.id),
          {
            id: row.id,
            node_id: row.node_id,
            title: row.bibliographic_work_title || row.title,
            category: row.category,
            source_file_id: row.source_file_id || null,
            bibliographic_work_id: row.bibliographic_work_id || null,
            page_start: row.source_page_start || null,
            page_end: row.source_page_end || null,
          }
        ])).values()),
        webSources: [],
        grounded: true,
        publicWeb: false,
        selectedSources,
        model: "Pencarian Database · tanpa Gemini",
        provider: "database-index",
        semanticStatus,
        semanticModel,
        warning: semanticNotice,
      });
    }

    const currentRawAssets = await loadCurrentRawAttachment(supabase, userData.user.id, body);
    const databaseRawAssets = useDatabase && !databaseWarning && !casualAiQuestion
      ? data.length
        ? []
        : sourceFileIds.length
        ? await loadExplicitRawFiles(supabase, userData.user.id, sourceFileIds)
        : sourceNodeIds.length === 1
          ? await loadDatabaseRawAssets(
              supabase,
              data,
              userData.user.id,
              sourceNodeIds[0],
              question.trim()
            )
          : sourceNodeIds.length > 1
            ? []
            : await loadDatabaseRawAssets(
                supabase,
                data,
                userData.user.id,
                scopeNodeId,
                question.trim()
              )
      : [];

    let rawBinaryBudget = 18 * 1024 * 1024;
    const rawAssets: RawAsset[] = [];
    for (const asset of [...currentRawAssets, ...databaseRawAssets]) {
      if (rawAssets.length >= 5) break;
      if (asset.data) {
        const approximateBytes = Math.floor(asset.data.length * 0.75);
        if (approximateBytes > rawBinaryBudget) {
          if (asset.rawText) rawAssets.push({ ...asset, data: undefined });
          continue;
        }
        rawBinaryBudget -= approximateBytes;
      }
      rawAssets.push(asset);
    }
    const directRawText = rawAssetText(rawAssets);

    if (
      useDatabase &&
      !data.length &&
      !rawAssets.length &&
      !useAi &&
      !useWeb
    ) {
      return NextResponse.json({
        answer: "Materi ini belum tersedia di database.",
        sources: [],
        webSources: [],
        grounded: true,
        publicWeb: false,
        selectedSources,
        model: "Local Database",
      });
    }

    // 1.5× context budget to match the broader retrieval pass.
    // Spend context tokens in proportion to the requested answer, not a fixed
    // 33–63k characters for every query. Keep multi-work coverage first.
    const contextLimit = aiSelection.length === "short"
      ? (aiMode === "high" ? 22000 : 17000)
      : aiSelection.length === "long"
        ? (aiMode === "high" ? 63000 : aiMode === "medium" ? 48000 : 35000)
        : (aiMode === "high" ? 44000 : aiMode === "medium" ? 34000 : 25000);
    const context = data.length
      ? buildKnowledgeContext(data, contextLimit, question.trim())
      : databaseWarning
        ? "(Pencarian Database gagal sementara. Jangan mengutip atau mengarang sumber pribadi.)"
        : casualAiQuestion
          ? "(Pertanyaan percakapan umum; Database tidak perlu dicari.)"
          : "(Database pribadi kosong atau tidak dipilih.)";

    // The UI bibliography/source panel has one entry per published work,
    // while the LLM context preserves independent page locators.
    const sourceByWork = new Map<string, any>();
    if (useDatabase && !databaseWarning && !casualAiQuestion) {
      for (const m of data) {
        const key = String(m.bibliographic_work_id || m.source_file_id || m.id);
        const pageStart = Number(m.source_page_start) || null;
        const pageEnd = Number(m.source_page_end) || pageStart;
        const existing = sourceByWork.get(key);
        if (existing) {
          if (pageStart) {
            const range = pageEnd && pageEnd !== pageStart
              ? pageStart + "–" + pageEnd : String(pageStart);
            if (!existing.page_ranges.includes(range)) existing.page_ranges.push(range);
          }
          continue;
        }
        sourceByWork.set(key, {
          id: m.id,
          node_id: m.node_id,
          title: m.bibliographic_work_title || m.title,
          category: m.category,
          source_file_id: m.source_file_id || null,
          bibliographic_work_id: key,
          edition: m.bibliographic_edition || null,
          year: m.bibliographic_year || null,
          page_start: pageStart,
          page_end: pageEnd,
          page_ranges: pageStart ? [
            pageEnd && pageEnd !== pageStart ? pageStart + "–" + pageEnd : String(pageStart)
          ] : []
        });
      }
    }
    const databaseSources = Array.from(sourceByWork.values());

    const prompt = buildPrompt({
      question,
      context,
      useAi,
      useDatabase: useDatabase && !databaseWarning && !casualAiQuestion,
      useWeb,
      aiMode,
      attachmentTitle: attachmentTitle || (attachmentUrl ? "Link lampiran" : ""),
      attachmentRaw: [attachmentRaw, directRawText].filter(Boolean).join("\n\n---\n\n"),
      citationStyle,
      citationOutputs,
      artifactFormat,
    }) + (/\b(eksipien|excipients?)\b/i.test(question.trim()) && data.length
      ? "\n\nPRIORITAS RELEVANSI: Untuk fungsi atau pemilihan eksipien tablet, gunakan monografi eksipien yang benar-benar cocok dari Handbook of Pharmaceutical Excipients atau referensi eksipien lain. Farmakope dipakai untuk fakta zat aktif/spesifikasi yang relevan, bukan sebagai satu-satunya sumber eksipien. Eksipien yang tidak menyebut PCT tetap bisa relevan sebagai bahan tambahan, tetapi jangan mengklaim formula tablet PCT sudah terbukti tanpa sumber formulasi. Sitasi hanya halaman yang memuat fakta terkait."
      : "");

    const sharedGemini = selectedProvider === "gemini" && !geminiAuth.ownGemini;
    const action = useWeb ? "ask_web" : "ask";
    const initialPreflight = sharedGemini ? await checkAiCredits(supabase, action, aiMode) : null;

    if (initialPreflight && !initialPreflight.allowed && !useWeb) {
      return NextResponse.json(aiQuotaError(initialPreflight), { status: 429 });
    }

    async function generateSelected(targetPrompt: string, withWeb: boolean) {
      if (selectedProvider === "openai") {
        return openaiGenerateDetailed({
          apiKey: openAIKey,
          model: selectedProviderModel,
          prompt: targetPrompt,
          system: "Anda adalah tutor Ruang Belajar. Hormati persis kombinasi sumber yang dipilih user.",
          effort: casualAiQuestion && aiSelection.effort !== "none" ? "low" : aiSelection.effort,
          responseLength: aiSelection.length,
          maxOutputTokens: casualAiQuestion ? 512 : undefined,
          web: withWeb,
          attachments: externalRawAttachments(rawAssets),
        });
      }

      if (selectedProvider === "anthropic") {
        return anthropicGenerateDetailed({
          apiKey: anthropicKey,
          model: selectedProviderModel,
          prompt: targetPrompt,
          system: "Anda adalah tutor Ruang Belajar. Hormati persis kombinasi sumber yang dipilih user.",
          effort: aiSelection.effort,
          responseLength: aiSelection.length,
          web: withWeb,
          attachments: externalRawAttachments(rawAssets),
        });
      }

      return geminiGenerateDetailed(
        geminiRawParts(targetPrompt, rawAssets),
        "Anda adalah tutor Ruang Belajar. Hormati persis kombinasi sumber yang dipilih user.",
        {
          googleSearch: withWeb,
          models: modelPlanForSelection(
            aiSelection.model,
            aiMode,
            withWeb ? "web" : "standard"
          ),
          effort: aiSelection.effort,
          responseLength: aiSelection.length,
          apiKey: geminiAuth.apiKey,
          accessToken: geminiAuth.accessToken,
          projectId: geminiAuth.projectId,
        }
      );
    }

    function selectedUsageProvider() {
      if (selectedProvider === "openai") return "user-openai-api-key" as const;
      if (selectedProvider === "anthropic") return "user-anthropic-api-key" as const;
      return geminiAuth.provider;
    }

    async function tryOwnGeminiWeb() {
      if (!geminiAuth.ownGemini) return null;
      try {
        const result = await geminiGenerateDetailed(
          geminiRawParts(prompt, rawAssets),
          "Anda adalah tutor Ruang Belajar. Jawab menggunakan Web sesuai sumber yang dipilih user.",
          {
            googleSearch: true,
            models: modelPlanForSelection("gemini-2.5-flash", aiMode, "web"),
            effort: "none",
            responseLength: aiSelection.length,
            apiKey: geminiAuth.apiKey,
            accessToken: geminiAuth.accessToken,
            projectId: geminiAuth.projectId,
          }
        );
        await recordAiTokenUsage(supabase, result.usage, result.model, geminiAuth.provider);
        return {
          result,
          provider: geminiAuth.provider,
          warning: "Web memakai Gemini milik user sebagai fallback pencarian.",
          aiUsage: null,
        };
      } catch {
        return null;
      }
    }

    async function tryOpenAIWeb() {
      if (!openAIKey) return null;
      const preferred = selectedProvider === "openai" ? selectedProviderModel : "";
      const models = await openAIWebModelCandidates(openAIKey, preferred);
      for (const model of models) {
        if (selectedProvider === "openai" && model === selectedProviderModel) continue;
        try {
          const result = await openaiGenerateDetailed({
            apiKey: openAIKey,
            model,
            prompt,
            system: "Anda adalah tutor Ruang Belajar. Gunakan Web sebagai sumber publik dan hormati sumber lain yang dipilih user.",
            effort: "none",
            responseLength: aiSelection.length,
            web: true,
            attachments: externalRawAttachments(rawAssets),
          });
          await recordAiTokenUsage(
            supabase,
            result.usage,
            result.model,
            "user-openai-api-key"
          );
          return {
            result,
            provider: "user-openai-api-key" as const,
            warning: "Web dialihkan ke OpenAI milik user karena provider/model awal tidak dapat melakukan pencarian.",
            aiUsage: null,
          };
        } catch {
          continue;
        }
      }
      return null;
    }

    async function tryAnthropicWeb() {
      if (!anthropicKey) return null;
      const preferred = selectedProvider === "anthropic" ? selectedProviderModel : "";
      const models = await anthropicWebModelCandidates(anthropicKey, preferred);
      for (const model of models) {
        if (selectedProvider === "anthropic" && model === selectedProviderModel) continue;
        try {
          const result = await anthropicGenerateDetailed({
            apiKey: anthropicKey,
            model,
            prompt,
            system: "Anda adalah tutor Ruang Belajar. Gunakan Web sebagai sumber publik dan hormati sumber lain yang dipilih user.",
            effort: "none",
            responseLength: aiSelection.length,
            web: true,
            attachments: externalRawAttachments(rawAssets),
          });
          await recordAiTokenUsage(
            supabase,
            result.usage,
            result.model,
            "user-anthropic-api-key"
          );
          return {
            result,
            provider: "user-anthropic-api-key" as const,
            warning: "Web dialihkan ke Claude milik user karena provider/model awal tidak dapat melakukan pencarian.",
            aiUsage: null,
          };
        } catch {
          continue;
        }
      }
      return null;
    }

    async function trySharedGeminiWeb() {
      const sharedKey = String(process.env.GEMINI_API_KEY || "").trim();
      if (!sharedKey) return null;

      const preflight = await checkAiCredits(supabase, "ask_web", aiMode);
      if (!preflight.allowed) return null;

      try {
        const result = await geminiGenerateDetailed(
          geminiRawParts(prompt, rawAssets),
          "Anda adalah tutor Ruang Belajar. Jawab menggunakan Web sesuai sumber yang dipilih user.",
          {
            googleSearch: true,
            models: modelPlanForSelection("gemini-2.5-flash", aiMode, "web"),
            effort: "none",
            responseLength: aiSelection.length,
            apiKey: sharedKey,
          }
        );
        await recordAiTokenUsage(
          supabase,
          result.usage,
          result.model,
          "shared-api-key"
        );
        const aiUsage = await finalizeAiCredits(supabase, "ask_web", aiMode);
        return {
          result,
          provider: "shared-api-key" as const,
          warning: "Web memakai provider bersama sebagai fallback pencarian.",
          aiUsage,
        };
      } catch {
        return null;
      }
    }

    async function alternateWebResult() {
      const attempts = [
        ...(selectedProvider === "gemini" ? [] : [tryOwnGeminiWeb]),
        ...(selectedProvider === "openai" ? [] : [tryOpenAIWeb]),
        ...(selectedProvider === "anthropic" ? [] : [tryAnthropicWeb]),
        trySharedGeminiWeb,
        ...(selectedProvider === "openai" ? [tryOpenAIWeb] : []),
        ...(selectedProvider === "anthropic" ? [tryAnthropicWeb] : []),
      ];

      for (const attempt of attempts) {
        const fallback = await attempt();
        if (fallback) return fallback;
      }
      return null;
    }

    try {
      if (initialPreflight && !initialPreflight.allowed && sharedGemini && useWeb) {
        throw Object.assign(new Error("Shared Web quota unavailable."), {
          statusCode: 429,
          code: "WEB_SEARCH_QUOTA",
        });
      }

      const result = await generateSelected(prompt, useWeb);
      await recordAiTokenUsage(supabase, result.usage, result.model, selectedUsageProvider());
      const aiUsage =
        sharedGemini && (!initialPreflight || initialPreflight.allowed)
          ? await finalizeAiCredits(supabase, action, aiMode)
          : null;

      return NextResponse.json({
        answer: result.text,
        citationWarnings: citationStructuralWarnings(result.text, citationStyle, citationOutputs),
        sources: databaseSources,
        warning: [databaseWarning, semanticNotice].filter(Boolean).join(" · ") || undefined,
        semanticStatus,
        semanticModel,
        webSources: result.webSources,
        grounded: !useAi,
        publicWeb: useWeb,
        selectedSources,
        webFallback: false,
        model: result.model,
        aiUsage,
        provider: selectedUsageProvider(),
        artifactFormat,
      });
    } catch (error: any) {
      const fallbackSources = selectedSources.filter((source) => source !== "web");
      const webSpecificFailure = useWeb && isWebProviderFailure(error);

      if (!webSpecificFailure) throw error;

      const alternate = await alternateWebResult();
      if (alternate) {
        return NextResponse.json({
          answer: alternate.result.text,
          citationWarnings: citationStructuralWarnings(alternate.result.text, citationStyle, citationOutputs),
          sources: databaseSources,
          webSources: alternate.result.webSources,
          grounded: !useAi,
          publicWeb: true,
          selectedSources,
          webFallback: true,
          warning: alternate.warning,
          model: alternate.result.model,
          aiUsage: alternate.aiUsage,
          provider: alternate.provider,
          artifactFormat,
        });
      }

      if (!fallbackSources.length) {
        return NextResponse.json(
          {
            error:
              "Web belum tersedia pada provider yang terhubung saat ini. Hubungkan Gemini/OpenAI/Claude yang memiliki akses Web, atau aktifkan AI/Database sebagai fallback.",
            webSearchUnavailable: true,
          },
          { status: 503 }
        );
      }

      const fallbackPrompt = buildPrompt({
        question,
        context,
        useAi: fallbackSources.includes("ai"),
        useDatabase: fallbackSources.includes("database"),
        useWeb: false,
        aiMode,
        citationStyle,
        citationOutputs,
        artifactFormat,
      });

      const fallbackResult = await generateSelected(fallbackPrompt, false);
      await recordAiTokenUsage(
        supabase,
        fallbackResult.usage,
        fallbackResult.model,
        selectedUsageProvider()
      );
      const aiUsage =
        sharedGemini && (!initialPreflight || initialPreflight.allowed)
          ? await finalizeAiCredits(supabase, "ask", aiMode)
          : null;

      return NextResponse.json({
        answer: fallbackResult.text,
        citationWarnings: citationStructuralWarnings(fallbackResult.text, citationStyle, citationOutputs),
        sources: fallbackSources.includes("database") ? databaseSources : [],
        webSources: [],
        grounded: !fallbackSources.includes("ai"),
        publicWeb: false,
        selectedSources: fallbackSources,
        webFallback: true,
        warning:
          "Semua provider Web yang terhubung sedang tidak tersedia. Sistem melanjutkan hanya dengan sumber non-Web yang sudah dipilih.",
        model: fallbackResult.model,
        aiUsage,
        provider: selectedUsageProvider(),
        artifactFormat,
      });
    }
  } catch (error: any) {
    const status = Number(error?.statusCode || 500);
    console.error("[API_ASK_ERROR]", { name: error?.name, code: error?.code, status });
    return NextResponse.json(
      { error: error?.message || "Gagal menjawab." },
      { status: status >= 400 && status < 600 ? status : 500 }
    );
  }
}

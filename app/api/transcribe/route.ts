import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { cleanJsonText, geminiGenerateDetailed, WHATSAPP_FORMAT_INSTRUCTION } from "@/lib/gemini";
import { buildKnowledgeContext, getScopeKnowledge } from "@/lib/knowledge";
import { modelPlanForSelection, selectionFromHeaders } from "@/lib/aiModels";
import { geminiUserAuthFromHeaders } from "@/lib/geminiUserAuth";
import {
  aiModeInstruction,
  aiQuotaError,
  checkAiCredits,
  finalizeAiCredits,
  normalizeAiMode,
  recordAiTokenUsage,
} from "@/lib/aiQuota";

function bearer(req: NextRequest) {
  const h = req.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

function normalizeMime(value: string) {
  const mime = (value || "audio/webm").split(";")[0].trim().toLowerCase();
  if (mime === "audio/mp4") return "audio/m4a";
  return mime || "audio/webm";
}

export const runtime = "nodejs";
export const maxDuration = 300;

type GeminiAuth = ReturnType<typeof geminiUserAuthFromHeaders>;

const AUDIO_MODEL_PRIORITY = [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.5-pro",
];

// Base64 expands bytes by ~33%. Keep enough headroom below the legacy
// generateContent 20 MB inline request limit.
const INLINE_AUDIO_MAX_BYTES = 12 * 1024 * 1024;

function geminiAuthHeaders(auth: GeminiAuth): Record<string, string> {
  const key = auth.apiKey || (!auth.accessToken ? process.env.GEMINI_API_KEY : undefined);
  if (auth.accessToken) {
    return {
      "Content-Type": "application/json",
      Authorization: "Bearer " + auth.accessToken,
      "x-goog-user-project": auth.projectId || "",
    };
  }
  if (!key) throw Object.assign(new Error("Gemini belum dikonfigurasi."), { statusCode: 500 });
  return {
    "Content-Type": "application/json",
    "x-goog-api-key": key,
  };
}

function usageFromProvider(data: any) {
  const usage = data?.usageMetadata || {};
  const inputTokens = Number(usage.promptTokenCount || 0);
  const outputTokens = Number(usage.candidatesTokenCount || usage.responseTokenCount || 0);
  const thoughtsTokens = Number(usage.thoughtsTokenCount || 0);
  const totalTokens = Number(usage.totalTokenCount || inputTokens + outputTokens + thoughtsTokens);
  return { inputTokens, outputTokens, thoughtsTokens, totalTokens };
}

function textFromGenerateContent(data: any) {
  return (Array.isArray(data?.candidates) ? data.candidates : [])
    .flatMap((candidate: any) =>
      Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []
    )
    .map((part: any) => String(part?.text || ""))
    .join("")
    .trim();
}

async function listGenerateModels(auth: GeminiAuth) {
  try {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
      {
        headers: geminiAuthHeaders(auth),
        cache: "no-store",
      }
    );
    if (!response.ok) return [] as string[];
    const data = await response.json().catch(() => ({}));
    return (Array.isArray(data?.models) ? data.models : [])
      .filter((model: any) => {
        const methods = Array.isArray(model?.supportedGenerationMethods)
          ? model.supportedGenerationMethods.map(String)
          : [];
        return methods.includes("generateContent");
      })
      .map((model: any) => String(model?.name || "").replace(/^models\//, "").trim())
      .filter(Boolean);
  } catch {
    return [] as string[];
  }
}

function audioModelsForProvider(available: string[]) {
  if (!available.length) return AUDIO_MODEL_PRIORITY;

  const availableSet = new Set(available);
  const preferred = AUDIO_MODEL_PRIORITY.filter((model) => availableSet.has(model));
  const otherLikelyMultimodal = available.filter(
    (model) =>
      /^gemini-/i.test(model) &&
      !/live|tts|image|embedding|robotics|omni|transcribe/i.test(model) &&
      !preferred.includes(model)
  );
  return Array.from(new Set([...preferred, ...otherLikelyMultimodal]));
}

function transcriptionPrompt() {
  return (
    "Transkripsikan audio berikut secara VERBATIM dalam bahasa yang terdengar. " +
    "Pertahankan kata yang diucapkan sedekat mungkin kata demi kata. " +
    "Jangan merangkum, jangan menambah fakta, dan jangan mengoreksi istilah berdasarkan tebakan. " +
    "Rapikan tanda baca serta pergantian paragraf secukupnya. " +
    "Keluarkan HANYA transkrip, tanpa pembukaan atau penjelasan."
  );
}

async function rawGenerateInline(
  model: string,
  bytes: Buffer,
  mimeType: string,
  auth: GeminiAuth
) {
  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/" +
      encodeURIComponent(model) +
      ":generateContent",
    {
      method: "POST",
      headers: geminiAuthHeaders(auth),
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: transcriptionPrompt() },
              {
                inlineData: {
                  mimeType,
                  data: bytes.toString("base64"),
                },
              },
            ],
          },
        ],
      }),
    }
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = String(data?.error?.message || "");
    throw Object.assign(
      new Error(message || "Model Gemini gagal mentranskripsikan audio inline."),
      { statusCode: response.status, providerMessage: message }
    );
  }

  const text = textFromGenerateContent(data);
  if (!text) {
    throw Object.assign(new Error("Model Gemini tidak mengembalikan transkrip audio."), {
      statusCode: 502,
    });
  }

  return { text, usage: usageFromProvider(data), model };
}

async function uploadGeminiAudio(bytes: Buffer, mimeType: string, auth: GeminiAuth) {
  const headers = geminiAuthHeaders(auth);
  const start = await fetch("https://generativelanguage.googleapis.com/upload/v1beta/files", {
    method: "POST",
    headers: {
      ...headers,
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(bytes.byteLength),
      "X-Goog-Upload-Header-Content-Type": mimeType,
    },
    body: JSON.stringify({ file: { display_name: "ruang-belajar-recording" } }),
  });

  if (!start.ok) {
    const data = await start.json().catch(() => ({}));
    const message = String(data?.error?.message || "");
    throw Object.assign(
      new Error(message || "Gemini Files API gagal menyiapkan upload audio."),
      { statusCode: start.status, providerMessage: message }
    );
  }

  const uploadUrl = start.headers.get("x-goog-upload-url");
  if (!uploadUrl) {
    throw Object.assign(new Error("Gemini Files API tidak mengembalikan upload URL."), {
      statusCode: 502,
    });
  }

  const upload = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(bytes.byteLength),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
      "Content-Type": mimeType,
    },
    body: new Uint8Array(bytes),
  });

  const info = await upload.json().catch(() => ({}));
  if (!upload.ok || !info?.file?.uri) {
    const message = String(info?.error?.message || "");
    throw Object.assign(
      new Error(message || "Gemini Files API gagal mengupload audio."),
      { statusCode: upload.status || 502, providerMessage: message }
    );
  }

  return String(info.file.uri);
}

async function rawGenerateWithFile(
  model: string,
  fileUri: string,
  mimeType: string,
  auth: GeminiAuth
) {
  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/" +
      encodeURIComponent(model) +
      ":generateContent",
    {
      method: "POST",
      headers: geminiAuthHeaders(auth),
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: transcriptionPrompt() },
              { fileData: { fileUri, mimeType } },
            ],
          },
        ],
      }),
    }
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = String(data?.error?.message || "");
    throw Object.assign(
      new Error(message || "Model Gemini gagal mentranskripsikan file audio."),
      { statusCode: response.status, providerMessage: message }
    );
  }

  const text = textFromGenerateContent(data);
  if (!text) {
    throw Object.assign(new Error("Model Gemini tidak mengembalikan transkrip audio."), {
      statusCode: 502,
    });
  }

  return { text, usage: usageFromProvider(data), model };
}

async function transcribeGeminiAudio(
  bytes: Buffer,
  mimeType: string,
  auth: GeminiAuth
) {
  const available = await listGenerateModels(auth);
  const models = audioModelsForProvider(available);

  if (!models.length) {
    throw Object.assign(
      new Error("Provider Gemini ini belum memiliki model multimodal yang dapat memproses audio."),
      { statusCode: 503 }
    );
  }

  let fileUri = "";
  let lastError: any = null;

  for (const model of models) {
    try {
      if (bytes.byteLength <= INLINE_AUDIO_MAX_BYTES) {
        return await rawGenerateInline(model, bytes, mimeType, auth);
      }

      if (!fileUri) fileUri = await uploadGeminiAudio(bytes, mimeType, auth);
      return await rawGenerateWithFile(model, fileUri, mimeType, auth);
    } catch (error: any) {
      lastError = error;
      const status = Number(error?.statusCode || 500);
      const message = String(error?.providerMessage || error?.message || "");
      const tryAnotherModel =
        status === 400 ||
        status === 404 ||
        status === 429 ||
        status === 502 ||
        status === 503 ||
        status === 504 ||
        /not available|not found|unsupported|high demand|overloaded|quota|invalid argument|empty/i.test(
          message
        );

      // 401/403 is a credential/project problem. Let the caller try another provider.
      if (!tryAnotherModel) break;
    }
  }

  throw lastError || Object.assign(
    new Error("Provider Gemini belum berhasil memproses audio."),
    { statusCode: 503 }
  );
}

function sameGeminiAuth(a: GeminiAuth, b: GeminiAuth) {
  return (
    a.provider === b.provider &&
    String(a.apiKey || "") === String(b.apiKey || "") &&
    String(a.accessToken || "") === String(b.accessToken || "") &&
    String(a.projectId || "") === String(b.projectId || "")
  );
}

function uniqueAuthCandidates(items: GeminiAuth[]) {
  return items.filter(
    (item, index) => items.findIndex((other) => sameGeminiAuth(item, other)) === index
  );
}

export async function POST(req: NextRequest) {
  try {
    const token = bearer(req);
    if (!token) return NextResponse.json({ error: "Belum login." }, { status: 401 });

    const body = await req.json();
    const recordingId = String(body.recordingId || "");
    const filePath = String(body.filePath || "");
    const contextNodeId = body.contextNodeId ? String(body.contextNodeId) : null;
    const browserTranscript = String(body.browserTranscript || "").trim();
    const mimeType = normalizeMime(String(body.mimeType || "audio/webm"));
    const aiMode = normalizeAiMode(body.aiMode);
    const aiSelection = selectionFromHeaders(req.headers, "transcription", aiMode);
    const geminiAuth = geminiUserAuthFromHeaders(req.headers);

    if (aiMode === "simple") {
      return NextResponse.json(
        { error: "Local memakai transkrip browser dan tidak memanggil Gemini." },
        { status: 400 }
      );
    }

    if (!recordingId || !filePath) {
      return NextResponse.json({ error: "Data rekaman tidak lengkap." }, { status: 400 });
    }

    const supabase = createServerSupabase(token);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return NextResponse.json({ error: "Sesi tidak valid." }, { status: 401 });
    }

    const { data: recording, error: recError } = await supabase
      .from("recordings")
      .select("id,title,file_path")
      .eq("id", recordingId)
      .single();

    if (recError || !recording || recording.file_path !== filePath) {
      return NextResponse.json({ error: "Rekaman tidak ditemukan." }, { status: 404 });
    }

    const { data: blob, error: downloadError } = await supabase.storage
      .from("recordings")
      .download(filePath);

    if (downloadError || !blob) {
      throw downloadError || new Error("Audio tidak dapat dibaca.");
    }

    if (blob.size > 50 * 1024 * 1024) {
      return NextResponse.json({ error: "Rekaman maksimal 50 MB." }, { status: 413 });
    }

    const audioBytes = Buffer.from(await blob.arrayBuffer());
    const sharedKey = String(process.env.GEMINI_API_KEY || "").trim();
    const sharedAuth: GeminiAuth = {
      ownGemini: false,
      provider: "shared-api-key",
      ...(sharedKey ? { apiKey: sharedKey } : {}),
    };

    const authCandidates = uniqueAuthCandidates([
      ...(geminiAuth.ownGemini ? [geminiAuth] : []),
      ...(sharedKey || !geminiAuth.ownGemini ? [sharedAuth] : []),
    ]);

    let sharedChecked = false;
    let sharedAllowed = false;
    let usedShared = false;

    async function ensureSharedQuota() {
      if (sharedChecked) return sharedAllowed;
      sharedChecked = true;
      const preflight = await checkAiCredits(supabase, "transcription", aiMode);
      sharedAllowed = Boolean(preflight?.allowed);
      return sharedAllowed;
    }

    let rawTranscript = "";
    let transcriptionModel = "";
    let transcriptionProvider = "browser-live";
    let transcriptionWarning = "";
    let rawAuth: GeminiAuth | null = null;
    let lastAudioError: any = null;

    for (const auth of authCandidates) {
      if (auth.provider === "shared-api-key" && !(await ensureSharedQuota())) continue;

      try {
        const result = await transcribeGeminiAudio(audioBytes, mimeType, auth);
        rawTranscript = result.text;
        transcriptionModel = result.model;
        transcriptionProvider = auth.provider;
        rawAuth = auth;
        if (auth.provider === "shared-api-key") usedShared = true;
        await recordAiTokenUsage(supabase, result.usage, result.model, auth.provider);
        break;
      } catch (error: any) {
        lastAudioError = error;
        console.warn("[TRANSCRIBE_PROVIDER_FALLBACK]", {
          provider: auth.provider,
          status: Number(error?.statusCode || 500),
          message: String(error?.message || "").slice(0, 220),
        });
      }
    }

    if (!rawTranscript && browserTranscript) {
      rawTranscript = browserTranscript;
      transcriptionModel = "Browser live fallback";
      transcriptionProvider = "browser-live";
      transcriptionWarning =
        "Gemini audio belum berhasil pada provider yang tersedia; transkrip live browser dipakai sebagai bahan final.";
    }

    if (!rawTranscript) {
      const status = Number(lastAudioError?.statusCode || 503);
      if (sharedChecked && !sharedAllowed && !geminiAuth.ownGemini) {
        const preflight = await checkAiCredits(supabase, "transcription", aiMode);
        return NextResponse.json(aiQuotaError(preflight), { status: 429 });
      }
      throw Object.assign(
        new Error(
          "Audio tersimpan, tetapi provider Gemini yang tersedia belum dapat memproses audio ini. " +
            "Coba Transkrip ulang atau gunakan Local/browser transcription."
        ),
        { statusCode: status >= 400 && status < 600 ? status : 503 }
      );
    }

    const knowledge = await getScopeKnowledge(supabase, contextNodeId, 40);
    const context = buildKnowledgeContext(knowledge, 26000);
    const structuringPrompt =
      "TRANSKRIP VERBATIM:\n" +
      rawTranscript +
      "\n\nDATABASE REFERENSI:\n" +
      (context || "(tidak ada database yang relevan)") +
      "\n\nKeluarkan JSON valid tanpa markdown dengan bentuk:\n" +
      '{"structured_transcript":"...","summary":"...","corrections":[{"heard":"...","corrected":"...","basis":"..."}]}\n\n' +
      "Aturan:\n" +
      "1. structured_transcript harus menata ulang isi ucapan agar runtut tanpa mengubah makna.\n" +
      "2. Istilah hanya boleh dikoreksi bila DATABASE REFERENSI benar-benar mendukung koreksi itu.\n" +
      '3. Contoh: bila terdengar "CPOD" tetapi database pada konteks yang sama jelas memakai/menjelaskan "CPOB", versi tertata boleh menulis CPOB dan koreksinya dicatat.\n' +
      "4. Jangan mengubah transkrip verbatim.\n" +
      "5. Bila database kosong/tidak relevan, jangan menambah fakta luar; cukup tata dan rangkum berdasarkan rekaman.\n" +
      "6. basis harus singkat dan menyebut dasar dari database.\n" +
      "7. " +
      aiModeInstruction(aiMode) +
      "\n8. " +
      WHATSAPP_FORMAT_INSTRUCTION;

    let structuredTranscript = rawTranscript;
    let summary = "";
    let corrections: Array<{ heard: string; corrected: string; basis: string }> = [];
    let structuringModel = "";
    let structuringProvider = "";
    let structuringWarning = "";

    const structureCandidates = uniqueAuthCandidates([
      ...(geminiAuth.ownGemini ? [geminiAuth] : []),
      ...(rawAuth ? [rawAuth] : []),
      ...(sharedKey ? [sharedAuth] : []),
    ]);

    for (const auth of structureCandidates) {
      if (auth.provider === "shared-api-key" && !(await ensureSharedQuota())) continue;

      try {
        const result = await geminiGenerateDetailed(
          [{ text: structuringPrompt }],
          "Anda menyunting transkrip secara konservatif. Database yang diberikan adalah satu-satunya sumber untuk koreksi istilah faktual.",
          {
            models: modelPlanForSelection(aiSelection.model, aiMode, "standard"),
            effort: aiSelection.effort,
            apiKey: auth.apiKey,
            accessToken: auth.accessToken,
            projectId: auth.projectId,
          }
        );

        await recordAiTokenUsage(supabase, result.usage, result.model, auth.provider);
        if (auth.provider === "shared-api-key") usedShared = true;
        structuringModel = result.model;
        structuringProvider = auth.provider;

        try {
          const parsed = JSON.parse(cleanJsonText(result.text));
          structuredTranscript = String(parsed.structured_transcript || rawTranscript).trim();
          summary = String(parsed.summary || "").trim();
          corrections = Array.isArray(parsed.corrections)
            ? parsed.corrections
                .slice(0, 30)
                .map((x: any) => ({
                  heard: String(x.heard || ""),
                  corrected: String(x.corrected || ""),
                  basis: String(x.basis || ""),
                }))
                .filter((x: any) => x.heard && x.corrected)
            : [];
        } catch {
          structuredTranscript = result.text || rawTranscript;
        }
        break;
      } catch (error: any) {
        console.warn("[TRANSCRIPT_STRUCTURE_FALLBACK]", {
          provider: auth.provider,
          status: Number(error?.statusCode || 500),
          message: String(error?.message || "").slice(0, 220),
        });
      }
    }

    if (!structuringModel) {
      structuringWarning =
        "Transkrip verbatim berhasil, tetapi perapihan/koreksi berbasis Database belum dapat dijalankan. Transkrip mentah tetap disimpan.";
    }

    const { error: updateError } = await supabase
      .from("recordings")
      .update({
        raw_transcript: rawTranscript,
        structured_transcript: structuredTranscript,
        transcript: structuredTranscript,
        corrections,
      })
      .eq("id", recordingId);

    if (updateError) throw updateError;

    const aiUsage = usedShared
      ? await finalizeAiCredits(supabase, "transcription", aiMode)
      : null;

    return NextResponse.json({
      rawTranscript,
      structuredTranscript,
      summary,
      corrections,
      warning: [transcriptionWarning, structuringWarning].filter(Boolean).join(" "),
      aiUsage,
      transcriptionModel,
      structuringModel,
      provider: {
        transcription: transcriptionProvider,
        structuring: structuringProvider || "none",
      },
    });
  } catch (error: any) {
    const status = Number(error?.statusCode || 500);
    console.error("[API_TRANSCRIBE_ERROR]", {
      name: error?.name,
      code: error?.code,
      status,
      message: String(error?.message || "").slice(0, 300),
    });
    return NextResponse.json(
      { error: error?.message || "Transkripsi gagal." },
      { status: status >= 400 && status < 600 ? status : 500 }
    );
  }
}

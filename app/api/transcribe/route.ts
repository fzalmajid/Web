import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { cleanJsonText, geminiGenerateDetailed, WHATSAPP_FORMAT_INSTRUCTION } from "@/lib/gemini";
import { buildKnowledgeContext, getScopeKnowledge } from "@/lib/knowledge";
import { modelPlanForSelection, selectionFromHeaders } from "@/lib/aiModels";
import { geminiUserAuthFromHeaders } from "@/lib/geminiUserAuth";
import { aiModeInstruction, aiQuotaError, checkAiCredits, finalizeAiCredits, normalizeAiMode, recordAiTokenUsage } from "@/lib/aiQuota";

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


function geminiAuthHeaders(auth: ReturnType<typeof geminiUserAuthFromHeaders>): Record<string, string> {
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
    .flatMap((candidate: any) => Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [])
    .map((part: any) => String(part?.text || ""))
    .join("")
    .trim();
}

async function uploadGeminiAudio(
  bytes: Buffer,
  mimeType: string,
  auth: ReturnType<typeof geminiUserAuthFromHeaders>
) {
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
    throw Object.assign(
      new Error(String(data?.error?.message || "Gemini Files API gagal menyiapkan upload audio.")),
      { statusCode: start.status }
    );
  }

  const uploadUrl = start.headers.get("x-goog-upload-url");
  if (!uploadUrl) {
    throw Object.assign(new Error("Gemini Files API tidak mengembalikan upload URL."), { statusCode: 502 });
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
    throw Object.assign(
      new Error(String(info?.error?.message || "Gemini Files API gagal mengupload audio.")),
      { statusCode: upload.status || 502 }
    );
  }

  return {
    uri: String(info.file.uri),
    name: String(info.file.name || ""),
  };
}

async function rawGenerateWithFile(
  model: string,
  fileUri: string,
  mimeType: string,
  auth: ReturnType<typeof geminiUserAuthFromHeaders>,
  dedicatedTranscribe: boolean
) {
  const contents = dedicatedTranscribe
    ? [{ parts: [{ fileData: { fileUri, mimeType } }] }]
    : [{
        parts: [
          {
            text:
              "Transkripsikan audio berikut secara VERBATIM dalam bahasa yang terdengar. " +
              "Tulis sedekat mungkin kata demi kata. Jangan merangkum atau menambah fakta. " +
              "Rapikan tanda baca dan paragraf secukupnya.",
          },
          { fileData: { fileUri, mimeType } },
        ],
      }];

  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/" +
      encodeURIComponent(model) +
      ":generateContent",
    {
      method: "POST",
      headers: geminiAuthHeaders(auth),
      body: JSON.stringify({
        contents,
        ...(dedicatedTranscribe
          ? {
              generationConfig: {
                audioTranscriptionConfig: {
                  languageCodes: ["id-ID"],
                  mode: "VERBATIM",
                },
              },
            }
          : {}),
      }),
    }
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = String(data?.error?.message || "");
    throw Object.assign(
      new Error(message || "Model Gemini gagal mentranskripsikan audio."),
      { statusCode: response.status, providerMessage: message }
    );
  }

  const text = textFromGenerateContent(data);
  if (!text) {
    throw Object.assign(new Error("Model Gemini tidak mengembalikan transkrip audio."), { statusCode: 502 });
  }

  return { text, usage: usageFromProvider(data), model };
}

async function transcribeGeminiAudio(
  bytes: Buffer,
  mimeType: string,
  auth: ReturnType<typeof geminiUserAuthFromHeaders>
) {
  const file = await uploadGeminiAudio(bytes, mimeType, auth);
  const attempts = [
    { model: "gemini-3.5-transcribe", dedicated: true },
    { model: "gemini-3.8-flash", dedicated: false },
    { model: "gemini-3.7-flash", dedicated: false },
    { model: "gemini-3.6-flash", dedicated: false },
    { model: "gemini-2.5-flash", dedicated: false },
  ];

  let lastError: any = null;
  for (const attempt of attempts) {
    try {
      return await rawGenerateWithFile(attempt.model, file.uri, mimeType, auth, attempt.dedicated);
    } catch (error: any) {
      lastError = error;
      const status = Number(error?.statusCode || 500);
      const message = String(error?.providerMessage || error?.message || "");
      const retryable =
        status === 400 ||
        status === 404 ||
        status === 429 ||
        status === 503 ||
        /not available|not found|unsupported|high demand|overloaded|quota|invalid argument/i.test(message);
      if (!retryable) break;
    }
  }

  throw Object.assign(
    new Error(
      "Transkripsi Gemini final belum tersedia pada provider/project ini. Audio tetap tersimpan dan transkrip live/browser akan dipertahankan."
    ),
    { statusCode: Number(lastError?.statusCode || 503) }
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
    const mimeType = normalizeMime(String(body.mimeType || "audio/webm"));
    const aiMode = normalizeAiMode(body.aiMode);
    const aiSelection = selectionFromHeaders(req.headers, "transcription", aiMode);
    const geminiAuth = geminiUserAuthFromHeaders(req.headers);
    const ownGemini = geminiAuth.ownGemini;

    if (aiMode === "simple") {
      return NextResponse.json({ error: "Local memakai transkrip Local dari browser dan tidak memanggil Gemini." }, { status: 400 });
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

    const preflight = ownGemini ? null : await checkAiCredits(supabase, "transcription", aiMode);
    if (preflight && !preflight.allowed) {
      return NextResponse.json(aiQuotaError(preflight), { status: 429 });
    }

    const rawResult = await transcribeGeminiAudio(audioBytes, mimeType, geminiAuth);
    await recordAiTokenUsage(supabase, rawResult.usage, rawResult.model, geminiAuth.provider);
    const rawTranscript = rawResult.text;

    const knowledge = await getScopeKnowledge(supabase, contextNodeId, 40);
    const context = buildKnowledgeContext(knowledge, 26000);

    const structuredResult = await geminiGenerateDetailed(
      [
        {
          text:
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
            "7. " + aiModeInstruction(aiMode) + "\n8. " + WHATSAPP_FORMAT_INSTRUCTION,
        },
      ],
      "Anda menyunting transkrip secara konservatif. Database yang diberikan adalah satu-satunya sumber untuk koreksi istilah faktual.",
      {
      models: modelPlanForSelection(aiSelection.model, aiMode, "standard"),
      effort: aiSelection.effort,
      apiKey: geminiAuth.apiKey,
      accessToken: geminiAuth.accessToken,
      projectId: geminiAuth.projectId,
    }
    );
    await recordAiTokenUsage(supabase, structuredResult.usage, structuredResult.model, geminiAuth.provider);
    const structuredRaw = structuredResult.text;

    let structuredTranscript = rawTranscript;
    let summary = "";
    let corrections: Array<{ heard: string; corrected: string; basis: string }> = [];

    try {
      const parsed = JSON.parse(cleanJsonText(structuredRaw));
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
      structuredTranscript = structuredRaw || rawTranscript;
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

    const aiUsage = ownGemini ? null : await finalizeAiCredits(supabase, "transcription", aiMode);

    return NextResponse.json({
      rawTranscript,
      structuredTranscript,
      summary,
      corrections,
      aiUsage,
      transcriptionModel: rawResult.model,
      structuringModel: structuredResult.model,
      provider: geminiAuth.provider,
    });
  } catch (error: any) {
    const status = Number(error?.statusCode || 500);
    console.error("[API_TRANSCRIBE_ERROR]", { name: error?.name, code: error?.code, status });
    return NextResponse.json(
      { error: error?.message || "Transkripsi gagal." },
      { status: status >= 400 && status < 600 ? status : 500 }
    );
  }
}

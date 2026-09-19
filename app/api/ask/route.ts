import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import {
  geminiGenerateDetailed,
  geminiModelsForMode,
  GeminiWebSearchQuotaError,
  WHATSAPP_FORMAT_INSTRUCTION,
} from "@/lib/gemini";
import { buildKnowledgeContext, getScopeKnowledge, searchScopeKnowledge } from "@/lib/knowledge";
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

function isWebSearchQuotaError(error: unknown) {
  return (
    error instanceof GeminiWebSearchQuotaError ||
    (typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "WEB_SEARCH_QUOTA")
  );
}

type KnowledgeMode = "database" | "hybrid" | "web";

export async function POST(req: NextRequest) {
  try {
    const token = bearer(req);
    if (!token) return NextResponse.json({ error: "Belum login." }, { status: 401 });

    const body = await req.json();
    const question = body.question;
    const scopeNodeId = body.scopeNodeId ?? null;
    const aiMode = normalizeAiMode(body.aiMode ?? "instant");
    const userGeminiKey = String(req.headers.get("x-rb-gemini-key") || "").trim() || undefined;
    const ownGemini = Boolean(userGeminiKey);
    const knowledgeMode: KnowledgeMode =
      body.knowledgeMode === "hybrid" || body.knowledgeMode === "web"
        ? body.knowledgeMode
        : body.publicWeb
          ? "web"
          : "database";

    if (!question || typeof question !== "string" || question.trim().length < 3) {
      return NextResponse.json({ error: "Pertanyaan terlalu pendek." }, { status: 400 });
    }

    if (aiMode === "simple" && knowledgeMode !== "database") {
      return NextResponse.json(
        {
          error:
            knowledgeMode === "web"
              ? "Web + Database membutuhkan Gemini. Pilih Instant, Medium, atau High."
              : "AI + Database membutuhkan Gemini. Pilih Instant, Medium, atau High.",
        },
        { status: 400 }
      );
    }

    const supabase = createServerSupabase(token);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return NextResponse.json({ error: "Sesi tidak valid." }, { status: 401 });
    }

    const searchLimit = aiMode === "high" ? 16 : aiMode === "medium" ? 12 : 8;
    const fallbackLimit = aiMode === "high" ? 40 : aiMode === "medium" ? 28 : 20;
    let data = await searchScopeKnowledge(supabase, question.trim(), scopeNodeId, searchLimit);

    if (!data.length) {
      data = await getScopeKnowledge(supabase, scopeNodeId, fallbackLimit);
    }

    if (!data.length && knowledgeMode === "database") {
      return NextResponse.json({
        answer: "Materi ini belum tersedia di database.",
        sources: [],
        webSources: [],
        grounded: true,
        publicWeb: false,
        knowledgeMode: "database",
        model: "Local Database",
      });
    }

    const contextLimit = aiMode === "high" ? 42000 : aiMode === "medium" ? 32000 : 22000;
    const context = data.length
      ? buildKnowledgeContext(data, contextLimit)
      : "(Database pribadi pada scope ini kosong.)";

    const databasePrompt = `PERTANYAAN:
${question.trim()}

DATABASE:
${context}

Jawab hanya berdasarkan DATABASE di atas.
${aiModeInstruction(aiMode)}
- Jika database tidak cukup untuk menjawab pertanyaan, jawab persis: "Materi ini belum tersedia di database."
- Jangan gunakan pengetahuan umum atau internet.
- Bila ada istilah yang berbeda, utamakan istilah yang benar-benar tertulis/terdefinisi di database.
- Jawab dengan jelas dan terstruktur.
${WHATSAPP_FORMAT_INSTRUCTION}`;

    const hybridPrompt = `PERTANYAAN:
${question.trim()}

DATABASE PRIBADI:
${context}

Mode AI + Database AKTIF.
- DATABASE PRIBADI adalah referensi utama.
- Jika Database cukup, utamakan isi Database.
- Jika Database tidak cukup, Anda BOLEH melengkapi dari pengetahuan internal model.
- Jangan melakukan browsing internet atau mengklaim informasi sebagai informasi terbaru.
- Fakta penting yang tidak berasal dari Database harus ditandai dengan jelas sebagai "Pengetahuan AI".
- Jika ada konflik antara Database dan pengetahuan internal model, jelaskan perbedaannya dan jangan diam-diam mengganti isi Database.
${aiModeInstruction(aiMode)}
- Jawab dengan jelas dan terstruktur.
${WHATSAPP_FORMAT_INSTRUCTION}`;

    const webPrompt = `PERTANYAAN:
${question.trim()}

DATABASE PRIBADI:
${context}

Mode Web + Database AKTIF.
- Gunakan DATABASE PRIBADI sebagai konteks utama bila relevan.
- Gunakan Google Search untuk informasi publik yang perlu dilengkapi atau diverifikasi.
- Anda juga boleh memakai pengetahuan internal model sebagai penghubung penjelasan.
- Bedakan dengan jelas informasi yang berasal dari Web bila relevan.
- Jangan mengarang sumber.
${aiModeInstruction(aiMode)}
- Jawab dengan jelas dan terstruktur.
${WHATSAPP_FORMAT_INSTRUCTION}`;

    const sources = data.map((m) => ({
      id: m.id,
      node_id: m.node_id,
      title: m.title,
      category: m.category,
    }));

    if (knowledgeMode === "web") {
      const preflight = ownGemini ? null : await checkAiCredits(supabase, "ask_web", aiMode);
      if (preflight && !preflight.allowed) {
        return NextResponse.json(aiQuotaError(preflight), { status: 429 });
      }

      try {
        const result = await geminiGenerateDetailed(
          [{ text: webPrompt }],
          "Anda adalah tutor Ruang Belajar. Database pribadi tetap prioritas dan Google Search boleh dipakai karena pengguna memilih Web + Database.",
          { googleSearch: true, models: geminiModelsForMode(aiMode, "web"), apiKey: userGeminiKey }
        );

        await recordAiTokenUsage(supabase, result.usage, result.model);
        const aiUsage = ownGemini ? null : await finalizeAiCredits(supabase, "ask_web", aiMode);

        return NextResponse.json({
          answer: result.text,
          sources,
          webSources: result.webSources,
          grounded: true,
          publicWeb: true,
          knowledgeMode: "web",
          webFallback: false,
          model: result.model,
          aiUsage,
          provider: ownGemini ? "user-api-key" : "shared-api-key",
        });
      } catch (error) {
        if (!isWebSearchQuotaError(error)) throw error;

        const fallbackResult = await geminiGenerateDetailed(
          [{ text: hybridPrompt }],
          "Anda adalah tutor Ruang Belajar. Gunakan Database sebagai konteks utama dan pengetahuan internal model sebagai pelengkap. Jangan browsing internet.",
          { models: geminiModelsForMode(aiMode, "standard"), apiKey: userGeminiKey }
        );

        await recordAiTokenUsage(supabase, fallbackResult.usage, fallbackResult.model);
        const aiUsage = ownGemini ? null : await finalizeAiCredits(supabase, "ask", aiMode);

        return NextResponse.json({
          answer: fallbackResult.text,
          sources,
          webSources: [],
          grounded: false,
          publicWeb: false,
          knowledgeMode: "hybrid",
          webFallback: true,
          warning:
            "Google Search tidak tersedia untuk request ini. Sistem otomatis beralih ke AI + Database tanpa browsing.",
          model: fallbackResult.model,
          aiUsage,
          provider: ownGemini ? "user-api-key" : "shared-api-key",
        });
      }
    }

    const action = "ask";
    const preflight = ownGemini ? null : await checkAiCredits(supabase, action, aiMode);
    if (preflight && !preflight.allowed) {
      return NextResponse.json(aiQuotaError(preflight), { status: 429 });
    }

    const useHybrid = knowledgeMode === "hybrid";
    const result = await geminiGenerateDetailed(
      [{ text: useHybrid ? hybridPrompt : databasePrompt }],
      useHybrid
        ? "Anda adalah tutor Ruang Belajar. Database adalah referensi utama; pengetahuan internal model boleh dipakai sebagai pelengkap dan harus dibedakan."
        : "Anda adalah tutor Ruang Belajar yang terikat ketat pada database yang diberikan. Jangan memakai pengetahuan eksternal.",
      { models: geminiModelsForMode(aiMode, "standard"), apiKey: userGeminiKey }
    );

    await recordAiTokenUsage(supabase, result.usage, result.model);
    const aiUsage = ownGemini ? null : await finalizeAiCredits(supabase, action, aiMode);

    return NextResponse.json({
      answer: result.text,
      sources,
      webSources: [],
      grounded: knowledgeMode === "database",
      publicWeb: false,
      knowledgeMode,
      webFallback: false,
      model: result.model,
      aiUsage,
      provider: ownGemini ? "user-api-key" : "shared-api-key",
    });
  } catch (error: any) {
    const status = Number(error?.statusCode || 500);
    console.error("[API_ASK_ERROR]", { name: error?.name, code: error?.code, status });
    return NextResponse.json(
      { error: error?.message || "Gagal menjawab." },
      { status: status >= 400 && status < 600 ? status : 500 }
    );
  }
}

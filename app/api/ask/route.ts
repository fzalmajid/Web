import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import {
  geminiGenerateDetailed,
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

export async function POST(req: NextRequest) {
  try {
    const token = bearer(req);
    if (!token) return NextResponse.json({ error: "Belum login." }, { status: 401 });

    const {
      question,
      scopeNodeId = null,
      aiMode: rawAiMode = "instant",
      publicWeb = false,
    } = await req.json();
    const aiMode = normalizeAiMode(rawAiMode);

    if (!question || typeof question !== "string" || question.trim().length < 3) {
      return NextResponse.json({ error: "Pertanyaan terlalu pendek." }, { status: 400 });
    }

    if (aiMode === "simple") {
      return NextResponse.json(
        {
          error: publicWeb
            ? "Public Web membutuhkan Gemini 3.6. Pilih Instant, Medium, atau High."
            : "Mode Simple diproses secara Local di perangkat dan tidak memanggil Gemini.",
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

    if (!data.length && !publicWeb) {
      return NextResponse.json({
        answer: "Materi ini belum tersedia di database.",
        sources: [],
        webSources: [],
        grounded: true,
        publicWeb: false,
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

    const webPrompt = `PERTANYAAN:
${question.trim()}

DATABASE PRIBADI:
${context}

Mode Public Web AKTIF.
- Gunakan DATABASE PRIBADI sebagai konteks utama bila relevan.
- Anda boleh memakai Google Search untuk melengkapi atau memverifikasi informasi publik.
- Bedakan dengan jelas bila informasi berasal dari web publik.
- Jangan mengarang sumber.
${aiModeInstruction(aiMode)}
- Jawab dengan jelas dan terstruktur.
${WHATSAPP_FORMAT_INSTRUCTION}`;

    if (publicWeb) {
      const preflight = await checkAiCredits(supabase, "ask_web", aiMode);
      if (!preflight.allowed) {
        return NextResponse.json(aiQuotaError(preflight), { status: 429 });
      }

      try {
        const result = await geminiGenerateDetailed(
          [{ text: webPrompt }],
          "Anda adalah tutor Ruang Belajar. Database pribadi tetap prioritas, tetapi Google Search boleh dipakai karena pengguna secara eksplisit mengaktifkan Public Web.",
          { googleSearch: true }
        );

        await recordAiTokenUsage(supabase, result.usage);
        const aiUsage = await finalizeAiCredits(supabase, "ask_web", aiMode);

        return NextResponse.json({
          answer: result.text,
          sources: data.map((m) => ({
            id: m.id,
            node_id: m.node_id,
            title: m.title,
            category: m.category,
          })),
          webSources: result.webSources,
          grounded: true,
          publicWeb: true,
          webFallback: false,
          aiUsage,
        });
      } catch (error) {
        if (!isWebSearchQuotaError(error)) throw error;

        // Google Search Grounding can have a separate quota from normal Gemini.
        // Do not charge ask_web credits when the grounding request itself failed.
        if (!data.length) {
          return NextResponse.json(
            {
              error:
                "Public Web belum tersedia pada quota Google Search Grounding project ini. Gemini biasa masih bisa dipakai, tetapi untuk browsing web perlu quota/billing Search Grounding.",
              webSearchUnavailable: true,
              chargedCredits: 0,
            },
            { status: 503 }
          );
        }

        // Graceful fallback: answer from the private Database only, then charge normal ask credits.
        const fallbackResult = await geminiGenerateDetailed(
          [{ text: databasePrompt }],
          "Anda adalah tutor Ruang Belajar yang terikat ketat pada database yang diberikan. Jangan memakai pengetahuan eksternal."
        );

        await recordAiTokenUsage(supabase, fallbackResult.usage);
        const aiUsage = await finalizeAiCredits(supabase, "ask", aiMode);

        return NextResponse.json({
          answer: fallbackResult.text,
          sources: data.map((m) => ({
            id: m.id,
            node_id: m.node_id,
            title: m.title,
            category: m.category,
          })),
          webSources: [],
          grounded: true,
          publicWeb: false,
          webFallback: true,
          warning:
            "Public Web tidak dipakai karena quota Google Search Grounding tidak tersedia/tercapai. Jawaban ini dibuat dari Database saja dan hanya memakai credit Gemini biasa.",
          aiUsage,
        });
      }
    }

    const preflight = await checkAiCredits(supabase, "ask", aiMode);
    if (!preflight.allowed) {
      return NextResponse.json(aiQuotaError(preflight), { status: 429 });
    }

    const result = await geminiGenerateDetailed(
      [{ text: databasePrompt }],
      "Anda adalah tutor Ruang Belajar yang terikat ketat pada database yang diberikan. Jangan memakai pengetahuan eksternal."
    );
    await recordAiTokenUsage(supabase, result.usage);
    const aiUsage = await finalizeAiCredits(supabase, "ask", aiMode);

    return NextResponse.json({
      answer: result.text,
      sources: data.map((m) => ({
        id: m.id,
        node_id: m.node_id,
        title: m.title,
        category: m.category,
      })),
      webSources: [],
      grounded: true,
      publicWeb: false,
      webFallback: false,
      aiUsage,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Gagal menjawab." }, { status: 500 });
  }
}

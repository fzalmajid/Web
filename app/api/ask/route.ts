import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import {
  geminiGenerateDetailed,
  GeminiWebSearchQuotaError,
  WHATSAPP_FORMAT_INSTRUCTION,
} from "@/lib/gemini";
import { buildKnowledgeContext, getScopeKnowledge, searchScopeKnowledge } from "@/lib/knowledge";
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

function isWebSearchQuotaError(error: unknown) {
  return (
    error instanceof GeminiWebSearchQuotaError ||
    (typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "WEB_SEARCH_QUOTA")
  );
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

  // Backward compatibility with older clients.
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
}: {
  question: string;
  context: string;
  useAi: boolean;
  useDatabase: boolean;
  useWeb: boolean;
  aiMode: ReturnType<typeof normalizeAiMode>;
}) {
  const sections = [
    "PERTANYAAN:",
    question.trim(),
  ];

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
  ];

  if (useDatabase) {
    rules.push("- Gunakan Database pribadi sebagai sumber sesuai kebutuhan.");
  } else {
    rules.push("- Jangan mengklaim memakai Database pribadi karena sumber Database tidak dipilih.");
  }

  if (useAi) {
    rules.push("- Anda boleh memakai pengetahuan internal model.");
  } else {
    rules.push("- Jangan memakai pengetahuan internal model sebagai sumber fakta yang berdiri sendiri.");
  }

  if (useWeb) {
    rules.push("- Gunakan Google Search untuk informasi publik dan sumber web yang relevan.");
    rules.push("- Jangan mengarang sumber atau URL.");
  } else {
    rules.push("- Jangan browsing internet.");
  }

  if (useDatabase && !useAi && !useWeb) {
    rules.push('- Jawab hanya dari Database. Jika tidak cukup, jawab persis: "Materi ini belum tersedia di database."');
  }

  if (useDatabase && useAi) {
    rules.push('- Bila fakta penting berasal dari pengetahuan internal model, tandai sebagai "Pengetahuan AI" bila perlu agar tidak tercampur dengan Database.');
  }

  rules.push(
    aiModeInstruction(aiMode),
    "- Jawab dengan jelas dan terstruktur.",
    WHATSAPP_FORMAT_INSTRUCTION
  );

  return sections.concat([""], rules).flat().join("\n");
}

export async function POST(req: NextRequest) {
  try {
    const token = bearer(req);
    if (!token) return NextResponse.json({ error: "Belum login." }, { status: 401 });

    const body = await req.json();
    const question = body.question;
    const scopeNodeId = body.scopeNodeId ?? null;
    const aiMode = normalizeAiMode(body.aiMode ?? "instant");
    const aiSelection = selectionFromHeaders(req.headers, "general", aiMode);
    const geminiAuth = geminiUserAuthFromHeaders(req.headers);
    const ownGemini = geminiAuth.ownGemini;
    const selectedSources = normalizeSources(body);

    if (!question || typeof question !== "string" || question.trim().length < 3) {
      return NextResponse.json({ error: "Pertanyaan terlalu pendek." }, { status: 400 });
    }
    if (!selectedSources.length) {
      return NextResponse.json({ error: "Pilih minimal satu sumber: AI, Database, atau Web." }, { status: 400 });
    }

    const useAi = selectedSources.includes("ai");
    const useDatabase = selectedSources.includes("database");
    const useWeb = selectedSources.includes("web");

    if (aiMode === "simple" && (useAi || useWeb)) {
      return NextResponse.json(
        { error: "Local hanya dapat memakai Database. Pilih model Gemini untuk sumber AI atau Web." },
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
    let data: any[] = [];

    if (useDatabase) {
      data = await searchScopeKnowledge(supabase, question.trim(), scopeNodeId, searchLimit);
      if (!data.length) data = await getScopeKnowledge(supabase, scopeNodeId, fallbackLimit);

      if (!data.length && !useAi && !useWeb) {
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
    }

    const contextLimit = aiMode === "high" ? 42000 : aiMode === "medium" ? 32000 : 22000;
    const context = data.length
      ? buildKnowledgeContext(data, contextLimit)
      : "(Database pribadi kosong atau tidak dipilih.)";

    const sources = useDatabase
      ? data.map((m) => ({
          id: m.id,
          node_id: m.node_id,
          title: m.title,
          category: m.category,
        }))
      : [];

    const prompt = buildPrompt({
      question,
      context,
      useAi,
      useDatabase,
      useWeb,
      aiMode,
    });

    const action = useWeb ? "ask_web" : "ask";
    const preflight = ownGemini ? null : await checkAiCredits(supabase, action, aiMode);
    if (preflight && !preflight.allowed) {
      return NextResponse.json(aiQuotaError(preflight), { status: 429 });
    }

    try {
      const result = await geminiGenerateDetailed(
        [{ text: prompt }],
        "Anda adalah tutor Ruang Belajar. Hormati persis kombinasi sumber yang dipilih user.",
        {
          googleSearch: useWeb,
          models: modelPlanForSelection(aiSelection.model, aiMode, useWeb ? "web" : "standard"),
          effort: aiSelection.effort,
          apiKey: geminiAuth.apiKey,
          accessToken: geminiAuth.accessToken,
          projectId: geminiAuth.projectId,
        }
      );

      await recordAiTokenUsage(supabase, result.usage, result.model, geminiAuth.provider);
      const aiUsage = ownGemini ? null : await finalizeAiCredits(supabase, action, aiMode);

      return NextResponse.json({
        answer: result.text,
        sources,
        webSources: result.webSources,
        grounded: !useAi,
        publicWeb: useWeb,
        selectedSources,
        webFallback: false,
        model: result.model,
        aiUsage,
        provider: geminiAuth.provider,
      });
    } catch (error) {
      if (!useWeb || !isWebSearchQuotaError(error)) throw error;

      const fallbackSources = selectedSources.filter((source) => source !== "web");
      if (!fallbackSources.length) {
        return NextResponse.json(
          {
            error:
              "Web sedang tidak tersedia pada provider ini. Aktifkan AI atau Database sebagai sumber tambahan, atau pilih Gemini 2.5 Flash/Flash-Lite.",
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
      });

      const fallbackResult = await geminiGenerateDetailed(
        [{ text: fallbackPrompt }],
        "Anda adalah tutor Ruang Belajar. Web gagal dipakai; jawab hanya dari sumber lain yang memang dipilih user.",
        {
          models: modelPlanForSelection(aiSelection.model, aiMode, "standard"),
          effort: aiSelection.effort,
          apiKey: geminiAuth.apiKey,
          accessToken: geminiAuth.accessToken,
          projectId: geminiAuth.projectId,
        }
      );

      await recordAiTokenUsage(supabase, fallbackResult.usage, fallbackResult.model, geminiAuth.provider);
      const aiUsage = ownGemini ? null : await finalizeAiCredits(supabase, "ask", aiMode);

      return NextResponse.json({
        answer: fallbackResult.text,
        sources: fallbackSources.includes("database") ? sources : [],
        webSources: [],
        grounded: !fallbackSources.includes("ai"),
        publicWeb: false,
        selectedSources: fallbackSources,
        webFallback: true,
        warning:
          "Web sedang tidak tersedia. Sistem melanjutkan hanya dengan sumber lain yang sudah kamu pilih.",
        model: fallbackResult.model,
        aiUsage,
        provider: geminiAuth.provider,
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

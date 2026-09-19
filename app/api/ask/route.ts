import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import {
  geminiGenerateDetailed,
  GeminiWebSearchQuotaError,
  WHATSAPP_FORMAT_INSTRUCTION,
} from "@/lib/gemini";
import { openaiGenerateDetailed, anthropicGenerateDetailed, ExternalAiError } from "@/lib/externalAi";
import { buildKnowledgeContext, getScopeKnowledge, searchScopeKnowledge } from "@/lib/knowledge";
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
}: {
  question: string;
  context: string;
  useAi: boolean;
  useDatabase: boolean;
  useWeb: boolean;
  aiMode: ReturnType<typeof normalizeAiMode>;
}) {
  const sections = ["PERTANYAAN:", question.trim()];

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
    const aiSelection = selectionFromHeaders(req.headers, "chat", aiMode);
    const selectedProvider = modelProvider(aiSelection.model);
    const selectedProviderModel = providerModelId(aiSelection.model);
    const geminiAuth = geminiUserAuthFromHeaders(req.headers);
    const openAIKey = String(req.headers.get("x-rb-openai-key") || "").trim();
    const anthropicKey = String(req.headers.get("x-rb-anthropic-key") || "").trim();
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

    const databaseSources = useDatabase
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
          effort: aiSelection.effort,
          web: withWeb,
        });
      }

      if (selectedProvider === "anthropic") {
        return anthropicGenerateDetailed({
          apiKey: anthropicKey,
          model: selectedProviderModel,
          prompt: targetPrompt,
          system: "Anda adalah tutor Ruang Belajar. Hormati persis kombinasi sumber yang dipilih user.",
          effort: aiSelection.effort,
          web: withWeb,
        });
      }

      return geminiGenerateDetailed(
        [{ text: targetPrompt }],
        "Anda adalah tutor Ruang Belajar. Hormati persis kombinasi sumber yang dipilih user.",
        {
          googleSearch: withWeb,
          models: modelPlanForSelection(
            aiSelection.model,
            aiMode,
            withWeb ? "web" : "standard"
          ),
          effort: aiSelection.effort,
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
          [{ text: prompt }],
          "Anda adalah tutor Ruang Belajar. Jawab menggunakan Web sesuai sumber yang dipilih user.",
          {
            googleSearch: true,
            models: modelPlanForSelection("gemini-2.5-flash", aiMode, "web"),
            effort: "none",
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
            web: true,
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
            web: true,
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
          [{ text: prompt }],
          "Anda adalah tutor Ruang Belajar. Jawab menggunakan Web sesuai sumber yang dipilih user.",
          {
            googleSearch: true,
            models: modelPlanForSelection("gemini-2.5-flash", aiMode, "web"),
            effort: "none",
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
        sources: databaseSources,
        webSources: result.webSources,
        grounded: !useAi,
        publicWeb: useWeb,
        selectedSources,
        webFallback: false,
        model: result.model,
        aiUsage,
        provider: selectedUsageProvider(),
      });
    } catch (error: any) {
      const fallbackSources = selectedSources.filter((source) => source !== "web");
      const webSpecificFailure = useWeb && isWebProviderFailure(error);

      if (!webSpecificFailure) throw error;

      const alternate = await alternateWebResult();
      if (alternate) {
        return NextResponse.json({
          answer: alternate.result.text,
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

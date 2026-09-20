import type { NextRequest } from "next/server";
import { geminiGenerateDetailed } from "./gemini";
import { openaiGenerateDetailed, anthropicGenerateDetailed, ExternalAiError } from "./externalAi";
import {
  modelPlanForSelection,
  modelProvider,
  providerModelId,
  selectionFromHeaders,
  type AiLegacyMode,
} from "./aiModels";
import { geminiUserAuthFromHeaders } from "./geminiUserAuth";

export function getTextAiRequestInfo(req: NextRequest, aiMode: AiLegacyMode) {
  const selection = selectionFromHeaders(req.headers, "chat", aiMode);
  const provider = modelProvider(selection.model);
  const providerModel = providerModelId(selection.model);
  const geminiAuth = geminiUserAuthFromHeaders(req.headers);
  const openAIKey = String(req.headers.get("x-rb-openai-key") || "").trim();
  const anthropicKey = String(req.headers.get("x-rb-anthropic-key") || "").trim();

  return {
    selection,
    provider,
    providerModel,
    geminiAuth,
    openAIKey,
    anthropicKey,
    sharedGemini: provider === "gemini" && !geminiAuth.ownGemini,
  };
}

export async function generateTextAi(
  info: ReturnType<typeof getTextAiRequestInfo>,
  aiMode: AiLegacyMode,
  prompt: string,
  system: string,
  options?: {
    web?: boolean;
    json?: boolean;
    maxOutputTokens?: number;
    effortOverride?: any;
  }
) {
  const effort = options?.effortOverride || info.selection.effort;

  if (info.provider === "openai") {
    if (!info.openAIKey) throw new ExternalAiError("Plugin OpenAI belum terhubung.", 400, "OPENAI_KEY_MISSING");
    return {
      ...(await openaiGenerateDetailed({
        apiKey: info.openAIKey,
        model: info.providerModel,
        prompt,
        system,
        effort,
        responseLength: info.selection.length,
        maxOutputTokens: options?.maxOutputTokens,
        web: Boolean(options?.web),
      })),
      provider: "user-openai-api-key" as const,
    };
  }

  if (info.provider === "anthropic") {
    if (!info.anthropicKey) throw new ExternalAiError("Plugin Claude belum terhubung.", 400, "ANTHROPIC_KEY_MISSING");
    return {
      ...(await anthropicGenerateDetailed({
        apiKey: info.anthropicKey,
        model: info.providerModel,
        prompt,
        system,
        effort,
        responseLength: info.selection.length,
        maxOutputTokens: options?.maxOutputTokens,
        web: Boolean(options?.web),
      })),
      provider: "user-anthropic-api-key" as const,
    };
  }

  if (info.provider === "local" || info.provider === "local-openai") {
    throw new ExternalAiError("Model Local belum didukung untuk generator server ini.", 400, "LOCAL_UNSUPPORTED");
  }

  const result = await geminiGenerateDetailed(
    [{ text: prompt }],
    system,
    {
      models: modelPlanForSelection(info.selection.model, aiMode, options?.web ? "web" : "standard"),
      effort,
      responseLength: info.selection.length,
      responseMimeType: options?.json ? "application/json" : undefined,
      maxOutputTokens: options?.maxOutputTokens,
      googleSearch: Boolean(options?.web),
      apiKey: info.geminiAuth.apiKey,
      accessToken: info.geminiAuth.accessToken,
      projectId: info.geminiAuth.projectId,
    }
  );

  return {
    ...result,
    provider: info.geminiAuth.provider,
  };
}

export type AiModelId =
  | "local"
  | "gemini-3.6-flash"
  | "gemini-2.5-flash"
  | "gemini-2.5-flash-lite"
  | "gemini-3.5-transcribe";

export type AiEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "off"
  | "dynamic";

export type AiSelection = {
  model: AiModelId;
  effort: AiEffort;
};

export type AiLegacyMode = "simple" | "instant" | "medium" | "high";

export type AiModelCapability = {
  id: AiModelId;
  label: string;
  subtitle: string;
  contexts: Array<"general" | "transcription">;
  efforts: Array<{ value: AiEffort; label: string; hint: string }>;
  defaultEffort: AiEffort;
};

export const AI_MODEL_CATALOG: AiModelCapability[] = [
  {
    id: "local",
    label: "Local",
    subtitle: "Tanpa Gemini API",
    contexts: ["general", "transcription"],
    efforts: [],
    defaultEffort: "none",
  },
  {
    id: "gemini-3.6-flash",
    label: "Gemini 3.6 Flash",
    subtitle: "Reasoning Gemini 3",
    contexts: ["general", "transcription"],
    efforts: [
      { value: "minimal", label: "Minimal", hint: "Penalaran sangat ringan" },
      { value: "low", label: "Low", hint: "Lebih cepat" },
      { value: "medium", label: "Medium", hint: "Seimbang · default model" },
      { value: "high", label: "High", hint: "Penalaran paling dalam" },
    ],
    defaultEffort: "medium",
  },
  {
    id: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    subtitle: "Cepat, Free Tier tersedia",
    contexts: ["general", "transcription"],
    efforts: [
      { value: "off", label: "Off", hint: "Thinking budget 0" },
      { value: "low", label: "Low", hint: "Thinking budget ringan" },
      { value: "medium", label: "Medium", hint: "Thinking budget sedang" },
      { value: "high", label: "High", hint: "Thinking budget tinggi" },
      { value: "dynamic", label: "Dynamic", hint: "Model mengatur budget otomatis" },
    ],
    defaultEffort: "dynamic",
  },
  {
    id: "gemini-2.5-flash-lite",
    label: "Gemini 2.5 Flash-Lite",
    subtitle: "Paling hemat, Free Tier tersedia",
    contexts: ["general", "transcription"],
    efforts: [
      { value: "off", label: "Off", hint: "Tanpa thinking · default model" },
      { value: "low", label: "Low", hint: "Thinking ringan" },
      { value: "medium", label: "Medium", hint: "Thinking sedang" },
      { value: "high", label: "High", hint: "Thinking tinggi" },
      { value: "dynamic", label: "Dynamic", hint: "Model mengatur budget otomatis" },
    ],
    defaultEffort: "off",
  },
  {
    id: "gemini-3.5-transcribe",
    label: "Gemini 3.5 Transcribe",
    subtitle: "Khusus speech-to-text · tanpa level thinking",
    contexts: ["transcription"],
    efforts: [],
    defaultEffort: "none",
  },
];

export function modelCapability(model: AiModelId) {
  return AI_MODEL_CATALOG.find((item) => item.id === model) || AI_MODEL_CATALOG[0];
}

export function normalizeAiModel(value: unknown, context: "general" | "transcription" = "general"): AiModelId {
  const candidate = String(value || "") as AiModelId;
  const found = AI_MODEL_CATALOG.find(
    (item) => item.id === candidate && item.contexts.includes(context)
  );
  return found?.id || "local";
}

export function normalizeAiEffort(model: AiModelId, value: unknown): AiEffort {
  const capability = modelCapability(model);
  if (!capability.efforts.length) return "none";
  const candidate = String(value || "") as AiEffort;
  return capability.efforts.some((item) => item.value === candidate)
    ? candidate
    : capability.defaultEffort;
}

export function defaultSelection(
  model: AiModelId,
  context: "general" | "transcription" = "general"
): AiSelection {
  const normalized = normalizeAiModel(model, context);
  return {
    model: normalized,
    effort: modelCapability(normalized).defaultEffort,
  };
}

export function legacyModeForSelection(selection: AiSelection): AiLegacyMode {
  if (selection.model === "local") return "simple";
  if (selection.effort === "high") return "high";
  if (selection.effort === "medium" || selection.effort === "dynamic") return "medium";
  return "instant";
}

export function thinkingConfigForModel(model: string, effort: AiEffort) {
  if (model === "gemini-3.5-transcribe" || model === "gemini-3.5-transcribe-live") {
    return undefined;
  }

  if (model.startsWith("gemini-3")) {
    const level =
      effort === "minimal" || effort === "low" || effort === "medium" || effort === "high"
        ? effort
        : undefined;
    return level ? { thinkingLevel: level } : undefined;
  }

  if (model.startsWith("gemini-2.5")) {
    const budget =
      effort === "off" || effort === "minimal"
        ? 0
        : effort === "low"
          ? 1024
          : effort === "medium"
            ? 8192
            : effort === "high"
              ? 24576
              : effort === "dynamic"
                ? -1
                : undefined;
    return budget === undefined ? undefined : { thinkingBudget: budget };
  }

  return undefined;
}

export function modelPlanForSelection(
  selectedModel: AiModelId,
  legacyMode: AiLegacyMode,
  task: "standard" | "web" | "audio" = "standard"
) {
  if (selectedModel === "local") return [];

  if (selectedModel === "gemini-3.5-transcribe") {
    return task === "audio"
      ? ["gemini-3.5-transcribe", "gemini-2.5-flash", "gemini-2.5-flash-lite"]
      : ["gemini-2.5-flash", "gemini-2.5-flash-lite"];
  }

  const fallback =
    task === "web"
      ? ["gemini-2.5-flash", "gemini-2.5-flash-lite"]
      : task === "audio"
        ? ["gemini-3.5-transcribe", "gemini-2.5-flash", "gemini-2.5-flash-lite"]
        : legacyMode === "high"
          ? ["gemini-3.6-flash", "gemini-2.5-flash", "gemini-2.5-flash-lite"]
          : ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-3.6-flash"];

  return Array.from(new Set([selectedModel, ...fallback]));
}

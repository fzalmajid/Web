export type AiModelId =
  | "local"
  | "gemini-3.8-flash"
  | "gemini-3.7-flash"
  | "gemini-3.6-flash"
  | "gemini-3.5-flash"
  | "gemini-3.5-flash-lite"
  | "gemini-3.1-flash-lite"
  | "gemini-2.5-pro"
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
  freeTier: boolean;
  freeWeb?: boolean;
};

const LEVEL_3X_ALL: AiModelCapability["efforts"] = [
  { value: "minimal", label: "Minimal", hint: "Penalaran paling ringan" },
  { value: "low", label: "Low", hint: "Cepat, reasoning ringan" },
  { value: "medium", label: "Medium", hint: "Seimbang" },
  { value: "high", label: "High", hint: "Penalaran paling dalam" },
];

const LEVEL_3X_LMH: AiModelCapability["efforts"] = [
  { value: "low", label: "Low", hint: "Cepat, reasoning ringan" },
  { value: "medium", label: "Medium", hint: "Seimbang" },
  { value: "high", label: "High", hint: "Penalaran paling dalam" },
];

const LEVEL_25: AiModelCapability["efforts"] = [
  { value: "off", label: "Off", hint: "Thinking budget 0" },
  { value: "low", label: "Low", hint: "Thinking budget ringan" },
  { value: "medium", label: "Medium", hint: "Thinking budget sedang" },
  { value: "high", label: "High", hint: "Thinking budget tinggi" },
  { value: "dynamic", label: "Dynamic", hint: "Model mengatur budget otomatis" },
];

const LEVEL_25_PRO: AiModelCapability["efforts"] = [
  { value: "low", label: "Low", hint: "Thinking budget ringan" },
  { value: "medium", label: "Medium", hint: "Thinking budget sedang" },
  { value: "high", label: "High", hint: "Thinking budget tinggi" },
  { value: "dynamic", label: "Dynamic", hint: "Model mengatur budget otomatis" },
];

export const AI_MODEL_CATALOG: AiModelCapability[] = [
  {
    id: "local",
    label: "Local",
    subtitle: "Tanpa Gemini · Database/browser",
    contexts: ["general", "transcription"],
    efforts: [],
    defaultEffort: "none",
    freeTier: true,
  },
  {
    id: "gemini-3.8-flash",
    label: "Gemini 3.8 Flash",
    subtitle: "Terbaru · Flash paling cerdas",
    contexts: ["general", "transcription"],
    efforts: LEVEL_3X_LMH,
    defaultEffort: "medium",
    freeTier: true,
  },
  {
    id: "gemini-3.7-flash",
    label: "Gemini 3.7 Flash",
    subtitle: "Cepat · multi-step stabil",
    contexts: ["general", "transcription"],
    efforts: LEVEL_3X_LMH,
    defaultEffort: "medium",
    freeTier: true,
  },
  {
    id: "gemini-3.6-flash",
    label: "Gemini 3.6 Flash",
    subtitle: "Multimodal · reasoning fleksibel",
    contexts: ["general", "transcription"],
    efforts: LEVEL_3X_ALL,
    defaultEffort: "medium",
    freeTier: true,
  },
  {
    id: "gemini-3.5-flash",
    label: "Gemini 3.5 Flash",
    subtitle: "Flash stabil · fallback kuat",
    contexts: ["general", "transcription"],
    efforts: LEVEL_3X_ALL,
    defaultEffort: "medium",
    freeTier: true,
  },
  {
    id: "gemini-3.5-flash-lite",
    label: "Gemini 3.5 Flash-Lite",
    subtitle: "Hemat · volume tinggi",
    contexts: ["general", "transcription"],
    efforts: LEVEL_3X_ALL,
    defaultEffort: "low",
    freeTier: true,
  },
  {
    id: "gemini-3.1-flash-lite",
    label: "Gemini 3.1 Flash-Lite",
    subtitle: "Ringan · fallback hemat",
    contexts: ["general", "transcription"],
    efforts: LEVEL_3X_ALL,
    defaultEffort: "low",
    freeTier: true,
  },
  {
    id: "gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    subtitle: "Reasoning Pro · tugas kompleks",
    contexts: ["general", "transcription"],
    efforts: LEVEL_25_PRO,
    defaultEffort: "dynamic",
    freeTier: true,
  },
  {
    id: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    subtitle: "Free Tier · Web gratis tersedia",
    contexts: ["general", "transcription"],
    efforts: LEVEL_25,
    defaultEffort: "dynamic",
    freeTier: true,
    freeWeb: true,
  },
  {
    id: "gemini-2.5-flash-lite",
    label: "Gemini 2.5 Flash-Lite",
    subtitle: "Paling hemat · Web gratis tersedia",
    contexts: ["general", "transcription"],
    efforts: LEVEL_25,
    defaultEffort: "off",
    freeTier: true,
    freeWeb: true,
  },
  {
    id: "gemini-3.5-transcribe",
    label: "Gemini 3.5 Transcribe",
    subtitle: "Khusus speech-to-text · tanpa level",
    contexts: ["transcription"],
    efforts: [],
    defaultEffort: "none",
    freeTier: true,
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

export function selectionFromLegacyMode(
  mode: AiLegacyMode,
  context: "general" | "transcription" = "general"
): AiSelection {
  if (mode === "simple") return defaultSelection("local", context);
  if (context === "transcription") return defaultSelection("gemini-3.5-transcribe", context);
  if (mode === "high") return { model: "gemini-3.8-flash", effort: "high" };
  if (mode === "medium") return { model: "gemini-3.8-flash", effort: "medium" };
  return { model: "gemini-2.5-flash-lite", effort: "off" };
}

export function legacyModeForSelection(selection: AiSelection): AiLegacyMode {
  if (selection.model === "local") return "simple";
  if (selection.effort === "high") return "high";
  if (selection.effort === "medium" || selection.effort === "dynamic") return "medium";
  return "instant";
}

export function thinkingConfigForModel(model: string, effort: AiEffort) {
  if (model === "gemini-3.5-transcribe" || model.includes("-live")) {
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
    const isPro = model === "gemini-2.5-pro";
    const budget =
      effort === "off" || effort === "minimal"
        ? (isPro ? -1 : 0)
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

export function selectionFromHeaders(
  headers: Headers,
  context: "general" | "transcription",
  legacyMode: AiLegacyMode
): AiSelection {
  const rawModel = String(headers.get("x-rb-ai-model") || "").trim();
  const fallbackModel: AiModelId =
    legacyMode === "simple"
      ? "local"
      : context === "transcription"
        ? "gemini-3.5-transcribe"
        : legacyMode === "high"
          ? "gemini-3.8-flash"
          : legacyMode === "medium"
            ? "gemini-3.8-flash"
            : "gemini-2.5-flash-lite";

  const model = normalizeAiModel(rawModel || fallbackModel, context);
  const fallbackEffort = modelCapability(model).defaultEffort;

  return {
    model,
    effort: normalizeAiEffort(model, headers.get("x-rb-ai-effort") || fallbackEffort),
  };
}

export function modelPlanForSelection(
  selectedModel: AiModelId,
  legacyMode: AiLegacyMode,
  task: "standard" | "web" | "audio" = "standard"
) {
  if (selectedModel === "local") return [];

  if (selectedModel === "gemini-3.5-transcribe") {
    return task === "audio"
      ? ["gemini-3.5-transcribe", "gemini-3.8-flash", "gemini-2.5-flash", "gemini-2.5-flash-lite"]
      : ["gemini-3.8-flash", "gemini-2.5-flash", "gemini-2.5-flash-lite"];
  }

  // Search is intentionally free-first: 2.5 Flash/Lite currently have free Search grounding.
  if (task === "web") {
    return Array.from(new Set([
      selectedModel,
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
    ]));
  }

  if (task === "audio") {
    return Array.from(new Set([
      selectedModel,
      "gemini-3.5-transcribe",
      "gemini-3.8-flash",
      "gemini-3.5-flash-lite",
      "gemini-2.5-flash",
    ]));
  }

  const fallback =
    legacyMode === "high"
      ? ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-2.5-flash"]
      : legacyMode === "medium"
        ? ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash"]
        : ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-2.5-flash-lite", "gemini-2.5-flash"];

  return Array.from(new Set([selectedModel, ...fallback]));
}

export type AiContext = "general" | "transcription" | "chat";
export type AiProvider = "local" | "local-openai" | "gemini" | "openai" | "anthropic";

export type AiModelId =
  | "local"
  | "gemini-3.8-flash"
  | "gemini-3.7-flash"
  | "gemini-3.6-flash"
  | "gemini-3.5-flash"
  | "gemini-3.5-flash-lite"
  | "gemini-2.5-pro"
  | "gemini-2.5-flash"
  | "gemini-2.5-flash-lite"
  | "gemini-3.5-transcribe"
  | "openai:gpt-5.6-sol"
  | "openai:gpt-5.6-terra"
  | "openai:gpt-5.6-luna"
  | "anthropic:claude-fable-5"
  | "anthropic:claude-opus-5"
  | "anthropic:claude-sonnet-5"
  | "anthropic:claude-haiku-4-5-20251001"
  | `gemini-${string}`
  | `openai:${string}`
  | `anthropic:${string}`
  | `local-openai:${string}`;

export type AiEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max"
  | "off"
  | "dynamic";

export type AiSelection = {
  model: AiModelId;
  effort: AiEffort;
};

export type AiLegacyMode = "simple" | "instant" | "medium" | "high";

export type AiModelCapability = {
  id: AiModelId;
  provider: AiProvider;
  label: string;
  subtitle: string;
  contexts: AiContext[];
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
  { value: "low", label: "Low", hint: "Penalaran ringan" },
  { value: "medium", label: "Medium", hint: "Penalaran seimbang" },
  { value: "high", label: "High", hint: "Penalaran lebih dalam" },
];

const LEVEL_25_LITE: AiModelCapability["efforts"] = [
  { value: "none", label: "Default", hint: "Thinking default model" },
  { value: "low", label: "Low", hint: "Penalaran ringan" },
  { value: "medium", label: "Medium", hint: "Penalaran seimbang" },
  { value: "high", label: "High", hint: "Penalaran lebih dalam" },
];

const LEVEL_OPENAI_56: AiModelCapability["efforts"] = [
  { value: "none", label: "None", hint: "Tanpa reasoning tambahan" },
  { value: "low", label: "Low", hint: "Cepat dan hemat" },
  { value: "medium", label: "Medium", hint: "Seimbang" },
  { value: "high", label: "High", hint: "Reasoning dalam" },
  { value: "xhigh", label: "XHigh", hint: "Reasoning ekstra" },
  { value: "max", label: "Max", hint: "Kapasitas reasoning maksimum" },
];

const LEVEL_CLAUDE_OPUS_5: AiModelCapability["efforts"] = [
  { value: "low", label: "Low", hint: "Lebih cepat dan hemat" },
  { value: "medium", label: "Medium", hint: "Reasoning sedang" },
  { value: "high", label: "High", hint: "Default Claude Opus 5" },
  { value: "xhigh", label: "XHigh", hint: "Reasoning ekstra" },
  { value: "max", label: "Max", hint: "Reasoning maksimum" },
];

const LEVEL_CLAUDE_SONNET_5: AiModelCapability["efforts"] = [
  { value: "low", label: "Low", hint: "Lebih cepat dan hemat" },
  { value: "medium", label: "Medium", hint: "Reasoning sedang" },
  { value: "high", label: "High", hint: "Default Claude Sonnet 5" },
];

const LEVEL_CLAUDE_FABLE_5: AiModelCapability["efforts"] = [
  { value: "low", label: "Low", hint: "Lebih cepat dan hemat" },
  { value: "medium", label: "Medium", hint: "Reasoning sedang" },
  { value: "high", label: "High", hint: "Default Claude Fable 5" },
  { value: "xhigh", label: "XHigh", hint: "Untuk tugas paling berat" },
];

export const AI_MODEL_CATALOG: AiModelCapability[] = [
  {
    id: "local",
    provider: "local",
    label: "Local",
    subtitle: "Tanpa API · Database/browser",
    contexts: ["general", "transcription", "chat"],
    efforts: [],
    defaultEffort: "none",
    freeTier: true,
  },
  {
    id: "gemini-3.8-flash",
    provider: "gemini",
    label: "Gemini 3.8 Flash",
    subtitle: "Terbaru · Flash paling cerdas",
    contexts: ["general", "transcription", "chat"],
    efforts: LEVEL_3X_LMH,
    defaultEffort: "medium",
    freeTier: true,
  },
  {
    id: "gemini-3.7-flash",
    provider: "gemini",
    label: "Gemini 3.7 Flash",
    subtitle: "Cepat · multi-step stabil",
    contexts: ["general", "transcription", "chat"],
    efforts: LEVEL_3X_LMH,
    defaultEffort: "medium",
    freeTier: true,
  },
  {
    id: "gemini-3.6-flash",
    provider: "gemini",
    label: "Gemini 3.6 Flash",
    subtitle: "Multimodal · reasoning fleksibel",
    contexts: ["general", "transcription", "chat"],
    efforts: LEVEL_3X_ALL,
    defaultEffort: "medium",
    freeTier: true,
  },
  {
    id: "gemini-3.5-flash",
    provider: "gemini",
    label: "Gemini 3.5 Flash",
    subtitle: "Flash stabil · fallback kuat",
    contexts: ["general", "transcription", "chat"],
    efforts: LEVEL_3X_ALL,
    defaultEffort: "medium",
    freeTier: true,
  },
  {
    id: "gemini-3.5-flash-lite",
    provider: "gemini",
    label: "Gemini 3.5 Flash-Lite",
    subtitle: "Hemat · volume tinggi",
    contexts: ["general", "transcription", "chat"],
    efforts: LEVEL_3X_ALL,
    defaultEffort: "low",
    freeTier: true,
  },
  {
    id: "gemini-2.5-pro",
    provider: "gemini",
    label: "Gemini 2.5 Pro",
    subtitle: "Reasoning Pro · tugas kompleks",
    contexts: ["general", "transcription", "chat"],
    efforts: LEVEL_25,
    defaultEffort: "high",
    freeTier: true,
  },
  {
    id: "gemini-2.5-flash",
    provider: "gemini",
    label: "Gemini 2.5 Flash",
    subtitle: "Search grounding didukung · quota provider berlaku",
    contexts: ["general", "transcription", "chat"],
    efforts: LEVEL_25,
    defaultEffort: "medium",
    freeTier: true,
    freeWeb: true,
  },
  {
    id: "gemini-2.5-flash-lite",
    provider: "gemini",
    label: "Gemini 2.5 Flash-Lite",
    subtitle: "Paling hemat · Search grounding didukung",
    contexts: ["general", "transcription", "chat"],
    efforts: LEVEL_25_LITE,
    defaultEffort: "none",
    freeTier: true,
    freeWeb: true,
  },
  {
    id: "gemini-3.5-transcribe",
    provider: "gemini",
    label: "Gemini 3.5 Transcribe",
    subtitle: "Khusus speech-to-text · tanpa level",
    contexts: ["transcription"],
    efforts: [],
    defaultEffort: "none",
    freeTier: true,
  },
  {
    id: "openai:gpt-5.6-sol",
    provider: "openai",
    label: "GPT-5.6 Sol",
    subtitle: "OpenAI · kemampuan tertinggi",
    contexts: ["general", "chat"],
    efforts: LEVEL_OPENAI_56,
    defaultEffort: "medium",
    freeTier: false,
    freeWeb: false,
  },
  {
    id: "openai:gpt-5.6-terra",
    provider: "openai",
    label: "GPT-5.6 Terra",
    subtitle: "OpenAI · seimbang",
    contexts: ["general", "chat"],
    efforts: LEVEL_OPENAI_56,
    defaultEffort: "medium",
    freeTier: false,
    freeWeb: false,
  },
  {
    id: "openai:gpt-5.6-luna",
    provider: "openai",
    label: "GPT-5.6 Luna",
    subtitle: "OpenAI · hemat dan cepat",
    contexts: ["general", "chat"],
    efforts: LEVEL_OPENAI_56,
    defaultEffort: "low",
    freeTier: false,
    freeWeb: false,
  },
  {
    id: "anthropic:claude-fable-5",
    provider: "anthropic",
    label: "Claude Fable 5",
    subtitle: "Anthropic · kemampuan tertinggi",
    contexts: ["general", "chat"],
    efforts: LEVEL_CLAUDE_FABLE_5,
    defaultEffort: "high",
    freeTier: false,
    freeWeb: false,
  },
  {
    id: "anthropic:claude-opus-5",
    provider: "anthropic",
    label: "Claude Opus 5",
    subtitle: "Anthropic · reasoning mendalam",
    contexts: ["general", "chat"],
    efforts: LEVEL_CLAUDE_OPUS_5,
    defaultEffort: "high",
    freeTier: false,
    freeWeb: false,
  },
  {
    id: "anthropic:claude-sonnet-5",
    provider: "anthropic",
    label: "Claude Sonnet 5",
    subtitle: "Anthropic · seimbang",
    contexts: ["general", "chat"],
    efforts: LEVEL_CLAUDE_SONNET_5,
    defaultEffort: "high",
    freeTier: false,
    freeWeb: false,
  },
  {
    id: "anthropic:claude-haiku-4-5-20251001",
    provider: "anthropic",
    label: "Claude Haiku 4.5",
    subtitle: "Anthropic · cepat",
    contexts: ["general", "chat"],
    efforts: [],
    defaultEffort: "none",
    freeTier: false,
    freeWeb: false,
  },
];

export function modelCapability(model: AiModelId): AiModelCapability {
  if (model.startsWith("local-openai:")) {
    const localModel = model.slice("local-openai:".length) || "Local model";
    return { id:model, provider:"local-openai", label:localModel, subtitle:"Perangkat user · OpenAI-compatible", contexts:["chat"], efforts:[], defaultEffort:"none", freeTier:true, freeWeb:false };
  }
  const known = AI_MODEL_CATALOG.find((item) => item.id === model);
  if (known) return known;
  if (model.startsWith("openai:")) {
    const id=model.slice("openai:".length);
    return { id:model, provider:"openai", label:id, subtitle:"OpenAI · tersedia di account user", contexts:["chat"], efforts:[], defaultEffort:"none", freeTier:false, freeWeb:false };
  }
  if (model.startsWith("anthropic:")) {
    const id=model.slice("anthropic:".length);
    return { id:model, provider:"anthropic", label:id, subtitle:"Claude · tersedia di account user", contexts:["chat"], efforts:[], defaultEffort:"none", freeTier:false, freeWeb:false };
  }
  if (model.startsWith("gemini-")) {
    return { id:model, provider:"gemini", label:model.replace(/^gemini-/,"Gemini ").replaceAll("-"," "), subtitle:"Gemini · tersedia di provider aktif", contexts:["chat"], efforts:[], defaultEffort:"none", freeTier:true, freeWeb:false };
  }
  return AI_MODEL_CATALOG[0];
}

export function modelProvider(model: AiModelId): AiProvider {
  if (model.startsWith("local-openai:")) return "local-openai";
  if (model.startsWith("openai:")) return "openai";
  if (model.startsWith("anthropic:")) return "anthropic";
  if (model.startsWith("gemini-")) return "gemini";
  return modelCapability(model).provider;
}

export function providerModelId(model: AiModelId) {
  if (model.startsWith("openai:")) return model.slice("openai:".length);
  if (model.startsWith("anthropic:")) return model.slice("anthropic:".length);
  if (model.startsWith("local-openai:")) return model.slice("local-openai:".length);
  return model;
}

export function normalizeAiModel(value: unknown, context: AiContext = "general"): AiModelId {
  const candidate = String(value || "") as AiModelId;
  if (
    context !== "transcription" &&
    (candidate.startsWith("local-openai:") || candidate.startsWith("openai:") || candidate.startsWith("anthropic:") || candidate.startsWith("gemini-"))
  ) return candidate;
  const found = AI_MODEL_CATALOG.find((item) => item.id === candidate && item.contexts.includes(context));
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

export function defaultSelection(model: AiModelId, context: AiContext = "general"): AiSelection {
  const normalized = normalizeAiModel(model, context);
  return {
    model: normalized,
    effort: modelCapability(normalized).defaultEffort,
  };
}

export function selectionFromLegacyMode(
  mode: AiLegacyMode,
  context: AiContext = "general"
): AiSelection {
  if (mode === "simple") return defaultSelection("local", context);
  if (context === "transcription") return defaultSelection("gemini-3.5-transcribe", context);
  if (mode === "high") return { model: "gemini-3.8-flash", effort: "high" };
  if (mode === "medium") return { model: "gemini-3.8-flash", effort: "medium" };
  return { model: "gemini-2.5-flash-lite", effort: "none" };
}

export function legacyModeForSelection(selection: AiSelection): AiLegacyMode {
  if (selection.model === "local") return "simple";
  if (selection.effort === "high" || selection.effort === "xhigh" || selection.effort === "max") return "high";
  if (selection.effort === "medium" || selection.effort === "dynamic") return "medium";
  return "instant";
}

export function thinkingConfigForModel(model: string, effort: AiEffort) {
  if (!model.startsWith("gemini-")) return undefined;
  if (model === "gemini-3.5-transcribe" || model.includes("-live")) return undefined;

  if (model.startsWith("gemini-3")) {
    const noMinimal = model === "gemini-3.8-flash" || model === "gemini-3.7-flash";
    const requested =
      effort === "minimal" || effort === "low" || effort === "medium" || effort === "high"
        ? effort
        : undefined;
    const level = noMinimal && requested === "minimal" ? "low" : requested;
    return level ? { thinkingLevel: level } : undefined;
  }

  if (model.startsWith("gemini-2.5")) {
    if (effort === "none" && model === "gemini-2.5-flash-lite") return undefined;
    const normalized = effort === "high" ? "high" : effort === "medium" ? "medium" : "low";
    const budget = normalized === "low" ? 1024 : normalized === "medium" ? 8192 : 24576;
    return { thinkingBudget: budget };
  }

  return undefined;
}

export function selectionFromHeaders(
  headers: Headers,
  context: AiContext,
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
  if (modelProvider(selectedModel) !== "gemini") return [providerModelId(selectedModel)];

  if (selectedModel === "gemini-3.5-transcribe") {
    return task === "audio"
      ? ["gemini-3.5-transcribe", "gemini-3.8-flash", "gemini-2.5-flash", "gemini-2.5-flash-lite"]
      : ["gemini-3.8-flash", "gemini-2.5-flash", "gemini-2.5-flash-lite"];
  }

  if (task === "web") {
    return Array.from(new Set([selectedModel, "gemini-2.5-flash", "gemini-2.5-flash-lite"]));
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
        : ["gemini-3.5-flash-lite", "gemini-2.5-flash-lite", "gemini-2.5-flash"];

  return Array.from(new Set([selectedModel, ...fallback]));
}

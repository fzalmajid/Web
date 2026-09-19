import type { SupabaseClient } from "@supabase/supabase-js";

export type AiAction =
  | "ask"
  | "ask_web"
  | "study"
  | "transcription"
  | "file_light"
  | "file_heavy";

export type AiMode = "simple" | "instant" | "medium" | "high";

export type AiUsage = {
  allowed: boolean;
  mode: AiMode;
  cost: number;
  used: number;
  limit: number;
  remaining: number;
  reset_timezone: string;
};

export function normalizeAiMode(value: unknown): AiMode {
  if (value === "simple" || value === "medium" || value === "high") return value;
  return "instant";
}

export function aiModeLabel(mode: AiMode) {
  if (mode === "simple") return "Simple";
  if (mode === "high") return "High";
  if (mode === "medium") return "Medium";
  return "Instant";
}

export function getAiCreditCost(action: AiAction, mode: AiMode) {
  if (mode === "simple") return 0;
  const table: Record<Exclude<AiAction, never>, Record<Exclude<AiMode, "simple">, number>> = {
    ask: { instant: 1, medium: 2, high: 4 },
    ask_web: { instant: 3, medium: 5, high: 8 },
    study: { instant: 2, medium: 4, high: 6 },
    transcription: { instant: 5, medium: 7, high: 10 },
    file_light: { instant: 2, medium: 3, high: 5 },
    file_heavy: { instant: 5, medium: 7, high: 10 },
  };
  return table[action][mode];
}

export async function checkAiCredits(
  supabase: SupabaseClient,
  action: AiAction,
  mode: AiMode
): Promise<AiUsage> {
  const { data, error } = await supabase.rpc("get_ai_usage_today");
  if (error) throw error;
  const cost = getAiCreditCost(action, mode);
  const used = Number(data?.used ?? 0);
  const limit = Number(data?.limit ?? 40);
  const remaining = Number(data?.remaining ?? Math.max(limit - used, 0));
  return {
    allowed: remaining >= cost,
    mode,
    cost,
    used,
    limit,
    remaining,
    reset_timezone: String(data?.reset_timezone ?? "Asia/Jakarta"),
  };
}

export function aiModeInstruction(mode: AiMode) {
  if (mode === "high") {
    return "Mode High: teliti seluruh konteks yang relevan, hubungkan beberapa bagian database bila perlu, cek konsistensi istilah, dan berikan hasil paling lengkap namun tetap hanya berdasarkan sumber.";
  }
  if (mode === "medium") {
    return "Mode Medium: jawab dengan penjelasan cukup mendalam, hubungkan konteks yang relevan, dan tetap ringkas bila fakta sudah jelas.";
  }
  if (mode === "simple") {
    return "Mode Simple harus diproses tanpa Gemini.";
  }
  return "Mode Instant: utamakan jawaban cepat, langsung, singkat, dan hanya ambil fakta yang paling relevan.";
}

export async function consumeAiCredits(
  supabase: SupabaseClient,
  action: AiAction,
  mode: AiMode = "instant"
): Promise<AiUsage> {
  if (mode === "simple") {
    const { data, error } = await supabase.rpc("get_ai_usage_today");
    if (error) throw error;
    return {
      allowed: true,
      mode: "simple",
      cost: 0,
      used: Number(data?.used ?? 0),
      limit: Number(data?.limit ?? 40),
      remaining: Number(data?.remaining ?? 40),
      reset_timezone: String(data?.reset_timezone ?? "Asia/Jakarta"),
    };
  }

  const { data, error } = await supabase.rpc("consume_ai_credits", {
    action_name: action,
    ai_mode: mode,
  });
  if (error) throw error;
  return data as AiUsage;
}

export function aiQuotaError(usage: AiUsage) {
  return {
    error:
      "Credit AI hari ini tidak cukup untuk mode " +
      aiModeLabel(usage.mode) +
      ". Sisa " +
      usage.remaining +
      "/" +
      usage.limit +
      " credit. Reset 00.00 WIB.",
    aiUsage: usage,
  };
}

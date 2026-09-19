import type { SupabaseClient } from "@supabase/supabase-js";

export type AiAction =
  | "ask"
  | "study"
  | "transcription"
  | "file_light"
  | "file_heavy";

export type AiUsage = {
  allowed: boolean;
  cost: number;
  used: number;
  limit: number;
  remaining: number;
  reset_timezone: string;
};

export async function consumeAiCredits(
  supabase: SupabaseClient,
  action: AiAction
): Promise<AiUsage> {
  const { data, error } = await supabase.rpc("consume_ai_credits", {
    action_name: action,
  });
  if (error) throw error;
  return data as AiUsage;
}

export function aiQuotaError(usage: AiUsage) {
  return {
    error: "Kuota AI hari ini habis. Coba lagi setelah 00.00 WIB.",
    aiUsage: usage,
  };
}

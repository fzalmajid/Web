export type GeminiUsageProvider =
  | "shared-api-key"
  | "user-api-key"
  | "user-google-oauth";

export type GeminiUserAuth = {
  ownGemini: boolean;
  provider: GeminiUsageProvider;
  apiKey?: string;
  accessToken?: string;
  projectId?: string;
};

export function geminiUserAuthFromHeaders(headers: Headers): GeminiUserAuth {
  const accessToken = String(headers.get("x-rb-google-access-token") || "").trim();
  const projectId = String(headers.get("x-rb-google-project") || "").trim();
  const apiKey = String(headers.get("x-rb-gemini-key") || "").trim();

  if (accessToken && projectId) {
    return {
      ownGemini: true,
      provider: "user-google-oauth",
      accessToken,
      projectId,
    };
  }

  if (apiKey) {
    return {
      ownGemini: true,
      provider: "user-api-key",
      apiKey,
    };
  }

  return {
    ownGemini: false,
    provider: "shared-api-key",
  };
}

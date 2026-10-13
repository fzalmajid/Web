export const INITIAL_SESSION_ERROR = "Sesi belum dapat diperiksa. Silakan coba masuk lagi atau muat ulang halaman.";

type SessionResult<T> = { data: { session: T | null }; error?: { message: string } | null };

/** Provider failures must release the login screen without inventing a session. */
export async function readInitialAuthSession<T>(getSession: () => Promise<SessionResult<T>>) {
  try {
    const result = await getSession();
    if (result.error) return { session: null, error: INITIAL_SESSION_ERROR };
    return { session: result.data.session, error: "" };
  } catch {
    return { session: null, error: INITIAL_SESSION_ERROR };
  }
}

/** The managed SDK sends popup completion to its opener during initialization. */
export async function finishAuthCallback<T>(search: string, getSession: () => Promise<SessionResult<T>>) {
  if (new URLSearchParams(search).get("neon_popup") === "1") {
    return { status: "popup" as const, error: "" };
  }
  const result = await readInitialAuthSession(getSession);
  if (!result.session) {
    return { status: "error" as const, error: result.error || "Login belum selesai. Silakan kembali dan coba masuk lagi." };
  }
  return { status: "ready" as const, error: "" };
}

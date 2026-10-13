import type { User } from "@supabase/supabase-js";

/** Authenticate every server request through the managed provider's verifier. */
export function delegatedServerAuth(token: string, verify: (value: string) => Promise<User>) {
  return {
    async getUser() {
      try { return { data: { user: await verify(token) }, error: null }; }
      catch { return { data: { user: null }, error: new Error("Sesi tidak valid.") }; }
    },
  };
}

/** OAuth is delegated to the provider; this never creates a local session. */
export async function delegatedGoogleSignIn(
  auth: {
    signInWithOAuth: (input: { provider: "google"; options: { redirectTo: string } }) => Promise<{ error: { message: string } | null }>;
    getBetterAuthInstance?: () => { signIn: { social: (input: { provider: "google"; callbackURL: string }) => Promise<{ error: { message: string } | null }> } };
  },
  redirectTo: string
) {
  // The current compatibility adapter discards social sign-in error results.
  // Use its native managed client so provider failures remain visible.
  const result = auth.getBetterAuthInstance
    ? await auth.getBetterAuthInstance().signIn.social({ provider: "google", callbackURL: redirectTo })
    : await auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
  if (result.error) throw new Error(result.error.message);
}

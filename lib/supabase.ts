import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createClient as createNeonClient, SupabaseAuthAdapter } from "@neondatabase/neon-js";
import { createAppStorage } from "./appStorage";
import { USING_NEON, browserAuthProxyUrl, requireNeonDataApiUrl } from "./dataBackend";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./config";

export { USING_NEON } from "./dataBackend";

const unsupportedFunctions = {
  async invoke() {
    return { data: null, error: new Error("Fungsi layanan lama tidak tersedia pada penyimpanan baru.") };
  },
};

function createBrowserClient(): SupabaseClient {
  if (!USING_NEON) return createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  const client = createNeonClient({
    auth: { url: browserAuthProxyUrl(), adapter: SupabaseAuthAdapter({ fetchOptions: { credentials: "include" } }) },
    dataApi: { url: requireNeonDataApiUrl() },
  });
  const storage = createAppStorage(async () => {
    const { data, error } = await client.auth.getSession();
    if (error || !data.session?.access_token) throw new Error("Login diperlukan.");
    return data.session.access_token;
  });
  // Preserve the shared query/auth interface; unsupported legacy APIs fail closed.
  return Object.assign(client, { storage, functions: unsupportedFunctions }) as unknown as SupabaseClient;
}

export const supabase = createBrowserClient();

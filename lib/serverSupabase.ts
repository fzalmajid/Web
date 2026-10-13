import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createClient as createNeonClient } from "@neondatabase/neon-js";
import { createServerAppStorage } from "./appStorageServer";
import { DATA_BACKEND, requireNeonDataApiUrl } from "./dataBackend";
import { delegatedServerAuth } from "./authDelegation";
import { verifyNeonToken } from "./neonAuthToken";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./config";

/** Server access remains scoped to the verified user's JWT, including RLS. */
export function createServerSupabase(accessToken: string): SupabaseClient {
  if (DATA_BACKEND !== "neondb") return createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const getToken = async () => { await verifyNeonToken(accessToken); return accessToken; };
  const client = createNeonClient({
    dataApi: { url: requireNeonDataApiUrl(), getToken },
  });
  return Object.assign(client, {
    auth: delegatedServerAuth(accessToken, verifyNeonToken),
    storage: createServerAppStorage(getToken),
    functions: { async invoke() { return { data: null, error: new Error("Fungsi layanan lama tidak tersedia pada penyimpanan baru.") }; } },
  }) as unknown as SupabaseClient;
}

import { createNeonAuth } from "@neondatabase/auth/next/server";
import { requireNeonAuthUrl } from "./dataBackend";

let auth: ReturnType<typeof createNeonAuth> | undefined;

/** Lazy creation keeps legacy deployments buildable before Neon is configured. */
export function getNeonAuthServer() {
  if (auth) return auth;
  const secret = process.env.NEON_AUTH_COOKIE_SECRET;
  if (!secret || secret.length < 32) throw new Error("Konfigurasi cookie login belum tersedia.");
  auth = createNeonAuth({
    baseUrl: requireNeonAuthUrl(),
    cookies: { secret, sameSite: "lax" },
  });
  return auth;
}

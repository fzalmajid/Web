export type DataBackend = "supabase" | "neondb";

/** A missing flag preserves the current backend until migration is ready. */
export function resolveDataBackend(value?: string): DataBackend {
  if (!value || value === "supabase") return "supabase";
  if (value === "neondb") return "neondb";
  throw new Error("Konfigurasi penyimpanan tidak dikenali.");
}

export const DATA_BACKEND = resolveDataBackend(
  typeof window === "undefined"
    ? process.env.DATA_BACKEND || process.env.NEXT_PUBLIC_DATA_BACKEND
    : process.env.NEXT_PUBLIC_DATA_BACKEND
);

export const USING_NEON = DATA_BACKEND === "neondb";

export function requireNeonAuthUrl() {
  const value = process.env.NEON_AUTH_BASE_URL || process.env.NEXT_PUBLIC_NEON_AUTH_URL;
  if (!value) throw new Error("Layanan login baru belum dikonfigurasi.");
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Layanan login harus menggunakan HTTPS.");
  return url.toString().replace(/\/$/, "");
}

export function requireNeonDataApiUrl() {
  const value = process.env.NEON_DATA_API_URL || process.env.NEXT_PUBLIC_NEON_DATA_API_URL;
  if (!value) throw new Error("Penyimpanan baru belum dikonfigurasi.");
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Penyimpanan harus menggunakan HTTPS.");
  return url.toString().replace(/\/$/, "");
}

/** Browsers use the app's cookie proxy rather than third-party auth cookies. */
export function browserAuthProxyUrl() {
  if (typeof window !== "undefined") return window.location.origin + "/api/auth";
  return (process.env.NEXT_PUBLIC_APP_URL || "https://web-fzalmajid.vercel.app").replace(/\/$/, "") + "/api/auth";
}

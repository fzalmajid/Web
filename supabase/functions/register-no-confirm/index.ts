import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const APP_ORIGIN = "https://web-fzalmajid.vercel.app";
const ALLOWED_ORIGINS = new Set([
  APP_ORIGIN,
  "https://web-sigma-nine-23.vercel.app",
  "https://web-git-main-fzalmajid.vercel.app",
]);

function cors(origin: string | null) {
  const allowed = origin && ALLOWED_ORIGINS.has(origin) ? origin : APP_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
    "Vary": "Origin",
  };
}

function json(body: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), { status, headers: cors(origin) });
}

async function sha256(value: string) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}


Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405, origin);
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ error: "Origin tidak diizinkan." }, 403, origin);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Request tidak valid." }, 400, origin);
  }

  const email = String(body?.email || "").trim().toLowerCase();
  const password = String(body?.password || "");

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "Email tidak valid." }, 400, origin);
  }
  if (password.length < 6 || password.length > 128) {
    return json({ error: "Password harus 6–128 karakter." }, 400, origin);
  }

  const url = Deno.env.get("SUPABASE_URL");
  // supabase-js admin works reliably with the legacy JWT service-role key.
  // Hosted Edge Functions still expose it; never send it to the browser.
  let secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!secret) {
    try {
      const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
      secret = String(keys.default || "");
    } catch {}
  }
  if (!url || !secret) {
    return json({ error: "Konfigurasi server Auth belum lengkap." }, 500, origin);
  }

  const admin = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Public signup intentionally has no email-confirmation step, so enforce
  // server-side abuse limits before using the admin createUser API.
  const forwarded = req.headers.get("x-forwarded-for") || "";
  const remoteIp = (forwarded.split(",")[0] || req.headers.get("x-real-ip") || "unknown").trim();
  const [ipHash, emailHash] = await Promise.all([
    sha256("ip:" + remoteIp),
    sha256("email:" + email),
  ]);
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const staleBefore = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  // Best-effort bounded housekeeping; signup should not fail only because cleanup fails.
  await admin.from("auth_signup_rate_limits").delete().lt("created_at", staleBefore);

  const [ipWindow, emailWindow] = await Promise.all([
    admin.from("auth_signup_rate_limits")
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash)
      .gte("created_at", since),
    admin.from("auth_signup_rate_limits")
      .select("id", { count: "exact", head: true })
      .eq("email_hash", emailHash)
      .gte("created_at", since),
  ]);

  if (ipWindow.error || emailWindow.error) {
    return json({ error: "Proteksi pendaftaran sementara tidak tersedia. Coba lagi." }, 503, origin);
  }
  if (Number(ipWindow.count || 0) >= 12 || Number(emailWindow.count || 0) >= 5) {
    return json({
      error: "Terlalu banyak percobaan pendaftaran. Coba lagi nanti.",
      code: "RATE_LIMITED",
    }, 429, origin);
  }

  const attempt = await admin.from("auth_signup_rate_limits").insert({
    ip_hash: ipHash,
    email_hash: emailHash,
  });
  if (attempt.error) {
    return json({ error: "Proteksi pendaftaran gagal menyimpan percobaan." }, 503, origin);
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error) {
    const message = String(error.message || "");
    const exists = /already|registered|exists|duplicate/i.test(message);
    if (exists) {
      return json({
        error: "Email sudah terdaftar. Gunakan Masuk, atau pilih Google jika akun tersebut terhubung ke Google.",
        code: "ALREADY_REGISTERED",
      }, 409, origin);
    }
    return json({ error: message || "Gagal membuat akun." }, 400, origin);
  }

  return json({ ok: true, userId: data.user?.id || null }, 200, origin);
});

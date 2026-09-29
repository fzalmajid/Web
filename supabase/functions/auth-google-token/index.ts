import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const APP_ORIGIN = "https://web-fzalmajid.vercel.app";
const ALLOWED_ORIGINS = new Set([
  APP_ORIGIN,
  "https://web-sigma-nine-23.vercel.app",
  "https://web-git-main-fzalmajid.vercel.app",
]);
const GOOGLE_CLIENT_ID = "42957287889-qgsdslbqcipbuatleep800hjb8na9s25.apps.googleusercontent.com";

function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.has(origin) ? origin : APP_ORIGIN,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
    "Vary": "Origin",
  };
}
function json(body: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), { status, headers: cors(origin) });
}
function secretKey() {
  // Prefer the JWT service-role key with supabase-js admin. It remains server-only.
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    if (keys.default) return String(keys.default);
  } catch {}
  return "";
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405, origin);
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ error: "Origin tidak diizinkan." }, 403, origin);

  let body: any;
  try { body = await req.json(); } catch {
    return json({ error: "Request tidak valid." }, 400, origin);
  }
  const accessToken = String(body?.accessToken || "").trim();
  if (!accessToken || accessToken.length > 4096) {
    return json({ error: "Token Google tidak valid." }, 400, origin);
  }

  const tokenInfoResponse = await fetch(
    "https://oauth2.googleapis.com/tokeninfo?access_token=" + encodeURIComponent(accessToken),
    { headers: { "Accept": "application/json" } }
  );
  if (!tokenInfoResponse.ok) {
    return json({ error: "Token Google sudah tidak valid atau kedaluwarsa." }, 401, origin);
  }
  const tokenInfo: any = await tokenInfoResponse.json();
  const audience = String(tokenInfo.aud || tokenInfo.audience || tokenInfo.issued_to || "");
  if (audience !== GOOGLE_CLIENT_ID) {
    return json({ error: "Token Google bukan untuk Ruang Belajar." }, 401, origin);
  }

  const profileResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { "Authorization": "Bearer " + accessToken, "Accept": "application/json" },
  });
  if (!profileResponse.ok) {
    return json({ error: "Profil Google tidak dapat diverifikasi." }, 401, origin);
  }
  const profile: any = await profileResponse.json();
  const email = String(profile.email || tokenInfo.email || "").trim().toLowerCase();
  const verified =
    profile.email_verified === true ||
    profile.email_verified === "true" ||
    tokenInfo.email_verified === true ||
    tokenInfo.email_verified === "true" ||
    tokenInfo.verified_email === true ||
    tokenInfo.verified_email === "true";

  if (!email || !verified) {
    return json({ error: "Google belum memverifikasi email akun ini." }, 403, origin);
  }

  const url = Deno.env.get("SUPABASE_URL") || "";
  const secret = secretKey();
  if (!url || !secret) return json({ error: "Konfigurasi Auth server belum lengkap." }, 500, origin);

  const admin = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let user: any = null;
  for (let page = 1; page <= 5 && !user; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return json({ error: "Gagal memeriksa akun." }, 500, origin);
    user = (data.users || []).find((item: any) =>
      String(item.email || "").toLowerCase() === email
    ) || null;
    if ((data.users || []).length < 200) break;
  }

  if (!user) {
    const randomPassword = crypto.randomUUID() + crypto.randomUUID();
    const created = await admin.auth.admin.createUser({
      email,
      password: randomPassword,
      email_confirm: true,
      user_metadata: {
        full_name: String(profile.name || "").slice(0, 160),
        avatar_url: String(profile.picture || "").slice(0, 500),
        google_sub: String(profile.sub || "").slice(0, 160),
        auth_source: "google-verified",
      },
    });
    if (created.error || !created.data.user) {
      return json({ error: created.error?.message || "Gagal membuat akun Google." }, 400, origin);
    }
    user = created.data.user;
  } else if (!user.email_confirmed_at) {
    const updated = await admin.auth.admin.updateUserById(user.id, {
      email_confirm: true,
      user_metadata: {
        ...(user.user_metadata || {}),
        full_name: String(profile.name || user.user_metadata?.full_name || "").slice(0, 160),
        avatar_url: String(profile.picture || user.user_metadata?.avatar_url || "").slice(0, 500),
        google_sub: String(profile.sub || "").slice(0, 160),
        auth_source: "google-verified",
      },
    });
    if (updated.error) return json({ error: "Gagal mengaktifkan akun Google." }, 500, origin);
  }

  const link = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (link.error || !link.data?.properties?.hashed_token) {
    return json({ error: link.error?.message || "Gagal membuat sesi Google." }, 500, origin);
  }

  return json({
    ok: true,
    tokenHash: link.data.properties.hashed_token,
  }, 200, origin);
});

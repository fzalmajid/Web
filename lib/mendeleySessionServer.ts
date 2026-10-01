import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";

export const MENDELEY_SESSION_COOKIE = "rb_mendeley_session";

export type MendeleyOAuthSession = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
};

function encryptionKey() {
  const secret = String(process.env.MENDELEY_CLIENT_SECRET || "").trim();
  if (!secret) return null;
  return createHash("sha256")
    .update("ruang-belajar:mendeley-session:" + secret)
    .digest();
}

export function sealMendeleySession(session: MendeleyOAuthSession) {
  const key = encryptionKey();
  if (!key) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(session), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function openMendeleySession(value: string | undefined | null): MendeleyOAuthSession | null {
  if (!value) return null;
  const key = encryptionKey();
  if (!key) return null;
  try {
    const [ivRaw, tagRaw, encryptedRaw] = value.split(".");
    if (!ivRaw || !tagRaw || !encryptedRaw) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivRaw, "base64url"));
    decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedRaw, "base64url")),
      decipher.final(),
    ]);
    const parsed = JSON.parse(decrypted.toString("utf8"));
    const accessToken = String(parsed?.accessToken || "");
    const refreshToken = parsed?.refreshToken ? String(parsed.refreshToken) : null;
    const expiresAt = Number(parsed?.expiresAt || 0);
    if (!accessToken || !Number.isFinite(expiresAt)) return null;
    return { accessToken, refreshToken, expiresAt };
  } catch {
    return null;
  }
}

function redirectUri() {
  return String(
    process.env.MENDELEY_REDIRECT_URI ||
    "https://web-fzalmajid.vercel.app/api/mendeley/callback"
  ).trim();
}

async function refreshSession(session: MendeleyOAuthSession): Promise<MendeleyOAuthSession | null> {
  if (!session.refreshToken) return null;
  const clientId = String(process.env.MENDELEY_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.MENDELEY_CLIENT_SECRET || "").trim();
  if (!clientId || !clientSecret) return null;

  const basic = Buffer.from(clientId + ":" + clientSecret).toString("base64");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: session.refreshToken,
    redirect_uri: redirectUri(),
  });

  try {
    const response = await fetch("https://api.mendeley.com/oauth/token", {
      method: "POST",
      headers: {
        Authorization: "Basic " + basic,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const data = await response.json().catch(() => null) as any;
    const accessToken = String(data?.access_token || "");
    if (!accessToken) return null;
    return {
      accessToken,
      refreshToken: String(data?.refresh_token || session.refreshToken || "") || null,
      expiresAt: Date.now() + Math.max(300, Number(data?.expires_in) || 3600) * 1000,
    };
  } catch {
    return null;
  }
}

export async function getFreshMendeleySession(req: NextRequest) {
  if (process.env.ENABLE_LEGACY_MENDELEY !== "true") {
    return { session: null, connected: false, cookieValue: null };
  }
  const raw = req.cookies.get(MENDELEY_SESSION_COOKIE)?.value || "";
  const existing = openMendeleySession(raw);
  if (!existing) {
    return {
      connected: false,
      session: null as MendeleyOAuthSession | null,
      refreshed: false,
      cookieValue: null as string | null,
    };
  }

  if (existing.expiresAt > Date.now() + 2 * 60 * 1000) {
    return {
      connected: true,
      session: existing,
      refreshed: false,
      cookieValue: null as string | null,
    };
  }

  const refreshed = await refreshSession(existing);
  if (!refreshed) {
    return {
      connected: false,
      session: null as MendeleyOAuthSession | null,
      refreshed: false,
      cookieValue: null as string | null,
    };
  }
  return {
    connected: true,
    session: refreshed,
    refreshed: true,
    cookieValue: sealMendeleySession(refreshed),
  };
}

export function setMendeleySessionCookie(
  response: NextResponse,
  sealed: string,
  maxAge = 60 * 60 * 24 * 180
) {
  response.cookies.set(MENDELEY_SESSION_COOKIE, sealed, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge,
  });
}

export function clearMendeleySessionCookie(response: NextResponse) {
  response.cookies.set(MENDELEY_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

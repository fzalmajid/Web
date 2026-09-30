import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { sealMendeleySession, setMendeleySessionCookie } from "@/lib/mendeleySessionServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sign(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string) {
  try {
    const aa = Buffer.from(a);
    const bb = Buffer.from(b);
    return aa.length === bb.length && timingSafeEqual(aa, bb);
  } catch {
    return false;
  }
}

function finish(url: URL, status: "success" | "failed", reason?: string, returnTo = "/") {
  let redirect: URL;
  try {
    const candidate = new URL(returnTo || "/", url.origin);
    redirect = candidate.origin === url.origin ? candidate : new URL("/", url.origin);
  } catch {
    redirect = new URL("/", url.origin);
  }
  redirect.searchParams.set("mendeley", status);
  if (reason) redirect.searchParams.set("mendeley_reason", reason);
  const response = NextResponse.redirect(redirect);
  response.cookies.set("rb_mendeley_oauth_state", "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/mendeley",
    maxAge: 0,
  });
  return response;
}

export async function GET(req: NextRequest) {
  const clientId = String(process.env.MENDELEY_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.MENDELEY_CLIENT_SECRET || "").trim();
  const redirectUri = String(
    process.env.MENDELEY_REDIRECT_URI ||
    "https://web-fzalmajid.vercel.app/api/mendeley/callback"
  ).trim();

  if (!clientId || !clientSecret) return finish(req.nextUrl, "failed", "missing_config");

  const error = req.nextUrl.searchParams.get("error");
  if (error) return finish(req.nextUrl, "failed", "authorize_" + error);

  const code = String(req.nextUrl.searchParams.get("code") || "");
  const state = String(req.nextUrl.searchParams.get("state") || "");
  const cookieState = String(req.cookies.get("rb_mendeley_oauth_state")?.value || "");
  if (!code || !state || !cookieState || !safeEqual(state, cookieState)) {
    return finish(req.nextUrl, "failed", "state_mismatch");
  }

  const dot = state.lastIndexOf(".");
  if (dot <= 0) return finish(req.nextUrl, "failed", "invalid_state");
  const payload = state.slice(0, dot);
  const signature = state.slice(dot + 1);
  if (!safeEqual(signature, sign(payload, clientSecret))) {
    return finish(req.nextUrl, "failed", "invalid_state_signature");
  }

  let returnTo = "/";
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const age = Date.now() - Number(decoded?.ts || 0);
    if (!Number.isFinite(age) || age < 0 || age > 10 * 60 * 1000) {
      return finish(req.nextUrl, "failed", "expired_state");
    }
    const requested = String(decoded?.returnTo || "/");
    returnTo = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/";
  } catch {
    return finish(req.nextUrl, "failed", "invalid_state_payload");
  }

  const basic = Buffer.from(clientId + ":" + clientSecret).toString("base64");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });

  let tokenResponse: Response;
  try {
    tokenResponse = await fetch("https://api.mendeley.com/oauth/token", {
      method: "POST",
      headers: {
        Authorization: "Basic " + basic,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
      cache: "no-store",
    });
  } catch {
    return finish(req.nextUrl, "failed", "token_network_error");
  }

  const tokenJson = await tokenResponse.json().catch(() => null) as any;
  const accessToken = String(tokenJson?.access_token || "");
  if (!tokenResponse.ok || !accessToken) {
    return finish(
      req.nextUrl,
      "failed",
      tokenResponse.status === 401 ? "secret_rejected_on_code_exchange" :
      tokenResponse.status === 400 ? "invalid_grant_or_redirect" :
      "token_exchange_failed_" + tokenResponse.status,
      returnTo
    );
  }

  const sealed = sealMendeleySession({
    accessToken,
    refreshToken: String(tokenJson?.refresh_token || "") || null,
    expiresAt: Date.now() + Math.max(300, Number(tokenJson?.expires_in) || 3600) * 1000,
  });
  if (!sealed) {
    return finish(req.nextUrl, "failed", "session_encryption_failed", returnTo);
  }

  const response = finish(req.nextUrl, "success", "authorization_code_exchange_ok", returnTo);
  setMendeleySessionCookie(response, sealed);
  return response;
}

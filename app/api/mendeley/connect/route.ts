import { NextRequest, NextResponse } from "next/server";
import { createHmac, randomBytes } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function base64url(value: string) {
  return Buffer.from(value).toString("base64url");
}

function sign(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export async function GET(req: NextRequest) {
  const clientId = String(process.env.MENDELEY_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.MENDELEY_CLIENT_SECRET || "").trim();
  const redirectUri = String(
    process.env.MENDELEY_REDIRECT_URI ||
    "https://web-fzalmajid.vercel.app/api/mendeley/callback"
  ).trim();

  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "Mendeley belum dikonfigurasi." }, { status: 503 });
  }

  const now = Date.now();
  const nonce = randomBytes(18).toString("base64url");
  const payloadObject = {
    ts: now,
    nonce,
    returnTo: req.nextUrl.searchParams.get("returnTo") || "/",
  };
  const payload = base64url(JSON.stringify(payloadObject));
  const state = payload + "." + sign(payload, clientSecret);

  const url = new URL("https://api.mendeley.com/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "all");
  url.searchParams.set("state", state);

  const response = NextResponse.redirect(url);
  response.cookies.set("rb_mendeley_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/mendeley",
    maxAge: 10 * 60,
  });
  return response;
}

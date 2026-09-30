import { NextRequest, NextResponse } from "next/server";
import { getFreshMendeleySession, setMendeleySessionCookie } from "@/lib/mendeleySessionServer";
import { mendeleyConfigured } from "@/lib/referenceMetadataServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getFreshMendeleySession(req);
  const response = NextResponse.json({
    configured: mendeleyConfigured(),
    connected: session.connected,
    expiresAt: session.session?.expiresAt || null,
  }, {
    headers: { "Cache-Control": "no-store" },
  });
  if (session.cookieValue) setMendeleySessionCookie(response, session.cookieValue);
  return response;
}

import { NextResponse } from "next/server";
import { clearMendeleySessionCookie } from "@/lib/mendeleySessionServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const response = NextResponse.json({ connected: false }, {
    headers: { "Cache-Control": "no-store" },
  });
  clearMendeleySessionCookie(response);
  return response;
}

import { NextResponse } from "next/server";
import { testMendeleyCatalogConnection } from "@/lib/referenceMetadataServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const mendeley = await testMendeleyCatalogConnection();
  return NextResponse.json({
    mendeley,
    checkedAt: new Date().toISOString(),
  }, {
    headers: { "Cache-Control": "no-store" },
  });
}

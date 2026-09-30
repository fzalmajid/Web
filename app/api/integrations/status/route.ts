import { NextResponse } from "next/server";
import { testMendeleyCatalogConnection } from "@/lib/referenceMetadataServer";
import { openAlexConfigured, openAlexHasApiKey } from "@/lib/scholarlySources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const mendeley = await testMendeleyCatalogConnection();
  return NextResponse.json({
    mendeley,
    scholarly: {
      openAlex: { configured: openAlexConfigured(), publicApi: true, apiKeyOptional: true, hasApiKey: openAlexHasApiKey() },
      europePmc: { configured: true, publicApi: true },
      pubMed: { configured: true, publicApi: true, apiKeyOptional: true },
      crossref: { configured: true, publicApi: true },
      dataCite: { configured: true, publicApi: true },
      openLibrary: { configured: true, publicApi: true },
    },
    learning: {
      hybridRag: true,
      katexMhchem: true,
      fsrs: true,
      localOcrWithGeminiFallback: true,
    },
    checkedAt: new Date().toISOString(),
  }, {
    headers: { "Cache-Control": "no-store" },
  });
}

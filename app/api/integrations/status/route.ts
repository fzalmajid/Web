import { NextRequest, NextResponse } from "next/server";
import { REFERENCE_CAPABILITIES } from "@/lib/referencePipelineServer";
import { openAlexConfigured, openAlexHasApiKey } from "@/lib/scholarlySources";
import { verifyReferenceEngine } from "@/lib/referenceHealthServer";
import { aiCouncilPlan } from "@/lib/aiOrchestration";
import { openRouterFreeStatus } from "@/lib/openRouterFree";
import { webResearchStatus } from "@/lib/webResearch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

export async function GET(req: NextRequest) {
  const verification = req.nextUrl.searchParams.get("verify") === "1" ? await verifyReferenceEngine() : undefined;
  return NextResponse.json({
    referenceEngine: REFERENCE_CAPABILITIES,
    verification,
    deployment: { commit: process.env.VERCEL_GIT_COMMIT_SHA || null },
    mendeley: { enabled: process.env.ENABLE_LEGACY_MENDELEY === "true", required: false, legacyOnly: true },
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
    orchestration: {
      normalModes: ["simple", "instant", "medium", "high"],
      plans: {
        simple: aiCouncilPlan("simple", false),
        instant: aiCouncilPlan("instant", false),
        medium: aiCouncilPlan("medium", false),
        high: aiCouncilPlan("high", true),
      },
      freeHelper: openRouterFreeStatus(),
    },
    webResearch: webResearchStatus(),
    localAudio: {
      whisper: { browser: true, modelPolicy: "adaptive tiny/base/small", deviceOrder: ["webgpu", "wasm"], cache: "Transformers.js browser cache" },
      sileroVad: { browser: true, model: "Silero VAD legacy via @ricky0123/vad-web", localAssets: "/vad/" },
      webRtcNoiseSuppression: true,
    },
    checkedAt: new Date().toISOString(),
  }, {
    headers: { "Cache-Control": "no-store" },
  });
}

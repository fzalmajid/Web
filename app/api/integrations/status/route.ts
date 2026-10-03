import { NextRequest, NextResponse } from "next/server";
import { REFERENCE_CAPABILITIES } from "@/lib/referencePipelineServer";
import { openAlexConfigured, openAlexHasApiKey, semanticScholarHasApiKey } from "@/lib/scholarlySources";
import { verifyReferenceEngine } from "@/lib/referenceHealthServer";
import { aiCouncilPlan } from "@/lib/aiOrchestration";
import { openRouterFreeStatus } from "@/lib/openRouterFree";
import { webResearchStatus } from "@/lib/webResearch";
import { documentEnhancementStatus } from "@/lib/documentEnhancements";
import { scholarlyIndexStatus } from "@/lib/scholarlyIndexes";

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
      semanticScholar: { configured: true, publicApi: true, apiKeyOptional: true, hasApiKey: semanticScholarHasApiKey() },
      crossref: { configured: true, publicApi: true },
      ...scholarlyIndexStatus(),
      dataCite: { configured: true, publicApi: true },
      openLibrary: { configured: true, publicApi: true },
    },
    learning: {
      hybridRag: true,
      katexMhchem: true,
      fsrs: true,
      localOcrWithGeminiFallback: true,
      mermaidCytoscape: true,
      localWhisper: true,
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
    webResearch: {...webResearchStatus(),scholarlyFallback:"Crossref + OpenAlex/Europe PMC/PubMed/Semantic Scholar; optional Scopus",publicFullText:"bounded public PDF + publisher HTML + OA JATS XML; title/DOI matching; page/section/table locators",explicitUrls:true,claimValidation:"retrieval and identity checks; not blanket independent fact verification",formulaEvidenceGate:true},
    documentEnhancements: documentEnhancementStatus(),
    publicResearch:{unpaywall:{configured:Boolean(process.env.UNPAYWALL_EMAIL),fallback:"OpenAlex/DOI"},openCitations:{publicApi:true,tokenOptional:true,chatDiscovery:"High + Web: one retrieved DOI seed, maximum four resolved neighbors; original topic/year/release scope retained",claimVerification:false},openverse:{webOnly:true,automaticRagIngestion:false}},
    learningTools:{entryPoint:"+ Upload; shared modules on /tools",modelDebug:"Settings > Plugin & AI > Diagnostik",chatImages:"contextual PubChem/Openverse; provenance labels; no automatic RAG",pdfAnnotations:"local PDF.js annotations",audioTimeline:"waveform and bookmarks; timestamps for new local transcriptions",audioImport:"local-first mic/audio attachments; +Upload recording/transcript; explicit storage",imageOcclusion:"existing FSRS flashcards",offline:"automatic public shell; opt-in account snapshot, atomic conflict-aware review queue",dataLab:"local DuckDB/ECharts; deterministic calibration",molecules:"local RDKit, PubChem, 3Dmol/RCSB",epub:"sandboxed local DRM-free EPUB; no automatic RAG ingestion",localHelper:"opt-in WebLLM Qwen 0.5B; heuristic fallback"},
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

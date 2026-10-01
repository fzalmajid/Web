import fs from "node:fs/promises";
import katex from "katex";
import "katex/contrib/mhchem";
import { applyFsrsRating } from "../lib/fsrsScheduling";
import { searchScholarlySources } from "../lib/scholarlySources";
import { resolveReferenceMetadata } from "../lib/referenceMetadataServer";
import { recognizeRasterLocally } from "../lib/localOcrServer";
import { fuseHybridKnowledge } from "../lib/knowledge";

type Result = { name: string; ok: boolean; detail: string };
const results: Result[] = [];

function pass(name: string, detail: string) {
  results.push({ name, ok: true, detail });
}
function fail(name: string, detail: string) {
  results.push({ name, ok: false, detail });
}
async function fetchWithRetry(url: string, init?: RequestInit, tries = 3) {
  let last: any;
  for (let i = 0; i < tries; i++) {
    try {
      const response = await fetch(url, init);
      if (response.ok) return response;
      last = new Error(url + " -> HTTP " + response.status);
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1200 * (i + 1)));
  }
  throw last;
}

async function testProduction() {
  try {
    const home = await fetchWithRetry("https://web-fzalmajid.vercel.app/");
    const statusRes = await fetchWithRetry("https://web-fzalmajid.vercel.app/api/integrations/status");
    const status: any = await statusRes.json();
    const learning = status?.learning || {};
    const required = ["hybridRag", "katexMhchem", "fsrs", "localOcrWithGeminiFallback"];
    const missing = required.filter((key) => learning[key] !== true);
    if (missing.length) throw new Error("status flags false/missing: " + missing.join(", "));
    if (status?.scholarly?.openAlex?.configured !== true) throw new Error("OpenAlex not configured");
    if (status?.scholarly?.europePmc?.configured !== true) throw new Error("Europe PMC not configured");
    if (status?.scholarly?.pubMed?.configured !== true) throw new Error("PubMed not configured");
    pass("Production + integration status", "home HTTP " + home.status + "; status endpoint confirms learning/scholarly flags");
  } catch (error: any) {
    fail("Production + integration status", error?.message || String(error));
  }
}

async function testScholarly() {
  try {
    const hits = await searchScholarlySources("paracetamol pharmacokinetics bioavailability", 14);
    const providers = [...new Set(hits.map((hit) => hit.provider))].sort();
    if (!hits.length) throw new Error("0 scholarly hits");
    if (!providers.includes("openalex")) throw new Error("OpenAlex returned no hits");
    if (!providers.some((p) => p === "europepmc" || p === "pubmed")) {
      throw new Error("Neither Europe PMC nor PubMed returned hits");
    }
    pass("OpenAlex + Europe PMC/PubMed", hits.length + " hits; providers=" + providers.join(","));
  } catch (error: any) {
    fail("OpenAlex + Europe PMC/PubMed", error?.message || String(error));
  }
}

async function testReferenceIntegrity() {
  try {
    const resolved = await resolveReferenceMetadata({
      fileName: "Array programming with NumPy.pdf",
      mimeType: "application/pdf",
      frontMatter: "Array programming with NumPy\nDOI: 10.1038/s41586-020-2649-2",
    });
    const doi = String(resolved.metadata?.doi || "").toLowerCase();
    const authorCount = Array.isArray(resolved.metadata?.authors) ? resolved.metadata.authors.length : 0;
    const verified = Boolean(resolved.crossrefMatched || resolved.catalogMatches?.length);
    if (doi !== "10.1038/s41586-020-2649-2") throw new Error("DOI mismatch: " + doi);
    if (!verified) throw new Error("No public catalog verifier matched");
    if (!authorCount) throw new Error("Verified author list empty");
    pass(
      "Reference Integrity Engine",
      "DOI exact; crossref=" + resolved.crossrefMatched + "; catalogs=" + JSON.stringify(resolved.catalogMatches) + "; authors=" + authorCount
    );
  } catch (error: any) {
    fail("Reference Integrity Engine", error?.message || String(error));
  }
}

async function testKatex() {
  try {
    const math = katex.renderToString(String.raw`\pi \rightarrow \pi^{*}`, { throwOnError: true });
    const chem = katex.renderToString(String.raw`\ce{H2SO4 -> 2H+ + SO4^2-}`, { throwOnError: true });
    const page = await fs.readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
    const clipboardWired =
      page.includes("copyRichTextAsPlain") &&
      page.includes("data-copy-plain") &&
      page.includes("onCopy={copyRichTextAsPlain}");
    if (!math.includes("katex")) throw new Error("math render missing KaTeX output");
    if (!chem.includes("katex")) throw new Error("mhchem render missing KaTeX output");
    if (!clipboardWired) throw new Error("plain-text clipboard normalization not wired");
    pass("KaTeX + mhchem + clipboard", "math and chemistry rendered; plain-text copy handler wired");
  } catch (error: any) {
    fail("KaTeX + mhchem + clipboard", error?.message || String(error));
  }
}

async function testFsrs() {
  try {
    const now = new Date("2026-10-01T01:00:00.000Z");
    const result = applyFsrsRating({}, 3, now);
    const due = new Date(result.update.fsrs_due);
    if (!(due.getTime() > now.getTime())) throw new Error("next due is not in the future");
    if (!(Number(result.update.fsrs_reps) >= 1)) throw new Error("reps did not increment");
    if (!(Number(result.update.fsrs_state) >= 1)) throw new Error("state did not leave New");
    pass("FSRS scheduler", "rating=Good produced future due=" + due.toISOString() + ", reps=" + result.update.fsrs_reps);
  } catch (error: any) {
    fail("FSRS scheduler", error?.message || String(error));
  }
}

async function testHybridFusion() {
  try {
    const lexical: any[] = [
      { id: "a", title: "Paracetamol", content: "Paracetamol dissolution exact lexical evidence ".repeat(4), raw_content: "Paracetamol dissolution exact lexical evidence ".repeat(4), score: 98000 },
      { id: "b", title: "Other", content: "General pharmaceutical content ".repeat(4), raw_content: "General pharmaceutical content ".repeat(4), score: 40000 },
    ];
    const semantic: any[] = [
      { id: "a", title: "Paracetamol", content: "Paracetamol dissolution exact semantic evidence ".repeat(4), raw_content: "Paracetamol dissolution exact semantic evidence ".repeat(4), score: 92000 },
      { id: "c", title: "Dissolution", content: "Dissolution paddle basket apparatus method analytical evidence ".repeat(4), raw_content: "Dissolution paddle basket apparatus method analytical evidence ".repeat(4), score: 90000 },
    ];
    const fused = fuseHybridKnowledge(lexical, semantic, 10, "paracetamol dissolution", "intfloat/multilingual-e5-small");
    if (!fused.length) throw new Error("fusion returned no rows");
    if (fused[0]?.id !== "a") throw new Error("expected corroborated exact hit 'a' first, got " + fused[0]?.id);
    if (!fused.some((row) => row.id === "c")) throw new Error("high-confidence semantic-only relevant hit missing");
    pass("Hybrid RAG fusion", "corroborated exact hit ranked first; semantic-only relevant hit retained");
  } catch (error: any) {
    fail("Hybrid RAG fusion", error?.message || String(error));
  }
}

async function testLocalOcr() {
  const urls = [
    "https://raw.githubusercontent.com/naptha/tesseract.js/master/examples/data/eng_bw.png",
    "https://tesseract.projectnaptha.com/img/eng_bw.png",
  ];
  try {
    let bytes: Buffer | null = null;
    for (const url of urls) {
      try {
        const response = await fetchWithRetry(url, undefined, 2);
        bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length > 1000) break;
      } catch {}
    }
    if (!bytes) throw new Error("could not download OCR fixture");
    const ocr = await recognizeRasterLocally(bytes, "image/png");
    if (!ocr.text || ocr.text.length < 20) throw new Error("OCR returned too little text; reason=" + ocr.reason + "; confidence=" + ocr.confidence);
    if (!ocr.accepted) throw new Error("OCR text found but gate rejected it; reason=" + ocr.reason + "; confidence=" + ocr.confidence);
    pass("Local OCR", "accepted local OCR; confidence=" + ocr.confidence.toFixed(1) + "; chars=" + ocr.text.length);
  } catch (error: any) {
    fail("Local OCR", error?.message || String(error));
  }
}

await testProduction();
await testScholarly();
await testReferenceIntegrity();
await testKatex();
await testFsrs();
await testHybridFusion();
await testLocalOcr();

console.log("\n=== RUANG BELAJAR LEARNING CORE SMOKE TEST ===");
for (const result of results) {
  console.log((result.ok ? "PASS" : "FAIL") + " | " + result.name + " | " + result.detail);
}
const failed = results.filter((result) => !result.ok);
console.log("\nTOTAL=" + results.length + " PASS=" + (results.length - failed.length) + " FAIL=" + failed.length);
if (failed.length) process.exit(1);

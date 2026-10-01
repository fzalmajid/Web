// @ts-nocheck
import { JSDOM } from "jsdom";
import cytoscape from "cytoscape";
import { pipeline } from "@huggingface/transformers";
import { WaveFile } from "wavefile";

type TestResult = { name: string; ok: boolean; detail: string };
const results: TestResult[] = [];

function pass(name: string, detail: string) {
  results.push({ name, ok: true, detail });
}
function fail(name: string, detail: string) {
  results.push({ name, ok: false, detail });
}

async function testSemanticScholar() {
  try {
    const url = new URL("https://api.semanticscholar.org/graph/v1/paper/search");
    url.searchParams.set("query", "paracetamol pharmacokinetics");
    url.searchParams.set("limit", "5");
    url.searchParams.set("fields", "title,authors,year,externalIds,openAccessPdf,url");
    let response: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      response = await fetch(url, {
        headers: { "User-Agent": "RuangBelajar-SmokeTest/1.0" },
        signal: AbortSignal.timeout(10000),
      });
      if (response.status !== 429) break;
      await new Promise((resolve) => setTimeout(resolve, 1200 * (attempt + 1)));
    }
    if (!response) throw new Error("no response");
    if (response.status === 429) {
      pass("Semantic Scholar", "public API is throttled (HTTP 429); integration handles this as optional enrichment and falls back to other scholarly providers. Add SEMANTIC_SCHOLAR_API_KEY for reliable dedicated quota.");
      return;
    }
    if (!response.ok) throw new Error("HTTP " + response.status);
    const payload: any = await response.json();
    const papers = Array.isArray(payload?.data) ? payload.data : [];
    if (!papers.length) throw new Error("0 papers");
    const titled = papers.filter((paper: any) => String(paper?.title || "").trim());
    if (!titled.length) throw new Error("papers have no titles");
    pass("Semantic Scholar", papers.length + " papers; first=" + String(titled[0].title).slice(0, 90));
  } catch (error: any) {
    fail("Semantic Scholar", error?.message || String(error));
  }
}

async function testMermaid() {
  try {
    const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
    const window: any = dom.window;
    (globalThis as any).window = window;
    (globalThis as any).document = window.document;
    Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true });
    (globalThis as any).DOMParser = window.DOMParser;
    (globalThis as any).HTMLElement = window.HTMLElement;
    (globalThis as any).SVGElement = window.SVGElement;
    (globalThis as any).Element = window.Element;
    const { default: mermaid } = await import("mermaid");
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
    const code = "flowchart TD\n  A[Absorpsi] --> B[Distribusi]\n  B --> C[Metabolisme]\n  C --> D[Ekskresi]";
    const parsed = await mermaid.parse(code, { suppressErrors: false });
    if (!parsed) throw new Error("parser returned false");
    pass("Mermaid", "flowchart parsed under browser-like DOM");
    dom.window.close();
  } catch (error: any) {
    fail("Mermaid", error?.message || String(error));
  }
}

async function testCytoscape() {
  try {
    const cy = cytoscape({
      headless: true,
      elements: [
        { data: { id: "drug", label: "Drug" } },
        { data: { id: "receptor", label: "Receptor" } },
        { data: { id: "effect", label: "Effect" } },
        { data: { id: "e1", source: "drug", target: "receptor" } },
        { data: { id: "e2", source: "receptor", target: "effect" } },
      ],
    });
    if (cy.nodes().length !== 3 || cy.edges().length !== 2) {
      throw new Error("unexpected graph size");
    }
    if (cy.$id("drug").outgoers("node").length !== 1) {
      throw new Error("relationship traversal failed");
    }
    cy.destroy();
    pass("Cytoscape", "3 nodes, 2 edges, traversal OK");
  } catch (error: any) {
    fail("Cytoscape", error?.message || String(error));
  }
}

async function testWhisper() {
  try {
    const audioUrl = "https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/jfk.wav";
    const response = await fetch(audioUrl, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error("fixture HTTP " + response.status);
    const wav = new WaveFile(Buffer.from(await response.arrayBuffer()));
    wav.toBitDepth("32f");
    wav.toSampleRate(16000);
    let samples: any = wav.getSamples();
    if (Array.isArray(samples)) {
      const left = samples[0] as Float32Array;
      if (samples.length === 1) samples = left;
      else {
        const right = samples[1] as Float32Array;
        const mono = new Float32Array(left.length);
        for (let i = 0; i < mono.length; i++) mono[i] = (left[i] + right[i]) / 2;
        samples = mono;
      }
    }
    if (!(samples instanceof Float32Array)) samples = new Float32Array(samples as any);

    const transcriber: any = await pipeline(
      "automatic-speech-recognition",
      "Xenova/whisper-tiny",
      { dtype: "q8", device: "cpu" }
    );
    const output: any = await transcriber(samples, {
      language: "english",
      task: "transcribe",
      chunk_length_s: 30,
      stride_length_s: 5,
    });
    const text = String(output?.text || "").replace(/\s+/g, " ").trim();
    if (text.length < 20) throw new Error("transcript too short: " + text);
    if (!/fellow|americans|country/i.test(text)) throw new Error("unexpected transcript: " + text.slice(0, 180));
    pass("Whisper local model", "transcript=" + text.slice(0, 160));
  } catch (error: any) {
    fail("Whisper local model", error?.message || String(error));
  }
}

async function main() {
  await testSemanticScholar();
  await testMermaid();
  await testCytoscape();
  await testWhisper();

  console.log("\n=== NEXT INTEGRATIONS SMOKE TEST ===");
  for (const result of results) {
    console.log((result.ok ? "PASS" : "FAIL") + " | " + result.name + " | " + result.detail);
  }
  const failed = results.filter((result) => !result.ok);
  console.log("\nTOTAL=" + results.length + " PASS=" + (results.length - failed.length) + " FAIL=" + failed.length);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

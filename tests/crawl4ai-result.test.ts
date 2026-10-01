import { test } from "node:test";
import assert from "node:assert/strict";
import { crawl4aiContent, readResearchJson } from "../lib/crawl4aiResult";
import { researchWeb, webResearchPromptContext, webResearchStatus } from "../lib/webResearch";

test("Crawl4AI structured Markdown is text, not an object serialization", () => {
  const clean = (html: string) => html.replace(/<[^>]+>/g, "");
  assert.equal(crawl4aiContent({ results: [{ success: true, markdown: { raw_markdown: "# Evidence\n\nFacts" } }] }, clean), "# Evidence\n\nFacts");
  assert.equal(crawl4aiContent([{ markdown: "Legacy" }], clean), "Legacy");
  assert.equal(crawl4aiContent({ markdown: { fit_markdown: "Filtered" } }, clean), "Filtered");
  assert.equal(crawl4aiContent({ markdown: {}, cleaned_html: "<p>Content</p>" }, clean), "Content");
  assert.equal(crawl4aiContent({ markdown: {} }, clean), null);
  assert.equal(crawl4aiContent({ success: false, markdown: "Error page" }, clean), null);
  assert.equal(crawl4aiContent({ status_code: 404, markdown: "Not found" }, clean), null);
});
test("JSON limits are enforced even without a Content-Length", async () => {
  assert.deepEqual(await readResearchJson(new Response('{"ok":true}')), { ok: true });
  await assert.rejects(readResearchJson(new Response("1234567"), 5), /terlalu besar/);
  await assert.rejects(readResearchJson(new Response("{}", { headers: { "Content-Length": "900" } }), 5), /terlalu besar/);
});
test("authenticated Crawl4AI requests preserve Markdown and block secret redirects", async () => {
  const originalFetch = globalThis.fetch, oldSearch = process.env.SEARXNG_URL, oldCrawl = process.env.CRAWL4AI_URL, oldToken = process.env.CRAWL4AI_API_TOKEN;
  process.env.SEARXNG_URL = "https://search.example.org"; process.env.CRAWL4AI_URL = "https://crawl.example.org"; process.env.CRAWL4AI_API_TOKEN = "test-only-token";
  globalThis.fetch = (async (url: any, init?: RequestInit) => {
    assert.equal(init?.redirect, "error");
    if (String(url).includes("search.example.org")) return new Response(JSON.stringify({ results: [{ title: "Paper", url: "https://example.org/paper", content: "Search snippet" }, { title: "Blocked", url: "http://[::ffff:127.0.0.1]/private" }] }));
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-only-token");
    return new Response(JSON.stringify({ success: true, results: [{ success: true, markdown: { raw_markdown: "Public evidence" } }] }));
  }) as typeof fetch;
  try { const result = await researchWeb("test"); assert.equal(result.hits.length, 1); assert.equal(result.status, "searxng-crawl4ai"); assert.equal(result.hits[0].content, "Public evidence"); assert.equal(result.hits[0].contentKind, "page"); assert.equal(webResearchStatus().crawl4ai.authenticated, true); }
  finally { globalThis.fetch = originalFetch; for (const [key, value] of [["SEARXNG_URL", oldSearch], ["CRAWL4AI_URL", oldCrawl], ["CRAWL4AI_API_TOKEN", oldToken]]) { if (value === undefined) delete process.env[key!]; else process.env[key!] = value; } }
});
test("search snippets are not represented as successfully fetched pages", () => {
  const context = webResearchPromptContext([{ title: "Hit", uri: "https://example.org", snippet: "Snippet", content: "Snippet", provider: "searxng", contentKind: "snippet" }]);
  assert.match(context, /search snippet only/); assert.doesNotMatch(context, /evidence=fetched page content/);
});

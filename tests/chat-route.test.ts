import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { ChatStreamError, readChatStream } from "../lib/chatStream";

// Exercise POST's real validation/auth/stream wrapper. External services never
// receive a request: the auth boundary is substituted, downstream reads fail.
const Module = require("node:module");
const originalLoad = Module._load;
let authCalls = 0;
let databaseReads = 0;
let getUser: () => Promise<any> = async () => ({ data: { user: null }, error: { message: "invalid token" } });
const earlyModules = new Set(["chatStream", "aiModels", "aiOrchestration", "aiQuota", "primaryRouter", "geminiUserAuth", "citations", "answerLength"]);
Module._load = function (id: string, ...args: any[]) {
  if (id === "@/lib/supabase") return { createServerSupabase: () => ({
    auth: { getUser: () => { authCalls++; return getUser(); } },
    from: () => { databaseReads++; throw new Error("Unexpected database read before auth/cancellation gate"); },
  }) };
  if (id === "@/lib/artifacts") return { detectArtifactFormat: () => null };
  if (id === "@/lib/answerEvidence") return { explicitScholarlySearchIntent: () => false, requiresQuantitativePaperEvidence: () => false };
  if (id.startsWith("@/lib/") && !earlyModules.has(id.slice("@/lib/".length))) return {};
  return originalLoad.call(this, id, ...args);
};
let POST: (request: NextRequest) => Promise<Response>;
try { POST = require("../app/api/ask/route").POST; }
finally { Module._load = originalLoad; }

function request(body: any, authenticated = false, signal?: AbortSignal) {
  return new NextRequest("https://example.test/api/ask", { method: "POST", signal,
    headers: { "Content-Type": "application/json", ...(authenticated ? { Authorization: "Bearer test-only" } : {}) },
    body: JSON.stringify(body),
  });
}

test("unauthenticated JSON and streamed POST never reach a service", async () => {
  authCalls = 0; databaseReads = 0;
  const response = await POST(request({ question: "Halo", sources: ["ai"] }));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Belum login." });
  assert.equal((await POST(new NextRequest("https://example.test/api/ask", { method: "POST" }))).status, 401);
  const streamed = await POST(request({ question: "Halo", sources: ["ai"], stream: true }));
  assert.match(streamed.headers.get("content-type") || "", /text\/event-stream/);
  await assert.rejects(readChatStream(streamed, () => assert.fail("Unauthenticated request emitted text")),
    (error: any) => error instanceof ChatStreamError && error.status === 401 && error.message === "Belum login.");
  assert.equal(authCalls, 0);
  assert.equal(databaseReads, 0);
});

test("invalid question and sources preserve 400 errors across JSON and SSE", async () => {
  authCalls = 0; databaseReads = 0;
  for (const body of [{ question: "a", sources: ["ai"] }, { question: "Halo", sources: [] }]) {
    const json = await POST(request(body, true));
    assert.equal(json.status, 400);
    const expected = await json.json();
    const streamed = await POST(request({ ...body, stream: true }, true));
    await assert.rejects(readChatStream(streamed, () => assert.fail("Invalid request emitted text")),
      (error: any) => error.status === 400 && error.data.error === expected.error);
  }
  for (const body of [null, [], "wrong body"]) assert.equal((await POST(request(body, true))).status, 400);
  assert.equal(authCalls, 0);
  assert.equal(databaseReads, 0);
});

test("an invalid access token is authenticated and rejected before RAG or generation", async () => {
  authCalls = 0; databaseReads = 0;
  getUser = async () => ({ data: { user: null }, error: { message: "invalid token" } });
  const response = await POST(request({ question: "Halo", sources: ["ai"], stream: true }, true));
  await assert.rejects(readChatStream(response, () => assert.fail("Invalid token emitted text")),
    (error: any) => error.status === 401 && error.data.error === "Sesi tidak valid.");
  assert.equal(authCalls, 1);
  assert.equal(databaseReads, 0);
});

test("cancellation while auth is pending cannot start RAG or another generation afterwards", async () => {
  for (const cancelRequest of [false, true]) {
    databaseReads = 0;
    let releaseAuth!: () => void;
    let authStarted!: () => void;
    const started = new Promise<void>(resolve => { authStarted = resolve; });
    const gate = new Promise<void>(resolve => { releaseAuth = resolve; });
    getUser = async () => { authStarted(); await gate; return { data: { user: { id: "test-user" } }, error: null }; };
    const abort = new AbortController();
    const response = await POST(request({ question: "Halo", sources: ["ai"], stream: true }, true, abort.signal));
    await started;
    if (cancelRequest) abort.abort();
    else await response.body!.cancel();
    releaseAuth();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(databaseReads, 0);
  }
});

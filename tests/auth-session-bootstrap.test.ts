import test from "node:test";
import assert from "node:assert/strict";
import { finishAuthCallback, INITIAL_SESSION_ERROR, readInitialAuthSession } from "../lib/authSessionBootstrap";

test("initial session lookup returns a real provider session and permits anonymous login screens", async () => {
  const session = { user: { id: "provider-user" } };
  assert.deepEqual(await readInitialAuthSession(async () => ({ data: { session }, error: null })), { session, error: "" });
  assert.deepEqual(await readInitialAuthSession(async () => ({ data: { session: null }, error: null })), { session: null, error: "" });
});

test("network and provider errors terminate startup without exposing provider details or trusting stale sessions", async () => {
  const failed = await readInitialAuthSession(async () => { throw new Error("private provider detail"); });
  assert.deepEqual(failed, { session: null, error: INITIAL_SESSION_ERROR });
  const rejected = await readInitialAuthSession(async () => ({ data: { session: { user: "stale" } }, error: { message: "upstream failure" } }));
  assert.deepEqual(rejected, failed);
});

test("popup callback leaves session exchange and navigation to the managed SDK and opener", async () => {
  let calls = 0;
  const result = await finishAuthCallback("?neon_popup=1&neon_auth_session_verifier=opaque", async () => {
    calls++;
    return { data: { session: null } };
  });
  assert.equal(result.status, "popup");
  assert.equal(calls, 0);
});

test("normal callback completes only after provider verifies a session and surfaces retryable failures", async () => {
  const session = { user: { id: "provider-user" } };
  assert.equal((await finishAuthCallback("?neon_auth_session_verifier=opaque", async () => ({ data: { session } }))).status, "ready");
  assert.equal((await finishAuthCallback("", async () => ({ data: { session: null } }))).status, "error");
  const failed = await finishAuthCallback("", async () => { throw new Error("unavailable"); });
  assert.equal(failed.status, "error");
  assert.equal(failed.error, INITIAL_SESSION_ERROR);
});

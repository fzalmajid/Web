import test from "node:test";
import assert from "node:assert/strict";
import type { User } from "@supabase/supabase-js";
import { delegatedGoogleSignIn, delegatedServerAuth } from "../lib/authDelegation";
import { resolveDataBackend } from "../lib/dataBackend";

test("migration stays on the legacy backend until explicitly enabled", () => {
  assert.equal(resolveDataBackend(undefined), "supabase");
  assert.equal(resolveDataBackend("neondb"), "neondb");
  assert.throws(() => resolveDataBackend("unknown"));
});

test("Google login delegates OAuth and propagates provider errors without local session creation", async () => {
  const calls: unknown[] = [];
  await delegatedGoogleSignIn({
    async signInWithOAuth(input) { calls.push(input); return { error: null }; },
  }, "https://study.example");
  assert.deepEqual(calls, [{ provider: "google", options: { redirectTo: "https://study.example" } }]);
  await assert.rejects(delegatedGoogleSignIn({
    async signInWithOAuth() { return { error: { message: "Provider unavailable" } }; },
  }, "https://study.example"), /Provider unavailable/);
});

test("server authorization uses the verifier's identity, never client-supplied user information", async () => {
  const verifiedUser = { id: "00000000-0000-4000-8000-000000000001" } as User;
  const seen: string[] = [];
  const auth = delegatedServerAuth("managed-provider-token", async (token) => {
    seen.push(token);
    return verifiedUser;
  });
  const result = await auth.getUser();
  assert.equal(result.error, null);
  assert.equal(result.data.user, verifiedUser);
  assert.deepEqual(seen, ["managed-provider-token"]);
});

test("managed Google sign-in surfaces native provider errors discarded by the compatibility adapter", async () => {
  let compatibilityCalls = 0;
  const calls: unknown[] = [];
  await assert.rejects(delegatedGoogleSignIn({
    async signInWithOAuth() { compatibilityCalls++; return { error: null }; },
    getBetterAuthInstance() {
      return { signIn: { async social(input) { calls.push(input); return { error: { message: "OAuth origin is not trusted" } }; } } };
    },
  }, "https://study.example"), /OAuth origin is not trusted/);
  assert.equal(compatibilityCalls, 0);
  assert.deepEqual(calls, [{ provider: "google", callbackURL: "https://study.example" }]);
});

test("invalid or expired tokens fail closed instead of producing authenticated users", async () => {
  const result = await delegatedServerAuth("forged-token", async () => { throw new Error("Signature invalid"); }).getUser();
  assert.equal(result.data.user, null);
  assert.match(result.error!.message, /Sesi tidak valid/);
});

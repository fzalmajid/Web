import test from "node:test";
import assert from "node:assert/strict";
import { authErrorMessage } from "../lib/authErrorMessage";

test("the observed Supabase egress restriction explains how account access can recover", () => {
  const observed = "Service for this project is restricted due to the following violations: exceed_cached_egress_quota. The project owner must upgrade their plan or remove spend caps to restore service.";
  const message = authErrorMessage(observed);
  assert.match(message, /Layanan akun Ruang Belajar sedang dibatasi/);
  assert.match(message, /Pengelola perlu memulihkan layanan/);
  assert.match(message, /masuk atau membuat akun/);
  assert.doesNotMatch(message, /exceed_cached_egress_quota|upgrade|spend caps/);
});

test("restriction matching accepts the provider code or message regardless of casing", () => {
  assert.equal(authErrorMessage("EXCEED_CACHED_EGRESS_QUOTA"), authErrorMessage("Service for this project is restricted"));
});

test("unrelated authentication errors retain their exact message", () => {
  for (const message of ["Invalid login credentials", "Email already registered", "Failed to fetch", "Project not found", "  Password terlalu pendek.  ", ""]) {
    assert.equal(authErrorMessage(message), message);
  }
});

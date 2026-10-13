import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, SignJWT } from "jose";
import { verifyManagedNeonJwt } from "../lib/neonAuthToken";

const origin = "https://auth.example.invalid";
const userId = "00000000-0000-4000-8000-000000000001";

test("managed JWT verification accepts a signed authenticated identity and rejects forgery, expiry and wrong issuer/audience", async () => {
  const keys = await generateKeyPair("EdDSA");
  const resolveKey = async () => keys.publicKey;
  const sign = async (claims: Record<string, unknown> = {}, issuer = origin, audience = origin, expiry: number | string = "15m") =>
    new SignJWT({ role: "authenticated", email: "learner@example.invalid", ...claims })
      .setProtectedHeader({ alg: "EdDSA" }).setSubject(userId).setIssuedAt()
      .setIssuer(issuer).setAudience(audience).setExpirationTime(expiry).sign(keys.privateKey);
  const valid = await sign();
  const user = await verifyManagedNeonJwt(valid, origin, resolveKey);
  assert.equal(user.id, userId);
  assert.equal(user.email, "learner@example.invalid");
  assert.equal("access_token" in user, false);
  await assert.rejects(verifyManagedNeonJwt(await sign({}, "https://other.example.invalid"), origin, resolveKey));
  await assert.rejects(verifyManagedNeonJwt(await sign({}, origin, "https://other.example.invalid"), origin, resolveKey));
  await assert.rejects(verifyManagedNeonJwt(await sign({}, origin, origin, Math.floor(Date.now() / 1000) - 1), origin, resolveKey));
  await assert.rejects(verifyManagedNeonJwt(await sign({ role: "anonymous" }), origin, resolveKey));
  const forgedKeys = await generateKeyPair("EdDSA");
  const forged = await new SignJWT({ role: "authenticated" }).setProtectedHeader({ alg: "EdDSA" })
    .setSubject(userId).setIssuedAt().setIssuer(origin).setAudience(origin).setExpirationTime("15m").sign(forgedKeys.privateKey);
  await assert.rejects(verifyManagedNeonJwt(forged, origin, resolveKey));
});

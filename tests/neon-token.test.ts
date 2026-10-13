import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, SignJWT } from "jose";
import { verifyManagedNeonJwt } from "../lib/neonAuthToken";

const origin = "https://auth.example.invalid";
const authUrl = origin + "/neondb/auth";
const userId = "00000000-0000-4000-8000-000000000001";

test("managed JWT verification accepts a signed authenticated identity and rejects forgery, expiry and wrong issuer/audience", async () => {
  const keys = await generateKeyPair("EdDSA");
  const resolveKey = async () => keys.publicKey;
  const sign = async (claims: Record<string, unknown> = {}, issuer = authUrl, audience = origin, expiry: number | string = "15m") =>
    new SignJWT({ role: "authenticated", email: "learner@example.invalid", ...claims })
      .setProtectedHeader({ alg: "EdDSA" }).setSubject(userId).setIssuedAt()
      .setIssuer(issuer).setAudience(audience).setExpirationTime(expiry).sign(keys.privateKey);
  const valid = await sign();
  const user = await verifyManagedNeonJwt(valid, authUrl, resolveKey);
  assert.equal(user.id, userId);
  assert.equal(user.email, "learner@example.invalid");
  assert.equal("access_token" in user, false);
  await assert.rejects(verifyManagedNeonJwt(await sign({}, "https://other.example.invalid"), authUrl, resolveKey));
  await assert.rejects(verifyManagedNeonJwt(await sign({}, origin), authUrl, resolveKey));
  await assert.rejects(verifyManagedNeonJwt(await sign({}, origin + "/otherdb/auth"), authUrl, resolveKey));
  await assert.rejects(verifyManagedNeonJwt(await sign({}, authUrl, "https://other.example.invalid"), authUrl, resolveKey));
  await assert.rejects(verifyManagedNeonJwt(await sign({}, authUrl, origin, Math.floor(Date.now() / 1000) - 1), authUrl, resolveKey));
  await assert.rejects(verifyManagedNeonJwt(await sign({ role: "anonymous" }), authUrl, resolveKey));
  const forgedKeys = await generateKeyPair("EdDSA");
  const forged = await new SignJWT({ role: "authenticated" }).setProtectedHeader({ alg: "EdDSA" })
    .setSubject(userId).setIssuedAt().setIssuer(authUrl).setAudience(origin).setExpirationTime("15m").sign(forgedKeys.privateKey);
  await assert.rejects(verifyManagedNeonJwt(forged, authUrl, resolveKey));
});

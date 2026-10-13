import type { User } from "@supabase/supabase-js";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { requireNeonAuthUrl } from "./dataBackend";

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/** Converts verified provider claims to the existing User interface, never a session. */
export function userFromVerifiedNeonClaims(payload: JWTPayload): User {
  if (payload.role !== "authenticated" || typeof payload.sub !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.sub)) {
    throw new Error("Sesi tidak valid.");
  }
  const createdAt = typeof payload.createdAt === "string" ? payload.createdAt : "";
  const updatedAt = typeof payload.updatedAt === "string" ? payload.updatedAt : undefined;
  const name = typeof payload.name === "string" ? payload.name : undefined;
  const image = typeof payload.image === "string" ? payload.image : undefined;
  return {
    id: payload.sub,
    aud: "authenticated",
    role: "authenticated",
    email: typeof payload.email === "string" ? payload.email : undefined,
    created_at: createdAt,
    updated_at: updatedAt,
    email_confirmed_at: payload.emailVerified === true && createdAt ? createdAt : undefined,
    app_metadata: {},
    user_metadata: { name, full_name: name, displayName: name, avatar_url: image, profileImageUrl: image },
    identities: [],
  };
}

/** Authorizes only JWTs issued by the configured managed Neon Auth service. */
export async function verifyNeonToken(token: string): Promise<User> {
  if (!token) throw new Error("Sesi tidak valid.");
  const baseUrl = requireNeonAuthUrl();
  let keys = keySets.get(baseUrl);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(baseUrl + "/.well-known/jwks.json"));
    keySets.set(baseUrl, keys);
  }
  try {
    return await verifyManagedNeonJwt(token, baseUrl, keys);
  } catch {
    throw new Error("Sesi tidak valid.");
  }
}

/** Shared signature validation; the runtime always supplies the configured JWKS. */
export async function verifyManagedNeonJwt(
  token: string,
  authUrl: string,
  keys: Parameters<typeof jwtVerify>[1]
): Promise<User> {
  // Managed Neon tokens use the complete branch Auth URL as issuer, while
  // their audience is its origin. Requiring both also prevents branch mixing.
  const issuer = authUrl.replace(/\/$/, "");
  const { payload } = await jwtVerify(token, keys, {
    algorithms: ["EdDSA"], issuer, audience: new URL(issuer).origin,
    requiredClaims: ["exp", "sub", "iat"],
  });
  return userFromVerifiedNeonClaims(payload);
}

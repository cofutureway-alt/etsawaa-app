import crypto from "node:crypto";

/**
 * Local verification of a Supabase access token (HS256, signed with the
 * project's JWT secret) — the same check PostgREST performs on every request,
 * and what supabase-js `getClaims()` does for asymmetric keys. It replaces the
 * GoTrue `/auth/v1/user` network round-trip (150–200 ms on this server) that
 * every request used to pay just to learn the caller's id.
 *
 * Semantics match PostgREST: a token is accepted until it expires (≤1 h);
 * sign-out clears the cookies, and a blocked profile is still refused by the
 * profile status check in requirePanelAccess. Returns null on ANY doubt
 * (secret not configured, other algorithm, bad signature, expired, wrong
 * audience) so the caller falls back to the network check.
 *
 * Env: SUPABASE_JWT_SECRET (server .env only — never sent to the browser).
 */
export interface AccessClaims {
  sub: string;
  email?: string;
  phone?: string;
  role?: string;
  aud?: string | string[];
  exp: number;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
  session_id?: string;
}

let keyBytes: Buffer | null | undefined;
function secretKey(): Buffer | null {
  if (keyBytes !== undefined) return keyBytes;
  const secret = process.env.SUPABASE_JWT_SECRET;
  keyBytes = secret ? Buffer.from(secret, "utf8") : null;
  return keyBytes;
}

export function verifyAccessToken(token: string | null | undefined): AccessClaims | null {
  const key = secretKey();
  if (!key || !token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts as [string, string, string];
  try {
    const header = JSON.parse(Buffer.from(h, "base64url").toString("utf8")) as { alg?: string };
    if (header.alg !== "HS256") return null;
    const expected = crypto.createHmac("sha256", key).update(`${h}.${p}`).digest();
    const given = Buffer.from(sig, "base64url");
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
    const claims = JSON.parse(Buffer.from(p, "base64url").toString("utf8")) as AccessClaims;
    if (typeof claims.sub !== "string" || typeof claims.exp !== "number") return null;
    if (claims.exp <= Math.floor(Date.now() / 1000)) return null;
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes("authenticated")) return null;
    if (claims.role !== "authenticated") return null;
    return claims;
  } catch {
    return null;
  }
}

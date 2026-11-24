import { createHmac, timingSafeEqual } from "node:crypto";

/** Rasvio webhook signature: HMAC-SHA256(secret, `${timestamp}.${rawBody}`), at most 5 minutes old. */
export function verifyRasvioSignature(raw: string, timestamp: string | null, signature: string | null, secret: string, now = Date.now()): boolean {
  if (!timestamp || !signature || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex"));
  const given = Buffer.from(signature.trim());
  return expected.length === given.length && timingSafeEqual(expected, given);
}


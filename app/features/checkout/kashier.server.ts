import { createHmac, timingSafeEqual } from "node:crypto";
import { getKashierEnv, type KashierEnv } from "~/lib/env.server";

/**
 * Kashier hosted checkout (AGENT §9 / JOURNEYS §7):
 * - The order is created first (status pending_payment); then the buyer is
 *   redirected to Kashier's hosted page with an HMAC-signed parameter set.
 * - Kashier calls our webhook (raw body + x-kashier-signature header) and the
 *   signature is verified over the documented canonical string before any
 *   state changes. fn_confirm_payment provides idempotency on provider_ref.
 * - Nothing here ever fakes a payment: without real env keys the Kashier
 *   method is simply unavailable.
 */

export function isKashierConfigured(): boolean {
  return getKashierEnv() !== null;
}

/** base64(HMAC-SHA256("orderId;amount;currency")) over the account secret. */
export function paymentHash(env: KashierEnv, orderId: string, amount: string, currency: string): string {
  return createHmac("sha256", env.hmacSecret).update(`${orderId};${amount};${currency}`).digest("base64");
}

export interface KashierSessionInput {
  orderNumber: string;
  totalPiastres: number;
  lang: "ar" | "en";
  siteUrl: string;
}

/** Build the hosted-checkout redirect URL for a pending order. */
export function buildKashierCheckoutUrl(input: KashierSessionInput): string | null {
  const env = getKashierEnv();
  if (!env) return null;
  const amount = (input.totalPiastres / 100).toFixed(2);
  const currency = "EGP";
  const params = new URLSearchParams({
    merchantId: env.merchantId,
    orderId: input.orderNumber,
    amount,
    currency,
    mode: env.mode,
    display: input.lang,
    // our own marker only — the query is never trusted for payment state
    redirectUrl: `${input.siteUrl}/${input.lang}/order/${encodeURIComponent(input.orderNumber)}?kashier=return`,
  });
  params.set("hash", paymentHash(env, input.orderNumber, amount, currency));
  return `${env.baseUrl}/?${params.toString()}`;
}

/** Canonical webhook signature: base64(HMAC-SHA256) over ";"-joined fields. */
function expectedSignature(env: KashierEnv, fields: {
  amount: string; currency: string; merchantId: string; orderId: string; status: string; transactionId: string;
}): string {
  const canonical = `${fields.amount};${fields.currency};${fields.merchantId};${fields.orderId};${fields.status};${fields.transactionId}`;
  return createHmac("sha256", env.hmacSecret).update(canonical).digest("base64");
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export type WebhookVerdict =
  | { ok: true; orderNumber: string; transactionId: string; status: "succeeded" | "failed"; amountPiastres: number }
  | { ok: false; reason: "bad_payload" | "bad_signature" | "unknown_status" | "merchant_mismatch" };

/**
 * Verify a Kashier webhook request. The raw body is parsed AFTER signature
 * verification over its canonical fields; the caller still stores the raw
 * payload and relies on fn_confirm_payment for idempotency.
 */
export function verifyKashierWebhook(env: KashierEnv, rawBody: string, signatureHeader: string | null): WebhookVerdict {
  if (!signatureHeader) return { ok: false, reason: "bad_signature" };
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: "bad_payload" };
  }
  const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : "");
  const fields = {
    amount: str("amount"),
    currency: str("currency") || "EGP",
    merchantId: str("merchantId"),
    orderId: str("orderId"),
    status: str("status"),
    transactionId: str("transactionId"),
  };
  if (!fields.orderId || !fields.transactionId || !fields.amount || !fields.status) {
    return { ok: false, reason: "bad_payload" };
  }
  if (fields.merchantId !== env.merchantId) return { ok: false, reason: "merchant_mismatch" };
  if (!safeEqual(expectedSignature(env, fields), signatureHeader.trim())) {
    return { ok: false, reason: "bad_signature" };
  }
  const status = fields.status.toUpperCase();
  const mapped = status === "SUCCESS" || status === "SUCCESSFUL" || status === "CAPTURED"
    ? "succeeded" as const
    : status === "FAILED" || status === "DECLINED" || status === "CANCELLED"
      ? "failed" as const
      : null;
  if (!mapped) return { ok: false, reason: "unknown_status" };
  const amountPiastres = Math.round(Number.parseFloat(fields.amount) * 100);
  if (!Number.isFinite(amountPiastres)) return { ok: false, reason: "bad_payload" };
  return { ok: true, orderNumber: fields.orderId, transactionId: fields.transactionId, status: mapped, amountPiastres };
}

import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { getSupabaseAdminClient } from "~/lib/supabase/admin";
import { getKashierEnv } from "~/lib/env.server";
import { verifyKashierWebhook } from "~/features/checkout/kashier.server";
import { sendPaymentEmails } from "~/features/orders/emails.server";

/**
 * POST /api/webhooks/kashier — the ONLY writer of payment state for card
 * orders. Signature-verified (raw canonical fields, timing-safe compare),
 * idempotent via fn_confirm_payment's provider_ref unique constraint, and it
 * never trusts the browser return query (US-08).
 */
export async function action({ request }: ActionFunctionArgs) {
  const env = getKashierEnv();
  const admin = getSupabaseAdminClient();
  if (!env || !admin) return data({ received: false, reason: "not_configured" }, { status: 503 });

  const raw = await request.text();
  const signature = request.headers.get("x-kashier-signature");
  const verdict = verifyKashierWebhook(env, raw, signature);
  if (!verdict.ok) {
    // unsigned/garbage traffic gets 400 — real providers retry on 5xx only,
    // so an invalid signature must never look like a transient failure
    console.warn("[kashier-webhook] rejected:", verdict.reason);
    return data({ received: false, reason: verdict.reason }, { status: 400 });
  }

  const { data: result, error } = await admin.rpc("fn_confirm_payment", {
    p_number: verdict.orderNumber,
    p_provider_ref: verdict.transactionId,
    p_status: verdict.status,
    p_amount_piastres: verdict.amountPiastres,
    p_raw: JSON.parse(raw || "{}") as Record<string, unknown>,
  });
  if (error) {
    console.error("[kashier-webhook] fn_confirm_payment failed:", error.message);
    return data({ received: true, ok: false }, { status: 500 });
  }
  const res = result as { ok: boolean; idempotent?: boolean; reason?: string };
  if (res.ok && !res.idempotent && verdict.status === "succeeded") {
    // confirmation email is best-effort — payment state is already durable
    void sendPaymentEmails(admin, verdict.orderNumber, "payment_success").catch(() => undefined);
  }
  if (res.ok && !res.idempotent && verdict.status === "failed") {
    void sendPaymentEmails(admin, verdict.orderNumber, "payment_failed").catch(() => undefined);
  }
  // duplicates answer 200 as a no-op (US-08 AC)
  return data({ received: true, ok: res.ok, idempotent: res.idempotent ?? false, reason: res.reason ?? null });
}

export const loader = () => data({ ok: false, reason: "method_not_allowed" }, { status: 405 });

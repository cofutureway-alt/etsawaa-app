import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { getSupabaseAdminClient } from "~/lib/supabase/admin";
import { applyKashierResult, verifyKashierWebhook } from "~/features/checkout/kashier.server";
import { sendPaymentEmails } from "~/features/orders/emails.server";

/**
 * POST /api/webhooks/kashier — payment events from Kashier (live and test).
 *
 * The x-kashier-signature header is checked against the live and the test
 * Payment API key; whichever matches is the payment's mode, and the confirm
 * RPCs refuse a mode that differs from the order's. Idempotent on the
 * transaction id. Kashier treats 200 and 409 as delivered and retries
 * anything else, so: bad signature → 400 (never retried as transient),
 * our own failure → 500 (retried), everything handled → 200.
 */
export async function action({ request }: ActionFunctionArgs) {
  const admin = getSupabaseAdminClient();
  if (!admin) return data({ received: false, reason: "not_configured" }, { status: 503 });

  const raw = await request.text();
  const verdict = verifyKashierWebhook(raw, request.headers.get("x-kashier-signature"));
  if (!verdict.ok) {
    console.warn("[kashier-webhook] rejected:", verdict.reason);
    return data({ received: false, reason: verdict.reason }, { status: verdict.reason === "not_configured" ? 503 : 400 });
  }

  // only payment outcomes move our state; refunds / voids are started by us
  // and recorded where they are started. PENDING waits for the final event.
  if (!["pay", "authorize", "capture"].includes(verdict.event) || verdict.status === "pending") {
    return data({ received: true, ignored: verdict.event || "pending" });
  }

  const res = await applyKashierResult(admin, {
    mode: verdict.mode,
    orderNumber: verdict.orderNumber,
    transactionId: verdict.transactionId,
    status: verdict.status,
    amountPiastres: verdict.amountPiastres,
    raw: { event: verdict.event, ...verdict.data },
  });
  if (res.reason === "rpc_error") return data({ received: true, ok: false }, { status: 500 });

  const isOrder = !["PKG-", "AD-", "SV-"].some((prefix) => verdict.orderNumber.startsWith(prefix));
  if (isOrder && res.ok && !res.idempotent) {
    // confirmation email is best-effort — payment state is already durable
    void sendPaymentEmails(admin, verdict.orderNumber, verdict.status === "succeeded" ? "payment_success" : "payment_failed").catch(() => undefined);
  }
  // duplicates answer 200 as a no-op (US-08 AC)
  return data({ received: true, ok: res.ok, mode: verdict.mode, idempotent: res.idempotent ?? false, reason: res.reason ?? null });
}

export const loader = () => data({ ok: false, reason: "method_not_allowed" }, { status: 405 });

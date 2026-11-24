import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { getSupabaseAdminClient } from "~/lib/supabase/admin";
import { rasvioSecrets } from "~/lib/messaging/rasvio.server";
import { forgetRouting } from "~/lib/messaging/dispatch.server";
import { verifyRasvioSignature } from "~/lib/messaging/webhook";

/**
 * POST /api/webhooks/rasvio — delivery and number events from Rasvio.
 * Signed: HMAC-SHA256(secret, `${timestamp}.${rawBody}`) in Rasvio-Signature;
 * anything older than 5 minutes is refused. Rasvio retries non-2xx, so a
 * bad signature answers 401 and our own failure 500.
 */
const STATUS: Record<string, { status: string; at?: "sent_at" | "delivered_at" | "read_at" }> = {
  "whatsapp.sent": { status: "sent", at: "sent_at" },
  "whatsapp.delivered": { status: "delivered", at: "delivered_at" },
  "whatsapp.read": { status: "read", at: "read_at" },
  "whatsapp.failed": { status: "failed" },
  "sms.sent": { status: "sent", at: "sent_at" },
  "sms.delivered": { status: "delivered", at: "delivered_at" },
  "sms.failed": { status: "failed" },
  "sms.expired": { status: "expired" },
};
// a later state never goes back to an earlier one
const RANK: Record<string, number> = { queued: 0, sending: 1, sent: 2, delivered: 3, read: 4, failed: 5, expired: 5 };

export async function action({ request }: ActionFunctionArgs) {
  const admin = getSupabaseAdminClient();
  const { webhookSecret } = await rasvioSecrets();
  if (!admin || !webhookSecret) return data({ received: false, reason: "not_configured" }, { status: 503 });
  const raw = await request.text();
  if (raw.length > 64_000 || !verifyRasvioSignature(raw, request.headers.get("rasvio-timestamp"), request.headers.get("rasvio-signature"), webhookSecret)) {
    return data({ received: false, reason: "bad_signature" }, { status: 401 });
  }
  let event: { type?: string; data?: Record<string, unknown> };
  try { event = JSON.parse(raw); } catch { return data({ received: false, reason: "bad_json" }, { status: 400 }); }
  const type = String(event.type ?? "");
  const d = event.data ?? {};

  if (type === "whatsapp.number.status") {
    const session = String(d.session_id ?? "");
    if (session) {
      await admin.from("wa_senders").update({ status: String(d.status ?? ""), checked_at: new Date().toISOString() }).eq("session_id", session);
      forgetRouting();
    }
    return data({ received: true });
  }

  const map = STATUS[type];
  const id = String(d.message_id ?? d.id ?? "");
  if (!map || !id) return data({ received: true, ignored: type });
  const { data: row, error } = await admin.from("message_deliveries").select("id, status").eq("provider_id", id).maybeSingle();
  if (error) return data({ received: false }, { status: 500 });
  if (!row) return data({ received: true, unknown: true });
  if ((RANK[map.status] ?? 0) < (RANK[row.status as string] ?? 0) && map.status !== "failed") return data({ received: true, stale: true });
  const now = new Date().toISOString();
  await admin.from("message_deliveries").update({
    status: map.status, updated_at: now,
    ...(map.at ? { [map.at]: now } : {}),
    ...(map.status === "failed" || map.status === "expired" ? { error: String(d.error_code ?? map.status) } : {}),
  }).eq("id", row.id);
  return data({ received: true });
}

export const loader = () => data({ ok: false, reason: "method_not_allowed" }, { status: 405 });

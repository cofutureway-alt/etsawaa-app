import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail } from "~/lib/email/server";
import { formatPiastres } from "~/lib/money";
import type { Locale } from "~/lib/i18n/config";

/**
 * Order lifecycle emails (O-13) — templates come from the `email_templates`
 * DB table; every attempt lands in email_logs. Best-effort by design: a mail
 * outage never blocks an order that is already durable in the DB.
 */

export type OrderEmailKind =
  | "order_confirmation"
  | "payment_success"
  | "payment_failed"
  | "order_shipped"
  | "order_delivered"
  | "order_cancelled";

interface OrderEmailContext {
  number: string;
  email: string;
  full_name: string;
  total_piastres: number;
  payment_method: "kashier" | "cod";
  cancel_reason: string | null;
  locale: Locale;
  site_url: string;
}

async function loadContext(admin: SupabaseClient, orderNumber: string): Promise<OrderEmailContext | null> {
  const { data: order } = await admin
    .from("orders")
    .select("number, email, total_piastres, payment_method, cancel_reason, profiles(full_name, locale)")
    .eq("number", orderNumber)
    .maybeSingle();
  if (!order) return null;
  const profiles = (order as unknown as { profiles: { full_name: string; locale: Locale } | null }).profiles;
  return {
    number: order.number,
    email: order.email,
    full_name: profiles?.full_name ?? "",
    total_piastres: order.total_piastres,
    payment_method: order.payment_method,
    cancel_reason: order.cancel_reason,
    locale: profiles?.locale === "en" ? "en" : "ar",
    site_url: process.env.SITE_URL?.replace(/\/$/, "") ?? "",
  };
}

function varsFor(ctx: OrderEmailContext): Record<string, string> {
  const base = {
    customer_name: ctx.full_name,
    order_number: ctx.number,
    order_total: formatPiastres(ctx.total_piastres, ctx.locale),
    payment_method: ctx.payment_method === "cod" ? (ctx.locale === "ar" ? "الدفع عند الاستلام" : "Cash on delivery") : (ctx.locale === "ar" ? "بطاقة/محفظة إلكترونية" : "Card / e-wallet"),
    order_url: `${ctx.site_url}/${ctx.locale}/order/${encodeURIComponent(ctx.number)}`,
    track_url: `${ctx.site_url}/${ctx.locale}/order/${encodeURIComponent(ctx.number)}/track`,
    retry_url: `${ctx.site_url}/${ctx.locale}/order/${encodeURIComponent(ctx.number)}?kashier=retry`,
    review_url: `${ctx.site_url}/${ctx.locale}/account/orders/${encodeURIComponent(ctx.number)}`,
    reason: ctx.cancel_reason ?? (ctx.locale === "ar" ? "غير محدد" : "not specified"),
    review_days: "30",
    return_days: "14",
  };
  return base;
}

/** Fire one order email. Returns the provider status for logging/tests. */
export async function sendOrderEmail(
  admin: SupabaseClient,
  orderNumber: string,
  kind: OrderEmailKind,
): Promise<{ status: string; error?: string }> {
  const ctx = await loadContext(admin, orderNumber);
  if (!ctx) return { status: "failed", error: "order_not_found" };
  if (!ctx.email) return { status: "failed", error: "no_email" };
  const result = await sendEmail(admin, {
    to: ctx.email,
    templateKey: kind,
    locale: ctx.locale,
    variables: varsFor(ctx),
  });
  return { status: result.status === "sent" ? "sent" : result.status, error: result.status === "sent" ? undefined : result.error };
}

/* Webhook-friendly aliases (fire-and-forget call sites in the webhook route). */
export async function sendPaymentEmails(admin: SupabaseClient, orderNumber: string, kind: "payment_success" | "payment_failed"): Promise<void> {
  await sendOrderEmail(admin, orderNumber, kind);
}

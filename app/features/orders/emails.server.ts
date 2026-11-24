import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail } from "~/lib/email/server";
import { formatPiastres } from "~/lib/money";
import type { Locale } from "~/lib/i18n/config";
import { loadRouting, routeFor, sendEventTexts } from "~/lib/messaging/dispatch.server";

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
  phone: string | null;
  user_id: string | null;
  full_name: string;
  total_piastres: number;
  payment_method: "kashier" | "cod";
  cancel_reason: string | null;
  locale: Locale;
  site_url: string;
}

async function loadContext(admin: SupabaseClient, orderNumber: string, locale?: Locale): Promise<OrderEmailContext | null> {
  const { data: order } = await admin
    .from("orders")
    .select("number, email, phone_primary, user_id, total_piastres, payment_method, cancel_reason, profiles(full_name, locale)")
    .eq("number", orderNumber)
    .maybeSingle();
  if (!order) return null;
  const profiles = (order as unknown as { profiles: { full_name: string; locale: Locale } | null }).profiles;
  return {
    number: order.number,
    email: order.email,
    phone: (order as { phone_primary?: string | null }).phone_primary ?? null,
    user_id: (order as { user_id?: string | null }).user_id ?? null,
    full_name: profiles?.full_name ?? "",
    total_piastres: order.total_piastres,
    payment_method: order.payment_method,
    cancel_reason: order.cancel_reason,
    locale: locale ?? (profiles?.locale === "en" ? "en" : "ar"),
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
  locale?: Locale,
): Promise<{ status: string; error?: string }> {
  const ctx = await loadContext(admin, orderNumber, locale);
  if (!ctx) return { status: "failed", error: "order_not_found" };
  // the order confirmation also goes by SMS / WhatsApp, as Admin → Messages says
  let emailOn = true;
  if (kind === "order_confirmation") {
    const routing = await loadRouting(admin);
    emailOn = routeFor(routing, kind, "customer").email;
    void sendEventTexts(admin, { eventKey: kind, audience: "customer", phone: ctx.phone, locale: ctx.locale, variables: varsFor(ctx), userId: ctx.user_id, reference: ctx.number, routing }).catch(() => undefined);
  }
  if (!emailOn) return { status: "skipped", error: "email_off" };
  if (!ctx.email) return { status: "failed", error: "no_email" };
  const result = await sendEmail(admin, {
    to: ctx.email,
    templateKey: kind,
    locale: ctx.locale,
    variables: varsFor(ctx),
  });
  return { status: result.status === "sent" ? "sent" : result.status, error: result.status === "sent" ? undefined : result.error };
}

/** Card orders: the confirmation texts go out once the payment succeeds. */
export async function sendOrderConfirmationTexts(admin: SupabaseClient, orderNumber: string): Promise<void> {
  const ctx = await loadContext(admin, orderNumber);
  if (!ctx) return;
  await sendEventTexts(admin, { eventKey: "order_confirmation", audience: "customer", phone: ctx.phone, locale: ctx.locale, variables: varsFor(ctx), userId: ctx.user_id, reference: ctx.number });
}

/* Webhook-friendly aliases (fire-and-forget call sites in the webhook route). */
export async function sendPaymentEmails(admin: SupabaseClient, orderNumber: string, kind: "payment_success" | "payment_failed"): Promise<void> {
  await sendOrderEmail(admin, orderNumber, kind);
  if (kind === "payment_success") await sendOrderConfirmationTexts(admin, orderNumber);
}

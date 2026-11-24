import { getSupabaseAdminClient } from "~/lib/supabase/admin";
import { getI18n } from "~/lib/i18n/config";
import { formatNotification } from "~/features/notifications/format";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail } from "./server";
import { audienceOf } from "~/lib/messaging/catalog";
import { loadRouting, routeFor, sendEventTexts } from "~/lib/messaging/dispatch.server";
import { rasvio } from "~/lib/messaging/rasvio.server";

/**
 * Event emails: every in-app notification (product approved / returned for
 * changes, store decisions, verification, payments, refunds, penalties,
 * packaging, admin alerts…) is also emailed to its recipient when an ACTIVE
 * `event:<type>` template exists (Admin → Email templates: edit or switch each
 * event off). One in-process worker per server; each row is claimed before
 * sending (emailed_at stamped first) so a restart never double-sends.
 * Rows that existed before this feature were stamped by migration 015.
 */

const TICK_MS = 45_000;
const BATCH = 40;
let started = false;

export function ensureNotifyWorker(): void {
  if (started || typeof setInterval === "undefined") return;
  if (process.env.NOTIFY_EMAILS === "off") return;
  started = true;
  const timer = setInterval(() => { void tick().catch((e) => console.error("[notify-worker]", e instanceof Error ? e.message : e)); }, TICK_MS);
  (timer as { unref?: () => void }).unref?.();
  setTimeout(() => { void tick().catch(() => undefined); }, 5_000);
}

async function tick(): Promise<void> {
  const admin = getSupabaseAdminClient();
  if (!admin) return;
  void checkBalance(admin).catch(() => undefined);
  const { data: settings } = await admin.from("settings").select("value").eq("key", "notifications").maybeSingle();
  const emailOn = (settings?.value as { email_enabled?: boolean } | null)?.email_enabled !== false;

  const { data: rows } = await admin.from("notifications").select("id, user_id, type, payload, created_at")
    .is("emailed_at", null).order("created_at").limit(BATCH);
  if (!rows?.length) return;

  const [{ data: templates }, { data: people }, routing] = await Promise.all([
    admin.from("email_templates").select("key").in("key", [...new Set(rows.map((r) => `event:${r.type as string}`))]),
    admin.from("profiles").select("id, email, full_name, locale, phone, role").in("id", [...new Set(rows.map((r) => r.user_id as string))]),
    loadRouting(admin),
  ]);
  const hasTemplate = new Set(((templates ?? []) as Array<{ key: string }>).map((t) => t.key));
  const who = new Map(((people ?? []) as Person[]).map((p) => [p.id, p]));
  const site = (process.env.SITE_URL ?? "").replace(/\/$/, "");

  for (const row of rows as Array<{ id: string; user_id: string; type: string; payload: Record<string, unknown> | null; created_at: string }>) {
    // claim: only the process that stamps emailed_at sends
    const { data: claimed } = await admin.from("notifications").update({ emailed_at: new Date().toISOString(), email_status: "sending" })
      .eq("id", row.id).is("emailed_at", null).select("id");
    if (!claimed?.length) continue;
    const person = who.get(row.user_id);
    const key = `event:${row.type}`;
    const audience = audienceOf(row.type, person?.role, row.payload?.fanout === "1");
    const route = routeFor(routing, row.type, audience);
    let status = "skipped";
    if (!route.enabled) status = "off";
    else if (Date.now() - new Date(row.created_at).getTime() > 3 * 86_400_000) status = "stale";
    else try {
      const locale = person?.locale === "en" ? "en" : "ar";
      const t = getI18n(locale).t;
      const view = formatNotification({ type: row.type, payload: row.payload }, locale, t, false);
      const variables = {
        title: view.title, body: view.body || view.title,
        link: `${site}${view.link ?? `/${locale}`}`,
        name: person?.full_name || person?.email || "", site_name: locale === "ar" ? "إتسوء" : "Etsawaa",
      };
      if (!route.email || !emailOn) status = "email_off";
      else if (!hasTemplate.has(key)) status = "no_template";
      else if (!person?.email) status = "no_email";
      else status = (await sendEmail(admin, { to: person.email, templateKey: key, locale, variables, force: true })).status;
      if (route.sms || route.whatsapp) {
        const phone = (await orderPhone(admin, row.payload, audience)) ?? person?.phone ?? null;
        await sendEventTexts(admin, { eventKey: row.type, audience, phone, locale, variables, userId: row.user_id, reference: row.id, routing });
      }
    } catch (e) {
      // a claimed row must never stay "sending" forever
      status = "failed";
      console.error("[notify-worker]", row.id, e instanceof Error ? e.message : e);
    }
    await admin.from("notifications").update({ email_status: status }).eq("id", row.id);
  }
}

interface Person { id: string; email: string | null; full_name: string; locale: string; phone: string | null; role: string }

/** Order messages go to the number the order was placed with (verified at checkout). */
async function orderPhone(admin: SupabaseClient, payload: Record<string, unknown> | null, audience: string): Promise<string | null> {
  const number = typeof payload?.order_number === "string" ? payload.order_number : null;
  if (audience !== "customer" || !number) return null;
  const { data } = await admin.from("orders").select("phone_primary").eq("number", number).maybeSingle();
  return (data?.phone_primary as string | undefined) ?? null;
}

/** Hourly: warn the admins once a day when the SMS balance drops under the owner's limit. */
let lastBalanceCheck = 0;
async function checkBalance(admin: SupabaseClient): Promise<void> {
  if (Date.now() - lastBalanceCheck < 3_600_000) return;
  lastBalanceCheck = Date.now();
  const { data: cfg } = await admin.from("settings").select("value").eq("key", "messaging").maybeSingle();
  const limit = Number((cfg?.value as { sms_low_balance?: number } | null)?.sms_low_balance ?? 0);
  if (!limit) return;
  const res = await rasvio.balance();
  if (!res.ok || res.data.sms?.unlimited || res.data.sms?.remaining == null || res.data.sms.remaining >= limit) return;
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { count } = await admin.from("notifications").select("id", { count: "exact", head: true }).eq("type", "messaging.low_balance").gte("created_at", since);
  if (count) return;
  const left = res.data.sms.remaining;
  const { data: admins } = await admin.from("profiles").select("id").eq("role", "admin").neq("status", "blocked");
  for (const a of (admins ?? []) as Array<{ id: string }>) {
    await admin.rpc("fn_notify", { p_user: a.id, p_type: "messaging.low_balance", p_payload: {
      ar: { title: `رصيد رسائل SMS قليل: باقي ${left} رسالة`, body: "اشحن رصيد Rasvio حتى لا تتوقف الرسائل." },
      en: { title: `SMS balance is low: ${left} left`, body: "Top up Rasvio so messages keep sending." },
      link: "/admin/messages?tab=connection",
    } });
  }
}

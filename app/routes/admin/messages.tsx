import { data } from "react-router";
import type { Route } from "./+types/messages";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { getSupabaseAdminClient } from "~/lib/supabase/admin";
import { requirePanelAccess, requirePermission } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { sameOriginRequest } from "~/lib/locale-preference.server";
import { rateLimit } from "~/lib/rate-limit.server";
import { normalizeEgyptianPhone } from "~/lib/phone";
import { MESSAGE_EVENT_MAP, type Audience } from "~/lib/messaging/catalog";
import { unknownVariables } from "~/lib/messaging/text";
import { forgetRouting, sendText } from "~/lib/messaging/dispatch.server";
import { DEFAULT_API_BASE, forgetRasvioSecrets, rasvio, rasvioSecrets } from "~/lib/messaging/rasvio.server";
import { MessagesPage, type MessagesData, type MessagesResult } from "~/features/messages/MessagesPage";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonTable } from "~/components/ui/Skeleton";

/**
 * Admin → Messages and notifications. One tab per audience decides which
 * channels (email / SMS / WhatsApp) send each event and from which WhatsApp
 * number; the SMS / WhatsApp wording is edited here, the email wording in
 * the email editor. The Connection tab (admins only) holds the Rasvio key,
 * the WhatsApp numbers and a test send. All tables are written with the
 * service role after the checks below.
 */
const AUDIENCES: Audience[] = ["customer", "vendor", "staff", "admin", "account"];

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client, headers } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  const viewer = await requirePanelAccess(client, lang, "admin", request);
  requirePermission(viewer, "settings.email_templates");
  const admin = getSupabaseAdminClient();
  if (!admin) throw data({ reason: "db" }, { status: 503 });
  const isAdmin = viewer.profile.role === "admin";
  const url = new URL(request.url);
  const logChannel = url.searchParams.get("channel");
  const logStatus = url.searchParams.get("status");

  let log = admin.from("message_deliveries")
    .select("id, created_at, event_key, audience, channel, to_address, status, error, segments, wa_sender_id")
    .order("created_at", { ascending: false }).limit(100);
  if (logChannel === "sms" || logChannel === "whatsapp" || logChannel === "email") log = log.eq("channel", logChannel);
  if (logStatus === "failed") log = log.in("status", ["failed", "expired", "not_configured"]);
  if (logStatus === "ok") log = log.in("status", ["sent", "delivered", "read", "queued"]);

  const [routes, texts, senders, templates, settings, deliveries, secrets] = await Promise.all([
    admin.from("message_routes").select("event_key, audience, enabled, email, sms, whatsapp, wa_sender_id"),
    admin.from("message_texts").select("event_key, channel, body_ar, body_en"),
    admin.from("wa_senders").select("id, session_id, label, is_default, is_active, status, checked_at").order("created_at"),
    admin.from("email_templates").select("key, is_active"),
    admin.from("settings").select("value").eq("key", "messaging").maybeSingle(),
    log,
    isAdmin ? client.rpc("fn_admin_messaging_secrets") : Promise.resolve({ data: null }),
  ]);
  const { apiKey } = await rasvioSecrets();
  const cfg = (settings.data?.value ?? {}) as Record<string, unknown>;
  const page: MessagesData = {
    lang,
    isAdmin,
    connected: Boolean(apiKey),
    routes: (routes.data ?? []) as MessagesData["routes"],
    texts: (texts.data ?? []) as MessagesData["texts"],
    senders: (senders.data ?? []) as MessagesData["senders"],
    templates: Object.fromEntries(((templates.data ?? []) as Array<{ key: string; is_active: boolean }>).map((t) => [t.key, t.is_active])),
    settings: {
      api_base: typeof cfg.api_base === "string" ? cfg.api_base : DEFAULT_API_BASE,
      otp_channels: Array.isArray(cfg.otp_channels) ? (cfg.otp_channels as string[]).filter((c) => c === "sms" || c === "whatsapp") as Array<"sms" | "whatsapp"> : ["whatsapp", "sms"],
      otp_wa_sender: typeof cfg.otp_wa_sender === "string" ? cfg.otp_wa_sender : null,
      sms_low_balance: Number(cfg.sms_low_balance ?? 200) || 0,
    },
    secrets: isAdmin ? (((secrets.data as { secrets?: MessagesData["secrets"] } | null)?.secrets) ?? {}) : null,
    deliveries: (deliveries.data ?? []) as MessagesData["deliveries"],
    siteUrl: (process.env.SITE_URL ?? url.origin).replace(/\/$/, ""),
  };
  headers.set("Cache-Control", "private, no-store");
  return data(page, { headers });
}

const bool = (v: FormDataEntryValue | null) => v === "1" || v === "true" || v === "on";

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  if (!sameOriginRequest(request)) return data<MessagesResult>({ ok: false, intent: "", reason: "forbidden" }, { status: 403 });
  const { client, headers } = createSupabaseServerClient(request);
  const admin = getSupabaseAdminClient();
  if (!client || !admin) return data<MessagesResult>({ ok: false, intent: "", reason: "unavailable" }, { status: 503 });
  const viewer = await requirePanelAccess(client, lang, "admin", request);
  requirePermission(viewer, "settings.email_templates");
  const isAdmin = viewer.profile.role === "admin";
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const ok = (extra: Partial<MessagesResult> = {}) => data<MessagesResult>({ ok: true, intent, ...extra } as MessagesResult, { headers });
  const fail = (reason: string, status = 400) => data<MessagesResult>({ ok: false, intent, reason }, { status, headers });

  // ── which channels send an event (any page holder)
  if (intent === "route") {
    const key = String(form.get("event_key") ?? "");
    const audience = String(form.get("audience") ?? "") as Audience;
    const event = MESSAGE_EVENT_MAP.get(key);
    if (!event || !AUDIENCES.includes(audience)) return fail("bad_event");
    if (audience === "staff" ? !(event.audience === "admin" && event.staffPermission) : event.audience !== audience) return fail("bad_event");
    const sender = String(form.get("wa_sender_id") ?? "") || null;
    const row = {
      event_key: key, audience,
      enabled: audience === "staff" || audience === "account" ? bool(form.get("enabled")) : true,
      email: Boolean(event.emailTemplate) && audience !== "account" && bool(form.get("email")),
      sms: bool(form.get("sms")),
      whatsapp: bool(form.get("whatsapp")),
      wa_sender_id: sender && /^[0-9a-f-]{36}$/.test(sender) ? sender : null,
      staff_permission: audience === "staff" ? event.staffPermission ?? null : null,
      updated_at: new Date().toISOString(),
      updated_by: viewer.user.id,
    };
    const { error } = await admin.from("message_routes").upsert(row, { onConflict: "event_key,audience" });
    if (error) return fail("save_failed", 500);
    // the email editor's own on/off follows the main audience's email switch
    if (audience !== "staff" && event.emailTemplate) {
      await admin.from("email_templates").update({ is_active: row.email }).eq("key", event.emailTemplate);
    }
    forgetRouting();
    return ok({ message: "saved" });
  }

  // ── SMS / WhatsApp wording
  if (intent === "text") {
    const key = String(form.get("event_key") ?? "");
    const channel = String(form.get("channel") ?? "");
    const event = MESSAGE_EVENT_MAP.get(key);
    if (!event || (channel !== "sms" && channel !== "whatsapp")) return fail("bad_event");
    if (form.get("reset") === "1") {
      await admin.from("message_texts").delete().eq("event_key", key).eq("channel", channel);
      forgetRouting();
      return ok({ message: "reset" });
    }
    const ar = String(form.get("body_ar") ?? "").trim();
    const en = String(form.get("body_en") ?? "").trim();
    if (!ar || !en) return fail("text_empty");
    if (ar.length > 1600 || en.length > 1600) return fail("text_long");
    if (unknownVariables(`${ar}\n${en}`, event.variables).length) return fail("text_vars");
    if (event.audience === "account" && (!ar.includes("{{code}}") || !en.includes("{{code}}"))) return fail("text_code");
    const { error } = await admin.from("message_texts").upsert({ event_key: key, channel, body_ar: ar, body_en: en, updated_at: new Date().toISOString(), updated_by: viewer.user.id }, { onConflict: "event_key,channel" });
    if (error) return fail("save_failed", 500);
    forgetRouting();
    return ok({ message: "saved" });
  }

  // everything below is the connection: admins only
  if (!isAdmin) return fail("forbidden", 403);

  if (intent === "secret") {
    const name = String(form.get("name") ?? "");
    const { data: res, error } = await client.rpc("fn_admin_set_messaging_secret", { p_name: name, p_value: String(form.get("value") ?? "") });
    if (error || !res?.ok) return fail(res?.reason ?? "save_failed");
    forgetRasvioSecrets();
    return ok({ message: res.cleared ? "cleared" : "saved" });
  }

  if (intent === "settings") {
    const order = String(form.get("otp_order") ?? "whatsapp,sms").split(",").filter((c) => c === "sms" || c === "whatsapp");
    const base = String(form.get("api_base") ?? "").trim() || DEFAULT_API_BASE;
    if (!/^https:\/\/[^\s]+$/.test(base)) return fail("bad_url");
    const low = Math.max(0, Math.min(1_000_000, Math.round(Number(form.get("sms_low_balance") ?? 0) || 0)));
    const otpSender = String(form.get("otp_wa_sender") ?? "") || null;
    const { data: current } = await admin.from("settings").select("value").eq("key", "messaging").maybeSingle();
    const value = { ...((current?.value as object) ?? {}), api_base: base.replace(/\/$/, ""), otp_channels: order.length ? [...new Set(order)] : ["whatsapp", "sms"], sms_low_balance: low, otp_wa_sender: otpSender };
    const { error } = await admin.from("settings").upsert({ key: "messaging", value }, { onConflict: "key" });
    if (error) return fail("save_failed", 500);
    forgetRasvioSecrets(); forgetRouting();
    return ok({ message: "saved" });
  }

  if (intent === "check") {
    if (!rateLimit(`rasvio-check:${viewer.user.id}`, 10, 60_000)) return fail("too_many", 429);
    const [balance, sessions] = await Promise.all([rasvio.balance(), rasvio.sessions()]);
    if (!balance.ok) return fail(balance.code);
    // keep each saved number's live status
    if (sessions.ok) {
      const now = new Date().toISOString();
      await Promise.all(sessions.data.data.map((s) => admin.from("wa_senders").update({ status: s.status, checked_at: now }).eq("session_id", s.session_id)));
      forgetRouting();
    }
    return ok({ balance: balance.data, sessions: sessions.ok ? sessions.data.data : [] });
  }

  if (intent === "sender_add") {
    const session = String(form.get("session_id") ?? "").trim();
    const label = String(form.get("label") ?? "").trim().slice(0, 60);
    if (!/^ses_[A-Za-z0-9]{4,64}$/.test(session)) return fail("bad_session");
    if (!label) return fail("label_required");
    const { count } = await admin.from("wa_senders").select("id", { count: "exact", head: true });
    const { error } = await admin.from("wa_senders").insert({ session_id: session, label, is_default: !count, status: String(form.get("status") ?? "") || null, created_by: viewer.user.id });
    if (error) return fail(error.code === "23505" ? "session_exists" : "save_failed");
    forgetRouting();
    return ok({ message: "saved" });
  }

  if (intent === "sender_update") {
    const id = String(form.get("id") ?? "");
    if (!/^[0-9a-f-]{36}$/.test(id)) return fail("bad_id");
    if (form.get("make_default") === "1") {
      await admin.from("wa_senders").update({ is_default: false }).eq("is_default", true);
      await admin.from("wa_senders").update({ is_default: true, is_active: true }).eq("id", id);
    } else {
      const patch: Record<string, unknown> = {};
      if (form.has("label")) { const l = String(form.get("label")).trim().slice(0, 60); if (!l) return fail("label_required"); patch.label = l; }
      if (form.has("is_active")) patch.is_active = bool(form.get("is_active"));
      await admin.from("wa_senders").update(patch).eq("id", id);
    }
    forgetRouting();
    return ok({ message: "saved" });
  }

  if (intent === "sender_delete") {
    const id = String(form.get("id") ?? "");
    const { data: gone } = await admin.from("wa_senders").delete().eq("id", id).select("is_default").maybeSingle();
    if (gone?.is_default) {
      const { data: next } = await admin.from("wa_senders").select("id").order("created_at").limit(1).maybeSingle();
      if (next) await admin.from("wa_senders").update({ is_default: true }).eq("id", next.id);
    }
    forgetRouting();
    return ok({ message: "deleted" });
  }

  if (intent === "test") {
    if (!rateLimit(`rasvio-test:${viewer.user.id}`, 5, 60_000)) return fail("too_many", 429);
    const channel = form.get("channel") === "sms" ? "sms" : "whatsapp";
    const phone = normalizeEgyptianPhone(String(form.get("phone") ?? ""));
    if (!phone.ok) return fail("bad_phone");
    const body = lang === "en" ? "Etsawaa: this is a test message from the messages page." : "إتسوء: هذه رسالة تجربة من صفحة الرسائل والإشعارات.";
    const r = await sendText(admin, { channel, to: phone.e164, body, eventKey: "messaging.test", audience: "admin", userId: viewer.user.id, senderId: String(form.get("sender_id") ?? "") || null, reference: "test" });
    return r.status === "sent" ? ok({ message: "test_sent" }) : fail(r.error ?? r.status);
  }

  return fail("bad_intent");
}

export default function AdminMessages({ loaderData }: Route.ComponentProps) {
  return <MessagesPage {...loaderData} />;
}
export function ErrorBoundary() { return <RouteErrorBoundary />; }
export function HydrateFallback() { return <SkeletonTable />; }

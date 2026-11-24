import type { SupabaseClient } from "@supabase/supabase-js";
import { rasvio } from "./rasvio.server";
import { MESSAGE_EVENT_MAP, effectiveRoute, type Audience, type RouteRow } from "./catalog";
import { renderText, smsSize } from "./text";

/**
 * Sends the SMS / WhatsApp side of a message, following the owner's choices
 * in Admin → Messages (message_routes, message_texts, wa_senders). Email is
 * sent by its existing callers; they ask `routeFor` whether email is on.
 * Every attempt is a message_deliveries row; its id is Rasvio's
 * Idempotency-Key, so a retry never sends twice.
 */

export interface SenderRow { id: string; session_id: string; label: string; is_default: boolean; is_active: boolean; status: string | null }
interface Routing {
  routes: Map<string, RouteRow>;
  texts: Map<string, { body_ar: string; body_en: string }>;
  senders: SenderRow[];
  templatesActive: Map<string, boolean>;
  otpChannels: Array<"whatsapp" | "sms">;
  otpSender: string | null;
}

let cached: { value: Routing; expiresAt: number } | null = null;
export function forgetRouting(): void { cached = null; }

export async function loadRouting(admin: SupabaseClient): Promise<Routing> {
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const [routes, texts, senders, templates, settings] = await Promise.all([
    admin.from("message_routes").select("event_key, audience, enabled, email, sms, whatsapp, wa_sender_id"),
    admin.from("message_texts").select("event_key, channel, body_ar, body_en"),
    admin.from("wa_senders").select("id, session_id, label, is_default, is_active, status").order("created_at"),
    admin.from("email_templates").select("key, is_active"),
    admin.from("settings").select("value").eq("key", "messaging").maybeSingle(),
  ]);
  const cfg = (settings.data?.value ?? {}) as { otp_channels?: unknown; otp_wa_sender?: unknown };
  const otpChannels = (Array.isArray(cfg.otp_channels) ? cfg.otp_channels : ["whatsapp", "sms"])
    .filter((c): c is "whatsapp" | "sms" => c === "whatsapp" || c === "sms");
  const value: Routing = {
    routes: new Map(((routes.data ?? []) as RouteRow[]).map((r) => [`${r.event_key}|${r.audience}`, r])),
    texts: new Map(((texts.data ?? []) as Array<{ event_key: string; channel: string; body_ar: string; body_en: string }>).map((t) => [`${t.event_key}|${t.channel}`, t])),
    senders: (senders.data ?? []) as SenderRow[],
    templatesActive: new Map(((templates.data ?? []) as Array<{ key: string; is_active: boolean }>).map((t) => [t.key, t.is_active])),
    otpChannels: otpChannels.length ? otpChannels : ["whatsapp", "sms"],
    otpSender: typeof cfg.otp_wa_sender === "string" ? cfg.otp_wa_sender : null,
  };
  cached = { value, expiresAt: Date.now() + 30_000 };
  return value;
}

export function routeFor(routing: Routing, eventKey: string, audience: Audience): RouteRow {
  const event = MESSAGE_EVENT_MAP.get(eventKey);
  const template = event?.emailTemplate ?? `event:${eventKey}`;
  return effectiveRoute(event, audience, routing.routes.get(`${eventKey}|${audience}`), routing.templatesActive.get(template));
}

export function textFor(routing: Routing, eventKey: string, channel: "sms" | "whatsapp", locale: "ar" | "en"): string {
  const saved = routing.texts.get(`${eventKey}|${channel}`);
  if (saved) return locale === "en" ? saved.body_en : saved.body_ar;
  const event = MESSAGE_EVENT_MAP.get(eventKey);
  const fallback = event?.text ?? { ar: "إتسوء: {{title}}\n{{link}}", en: "Etsawaa: {{title}}\n{{link}}" };
  return locale === "en" ? fallback.en : fallback.ar;
}

/** The sender for a WhatsApp message: the chosen one if active and connected, else the default. */
export function pickSender(senders: SenderRow[], preferred: string | null): SenderRow | null {
  const usable = senders.filter((s) => s.is_active && s.status !== "logged_out" && s.status !== "disconnected");
  return usable.find((s) => s.id === preferred) ?? usable.find((s) => s.is_default) ?? usable[0] ?? null;
}

export interface TextSendInput {
  channel: "sms" | "whatsapp";
  to: string;
  body: string;
  eventKey: string;
  audience?: Audience | null;
  userId?: string | null;
  senderId?: string | null;
  reference?: string;
}
export type TextSendResult = { status: "sent" | "failed" | "not_configured" | "no_sender"; error?: string; deliveryId?: string };

export async function sendText(admin: SupabaseClient, input: TextSendInput, senders?: SenderRow[]): Promise<TextSendResult> {
  if (!/^\+\d{10,15}$/.test(input.to)) return { status: "failed", error: "invalid_number" };
  let sender: SenderRow | null = null;
  if (input.channel === "whatsapp") {
    sender = pickSender(senders ?? (await loadRouting(admin)).senders, input.senderId ?? null);
    if (!sender) return { status: "no_sender", error: "no_whatsapp_number" };
  }
  const { data: row, error } = await admin.from("message_deliveries").insert({
    event_key: input.eventKey, audience: input.audience ?? null, channel: input.channel, user_id: input.userId ?? null,
    to_address: input.to, status: "sending", wa_sender_id: sender?.id ?? null, reference: input.reference ?? null,
    segments: input.channel === "sms" ? smsSize(input.body).parts : null,
  }).select("id").single();
  if (error || !row) return { status: "failed", error: "log_failed" };
  const reference = (input.reference ?? input.eventKey).slice(0, 64);
  const res = input.channel === "whatsapp"
    ? await rasvio.sendWhatsApp({ to: input.to, body: input.body, session_id: sender!.session_id, reference }, row.id)
    : await rasvio.sendSms({ to: input.to, body: input.body, reference }, row.id);
  const now = new Date().toISOString();
  if (!res.ok) {
    await admin.from("message_deliveries").update({ status: res.code === "not_configured" ? "not_configured" : "failed", error: res.code, updated_at: now }).eq("id", row.id);
    return { status: res.code === "not_configured" ? "not_configured" : "failed", error: res.code, deliveryId: row.id };
  }
  const d = res.data as { id: string; status: string; segments?: number };
  await admin.from("message_deliveries").update({
    status: d.status === "failed" ? "failed" : d.status, provider_id: d.id, updated_at: now,
    sent_at: d.status === "sent" ? now : null, ...(d.segments ? { segments: d.segments } : {}),
  }).eq("id", row.id);
  return { status: d.status === "failed" ? "failed" : "sent", deliveryId: row.id };
}

/** SMS + WhatsApp for one event, as the route says. Returns what happened per channel. */
export async function sendEventTexts(admin: SupabaseClient, input: {
  eventKey: string; audience: Audience; phone: string | null | undefined; locale: "ar" | "en";
  variables: Record<string, string>; userId?: string | null; reference?: string; routing?: Routing;
}): Promise<Partial<Record<"sms" | "whatsapp", TextSendResult["status"]>>> {
  const routing = input.routing ?? (await loadRouting(admin));
  const route = routeFor(routing, input.eventKey, input.audience);
  const out: Partial<Record<"sms" | "whatsapp", TextSendResult["status"]>> = {};
  if (!route.enabled || !input.phone) return out;
  for (const channel of ["whatsapp", "sms"] as const) {
    if (!route[channel]) continue;
    const body = renderText(textFor(routing, input.eventKey, channel, input.locale), input.variables);
    if (!body) continue;
    const r = await sendText(admin, {
      channel, to: input.phone, body, eventKey: input.eventKey, audience: input.audience,
      userId: input.userId, senderId: route.wa_sender_id, reference: input.reference,
    }, routing.senders);
    out[channel] = r.status;
  }
  return out;
}

/** A one-time code: first channel in the owner's order, then the next one if it fails. */
export async function sendCodeText(admin: SupabaseClient, input: {
  eventKey: "otp.verify" | "otp.checkout" | "otp.reset"; phone: string; code: string; locale: "ar" | "en"; userId?: string | null;
}): Promise<{ ok: boolean; channel?: "sms" | "whatsapp"; reason?: string }> {
  const routing = await loadRouting(admin);
  const route = routeFor(routing, input.eventKey, "account");
  const order = routing.otpChannels.filter((c) => route[c]);
  if (!route.enabled || !order.length) return { ok: false, reason: "no_channel" };
  let last = "failed";
  for (const channel of order) {
    const body = renderText(textFor(routing, input.eventKey, channel, input.locale), { code: input.code });
    const r = await sendText(admin, {
      channel, to: input.phone, body, eventKey: input.eventKey, audience: "account", userId: input.userId ?? null,
      senderId: route.wa_sender_id ?? routing.otpSender, reference: input.eventKey,
    }, routing.senders);
    if (r.status === "sent") return { ok: true, channel };
    last = r.status;
  }
  return { ok: false, reason: last };
}

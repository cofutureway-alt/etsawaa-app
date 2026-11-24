import { data } from "react-router";
import type { Route } from "./+types/phone-code";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { getSupabaseAdminClient } from "~/lib/supabase/admin";
import { getViewer } from "~/lib/auth/guards";
import { sameOriginRequest } from "~/lib/locale-preference.server";
import { clientKey, rateLimit } from "~/lib/rate-limit.server";
import { normalizeEgyptianPhone } from "~/lib/phone";
import { checkPhoneCode, markPhoneVerified, sendPhoneCode } from "~/lib/messaging/otp.server";

/**
 * POST /api/phone-code — a signed-in person proves a phone number.
 *   intent=send  purpose=verify|checkout  phone   → a code by WhatsApp / SMS
 *   intent=check purpose=verify|checkout  phone code → the number is theirs
 * "verify" is the account number only; "checkout" any Egyptian mobile (the
 * order's shipping number). Password reset codes live in /auth/forgot.
 */
export type PhoneCodeResult =
  | { ok: true; sent?: true; verified?: true; channel?: "sms" | "whatsapp"; resendIn?: number }
  | { ok: false; reason: string; resendIn?: number };

export async function action({ request }: Route.ActionArgs) {
  if (!sameOriginRequest(request)) return data<PhoneCodeResult>({ ok: false, reason: "forbidden" }, { status: 403 });
  const { client, headers } = createSupabaseServerClient(request);
  const admin = getSupabaseAdminClient();
  if (!client || !admin) return data<PhoneCodeResult>({ ok: false, reason: "unavailable" }, { status: 503 });
  const { viewer } = (await getViewer(client)) ?? { viewer: null };
  if (!viewer) return data<PhoneCodeResult>({ ok: false, reason: "auth_required" }, { status: 401, headers });

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const purpose = form.get("purpose") === "checkout" ? "checkout" : "verify";
  const locale = form.get("lang") === "en" ? "en" : "ar";
  const phone = normalizeEgyptianPhone(String(form.get("phone") ?? ""));
  if (!phone.ok) return data<PhoneCodeResult>({ ok: false, reason: "bad_phone" }, { status: 400, headers });
  if (purpose === "verify" && viewer.profile.phone !== phone.e164) return data<PhoneCodeResult>({ ok: false, reason: "not_your_phone" }, { status: 400, headers });

  if (intent === "send") {
    const ip = clientKey(request);
    if (!rateLimit(`phone-code:user:${viewer.user.id}`, 6, 10 * 60_000) || (ip && !rateLimit(`phone-code:ip:${ip}`, 12, 10 * 60_000))) {
      return data<PhoneCodeResult>({ ok: false, reason: "too_many" }, { status: 429, headers });
    }
    const r = await sendPhoneCode(admin, { phone: phone.e164, purpose, userId: viewer.user.id, locale, ip });
    return data<PhoneCodeResult>(r.ok ? { ok: true, sent: true, channel: r.channel, resendIn: r.resendIn } : { ok: false, reason: r.reason, resendIn: r.resendIn }, { headers });
  }
  if (intent === "check") {
    if (!rateLimit(`phone-check:user:${viewer.user.id}`, 20, 10 * 60_000)) return data<PhoneCodeResult>({ ok: false, reason: "too_many" }, { status: 429, headers });
    const code = String(form.get("code") ?? "").replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/\D/g, "");
    if (code.length !== 6) return data<PhoneCodeResult>({ ok: false, reason: "wrong" }, { headers });
    const r = await checkPhoneCode(admin, { phone: phone.e164, purpose, code, userId: viewer.user.id });
    if (!r.ok) return data<PhoneCodeResult>({ ok: false, reason: r.reason }, { headers });
    await markPhoneVerified(admin, viewer.user.id, phone.e164);
    return data<PhoneCodeResult>({ ok: true, verified: true }, { headers });
  }
  return data<PhoneCodeResult>({ ok: false, reason: "bad_intent" }, { status: 400, headers });
}

export const loader = () => data({ ok: false, reason: "method_not_allowed" }, { status: 405 });

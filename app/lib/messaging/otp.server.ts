import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadRouting, routeFor, sendCodeText } from "./dispatch.server";
import { rasvioSecrets } from "./rasvio.server";

/**
 * One-time phone codes (sign-up verification, checkout, password reset).
 * Only a hash is stored. Limits protect our message balance:
 *   - 3 codes per number per 10 minutes, 10 per day
 *   - 5 wrong tries per code, 10 minutes validity
 * (IP limits are applied by the calling route.)
 */

export type CodePurpose = "verify" | "checkout" | "reset";
const EVENT: Record<CodePurpose, "otp.verify" | "otp.checkout" | "otp.reset"> = { verify: "otp.verify", checkout: "otp.checkout", reset: "otp.reset" };
const TTL_MS = 10 * 60_000;
export const RESEND_SECONDS = 60;

function hashCode(id: string, code: string): string {
  return createHash("sha256").update(`${id}:${code}`).digest("hex");
}

export type SendCodeResult =
  | { ok: true; channel: "sms" | "whatsapp"; resendIn: number }
  | { ok: false; reason: "too_soon" | "too_many" | "send_failed" | "no_channel"; resendIn?: number };

export async function sendPhoneCode(admin: SupabaseClient, input: {
  phone: string; purpose: CodePurpose; userId?: string | null; locale: "ar" | "en"; ip?: string | null;
}): Promise<SendCodeResult> {
  const since10 = new Date(Date.now() - 10 * 60_000).toISOString();
  const sinceDay = new Date(Date.now() - 86_400_000).toISOString();
  const { data: recent } = await admin.from("phone_codes").select("created_at").eq("phone", input.phone).gte("created_at", sinceDay).order("created_at", { ascending: false });
  const rows = (recent ?? []) as Array<{ created_at: string }>;
  const last = rows[0] ? Date.parse(rows[0].created_at) : 0;
  const wait = Math.ceil((last + RESEND_SECONDS * 1000 - Date.now()) / 1000);
  if (wait > 0) return { ok: false, reason: "too_soon", resendIn: wait };
  if (rows.filter((r) => r.created_at >= since10).length >= 3 || rows.length >= 10) return { ok: false, reason: "too_many" };

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const { data: row, error } = await admin.from("phone_codes").insert({
    phone: input.phone, purpose: input.purpose, user_id: input.userId ?? null, code_hash: "pending",
    expires_at: new Date(Date.now() + TTL_MS).toISOString(), ip: input.ip ?? null,
  }).select("id").single();
  if (error || !row) return { ok: false, reason: "send_failed" };
  await admin.from("phone_codes").update({ code_hash: hashCode(row.id, code) }).eq("id", row.id);

  const sent = await sendCodeText(admin, { eventKey: EVENT[input.purpose], phone: input.phone, code, locale: input.locale, userId: input.userId });
  if (!sent.ok) {
    await admin.from("phone_codes").update({ consumed_at: new Date().toISOString() }).eq("id", row.id);
    return { ok: false, reason: sent.reason === "no_channel" ? "no_channel" : "send_failed" };
  }
  await admin.from("phone_codes").update({ channel: sent.channel }).eq("id", row.id);
  return { ok: true, channel: sent.channel!, resendIn: RESEND_SECONDS };
}

export type CheckCodeResult = { ok: true; userId: string | null } | { ok: false; reason: "wrong" | "expired" | "too_many_tries" };

/** Checks the newest open code for this number and purpose; a right code is used up. */
export async function checkPhoneCode(admin: SupabaseClient, input: { phone: string; purpose: CodePurpose; code: string; userId?: string | null }): Promise<CheckCodeResult> {
  let q = admin.from("phone_codes").select("id, code_hash, attempts, expires_at, user_id")
    .eq("phone", input.phone).eq("purpose", input.purpose).is("consumed_at", null).neq("code_hash", "pending")
    .order("created_at", { ascending: false }).limit(1);
  if (input.userId) q = q.eq("user_id", input.userId);
  const { data } = await q.maybeSingle();
  const row = data as { id: string; code_hash: string; attempts: number; expires_at: string; user_id: string | null } | null;
  if (!row || Date.parse(row.expires_at) < Date.now()) return { ok: false, reason: "expired" };
  if (row.attempts >= 5) return { ok: false, reason: "too_many_tries" };
  const expected = Buffer.from(row.code_hash, "hex");
  const given = Buffer.from(hashCode(row.id, input.code.trim()), "hex");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    await admin.from("phone_codes").update({ attempts: row.attempts + 1 }).eq("id", row.id);
    return { ok: false, reason: row.attempts + 1 >= 5 ? "too_many_tries" : "wrong" };
  }
  await admin.from("phone_codes").update({ consumed_at: new Date().toISOString() }).eq("id", row.id);
  return { ok: true, userId: row.user_id };
}

/** Records that this user owns this number (and stamps the profile when it is theirs). */
export async function markPhoneVerified(admin: SupabaseClient, userId: string, phone: string): Promise<void> {
  await admin.from("user_verified_phones").upsert({ user_id: userId, phone, verified_at: new Date().toISOString() }, { onConflict: "user_id,phone" });
  await admin.from("profiles").update({ phone_verified_at: new Date().toISOString() }).eq("id", userId).eq("phone", phone);
}

/** True when this user has already proven this number. */
export async function isPhoneVerified(admin: SupabaseClient, userId: string, phone: string): Promise<boolean> {
  const { data } = await admin.from("user_verified_phones").select("phone").eq("user_id", userId).eq("phone", phone).maybeSingle();
  return Boolean(data);
}

/**
 * Codes can only be asked for when Rasvio is connected and the code event has
 * a channel on. Until then checkout and sign-up never block on a phone code.
 */
export async function codesAvailable(admin: SupabaseClient, purpose: CodePurpose): Promise<boolean> {
  const { apiKey } = await rasvioSecrets();
  if (!apiKey) return false;
  const routing = await loadRouting(admin);
  const route = routeFor(routing, EVENT[purpose], "account");
  return route.enabled && routing.otpChannels.some((c) => route[c]);
}

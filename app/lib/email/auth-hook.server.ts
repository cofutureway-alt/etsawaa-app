import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { localeFromRedirect } from "~/lib/locale-preference.server";
import type { Locale } from "~/lib/i18n/config";

/** Standard Webhooks signing; authenticate the raw bytes before JSON parsing. */
export function verifyAuthEmailHook(raw: string, headers: Headers, secrets: string, now = Date.now()): boolean {
  const id = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  const signatures = headers.get("webhook-signature") ?? "";
  if (!id || !timestamp || !/^\d+$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  for (const entry of secrets.split("|")) {
    const secret = entry.trim().replace(/^v1,/, "").replace(/^whsec_/, "");
    if (!/^[A-Za-z0-9+/]+=*$/.test(secret)) continue;
    const key = Buffer.from(secret, "base64");
    if (key.length < 32) continue;
    const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${raw}`).digest();
    for (const part of signatures.split(/\s+/)) {
      if (!part.startsWith("v1,")) continue;
      const provided = Buffer.from(part.slice(3), "base64");
      if (provided.length === expected.length && timingSafeEqual(provided, expected)) return true;
    }
  }
  return false;
}

export const authEmailPayloadSchema = z.object({
  user: z.object({ id: z.string().uuid(), email: z.string().email(), new_email: z.string().optional().nullable(), user_metadata: z.record(z.string(), z.unknown()).optional() }),
  email_data: z.object({ email_action_type: z.enum(["signup", "recovery", "magiclink", "invite", "email_change", "reauthentication"]), token: z.string(), token_hash: z.string(), token_new: z.string().optional(), token_hash_new: z.string().optional(), redirect_to: z.string().optional() }),
});
export type AuthEmailPayload = z.infer<typeof authEmailPayloadSchema>;

export function authEmailLocale(payload: AuthEmailPayload, site: string, saved?: Locale): Locale {
  const meta = payload.user.user_metadata?.locale;
  return localeFromRedirect(payload.email_data.redirect_to, site) ?? saved ?? (meta === "en" ? "en" : "ar");
}

/** Secure Email Change deliberately uses reversed hash names in GoTrue. */
export function authEmailMessages(payload: AuthEmailPayload, locale: Locale, site: string, expirySeconds = 3600): Array<{ to: string; key: string; variables: Record<string, string> }> {
  const { user, email_data: e } = payload;
  const type = e.email_action_type;
  const urlFor = (hash: string) => {
    const path = type === "recovery" || type === "invite" ? "forgot" : "verify";
    const url = new URL(`/${locale}/auth/${path}`, site);
    url.searchParams.set("token_hash", hash);
    url.searchParams.set("type", type);
    return url.href;
  };
  const message = (to: string, token: string, hash: string, key: string) => {
    if (!to || (type !== "invite" && !token) || (type !== "reauthentication" && !hash)) throw new Error("invalid_auth_email_fields");
    return { to, key: `auth:${key}`, variables: { code: token, confirmation_url: urlFor(hash), expires_minutes: String(Math.ceil(expirySeconds / 60)), email: to } };
  };
  if (type === "email_change") {
    if (!user.new_email) throw new Error("missing_new_email");
    if (e.token_new && e.token_hash_new) return [
      message(user.email, e.token, e.token_hash_new, "email_change_current"),
      message(user.new_email, e.token_new, e.token_hash, "email_change"),
    ];
    return [message(user.new_email, e.token_new || e.token, e.token_hash, "email_change")];
  }
  return [message(user.email, e.token, e.token_hash, type)];
}

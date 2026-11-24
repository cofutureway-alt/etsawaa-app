import type { SupabaseClient } from "@supabase/supabase-js";
import { isLocale, DEFAULT_LOCALE, type Locale } from "./i18n/config";

export const LOCALE_COOKIE = "etsawaa_locale";
export function cookieLocale(request: Request): Locale | null {
  const value = request.headers.get("cookie")?.split(";").map((v) => v.trim()).find((v) => v.startsWith(`${LOCALE_COOKIE}=`))?.slice(LOCALE_COOKIE.length + 1);
  return isLocale(value) ? value : null;
}
export function sameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const publicOrigin = new URL(process.env.SITE_URL || request.url).origin;
  return origin === new URL(request.url).origin || origin === publicOrigin || (!origin && request.headers.get("sec-fetch-site") === "same-origin");
}
export async function rememberLocale(client: SupabaseClient, locale: Locale): Promise<boolean> {
  const { data, error } = await client.rpc("fn_set_preferred_locale", { p_locale: locale });
  if (error) console.warn("[locale] preference could not be saved");
  return !error && data === true;
}

/** For delayed mail: always read the recipient's latest server-side preference. */
export async function recipientLocale(admin: SupabaseClient, email: string, fallback: Locale = DEFAULT_LOCALE): Promise<Locale> {
  const { data } = await admin.from("profiles").select("locale").ilike("email", email.replace(/[%_\\]/g, "\\$&")).limit(1).maybeSingle();
  return isLocale(data?.locale) ? data.locale : fallback;
}

export function localeFromRedirect(redirect: string | undefined, siteUrl: string): Locale | null {
  try {
    const url = new URL(redirect ?? "");
    if (url.origin !== new URL(siteUrl).origin) return null;
    const segment = url.pathname.split("/")[1];
    return isLocale(segment) ? segment : null;
  } catch { return null; }
}

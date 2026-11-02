import { isLocale, type Locale } from "~/lib/i18n/config";

/** Validate the :lang route param server-side; anything else is a 404. */
export function requireLang(params: { lang?: string }): Locale {
  if (!isLocale(params.lang)) {
    throw new Response("Not Found", { status: 404 });
  }
  return params.lang;
}

import { createInstance, type i18n as I18nInstance } from "i18next";
import { initReactI18next } from "react-i18next";

export const LOCALES = ["ar", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "ar";

export function isLocale(value: string | undefined | null): value is Locale {
  return value === "ar" || value === "en";
}

/** Direction per locale — drives `<html dir>` at SSR. */
export function dirFor(locale: Locale): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}

/**
 * Dictionaries are loaded per language. The two together are ~470 KB of
 * source (130 KB gzipped) and used to ship to every visitor; now:
 *  - server: both are registered at boot (lib/i18n/dictionaries.server.ts,
 *    imported by entry.server), so SSR, meta() and e-mails stay synchronous;
 *  - browser: only the page's language is fetched before hydration
 *    (entry.client), and the other one when the visitor switches language
 *    (root clientLoader awaits ensureLocale before the new page renders).
 */
type Dictionary = Record<string, string>;
const dictionaries: Partial<Record<Locale, Dictionary>> = {};
const loaders: Record<Locale, () => Promise<Dictionary>> = {
  ar: () => import("./ar").then((m) => m.ar as Dictionary),
  en: () => import("./en").then((m) => m.en as Dictionary),
};

export function registerLocale(locale: Locale, dictionary: Dictionary): void {
  dictionaries[locale] = dictionary;
  clientInstance?.addResourceBundle(locale, "translation", dictionary, true, true);
}

/** Load a language's dictionary if it is not loaded yet (browser only needs this). */
export async function ensureLocale(locale: Locale): Promise<void> {
  if (dictionaries[locale]) return;
  registerLocale(locale, await loaders[locale]());
}

function loadedResources() {
  return Object.fromEntries(Object.entries(dictionaries).map(([k, v]) => [k, { translation: v }]));
}

export function createI18n(locale: Locale): I18nInstance {
  const instance = createInstance();
  void instance.use(initReactI18next).init({
    lng: locale,
    // fall back within what is loaded (both key sets are identical anyway)
    fallbackLng: dictionaries[DEFAULT_LOCALE] ? DEFAULT_LOCALE : locale,
    resources: loadedResources(),
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
    returnNull: false,
  });
  return instance;
}

let clientInstance: I18nInstance | null = null;

/** Server: one instance per request. Client: a single reused instance. */
export function getI18n(locale: Locale): I18nInstance {
  if (typeof window === "undefined") return createI18n(locale);
  if (!clientInstance) clientInstance = createI18n(locale);
  // only on a real switch: changeLanguage() re-scans the dictionary and makes
  // every translated component re-render, and the root calls getI18n on
  // EVERY render — calling it unconditionally turned each client navigation
  // into a re-render loop (5 s on the bigger admin pages)
  else if (clientInstance.language !== locale) void clientInstance.changeLanguage(locale);
  return clientInstance;
}

/**
 * Swap the locale segment of a pathname while keeping every other segment,
 * the query string and the hash — language switching never loses your place.
 * Defensive: a pathname that accidentally carries ?query#hash is cleaned.
 */
export function switchLocalePath(pathname: string, search: string, hash: string, next: Locale): string {
  const cleanPath = pathname.split(/[?#]/, 1)[0] ?? pathname;
  const segments = cleanPath.split("/").filter(Boolean);
  if (segments.length > 0 && isLocale(segments[0])) segments[0] = next;
  else segments.unshift(next);
  return `/${segments.join("/")}${search}${hash}`;
}

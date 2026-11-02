import { createInstance, type i18n as I18nInstance } from "i18next";
import { initReactI18next } from "react-i18next";
import { ar } from "./ar";
import { en } from "./en";

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

export const resources = {
  ar: { translation: ar },
  en: { translation: en },
} as const;

/**
 * All resources ship statically (they are small), so i18n is synchronous on
 * both server and client — no async loading, no missing-key flicker.
 */
export function createI18n(locale: Locale): I18nInstance {
  const instance = createInstance();
  void instance.use(initReactI18next).init({
    lng: locale,
    fallbackLng: DEFAULT_LOCALE,
    resources,
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
  else void clientInstance.changeLanguage(locale);
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

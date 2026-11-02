import type { Locale } from "~/lib/i18n/config";

/**
 * Money is always integer piastres (`*_piastres`) — floats are forbidden
 * (AGENT.md §7). Pure formatting — covered by tests/money.test.ts.
 */

export function formatPiastres(piastres: number, locale: Locale): string {
  const value = piastres / 100;
  return new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-EG", {
    style: "currency",
    currency: "EGP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

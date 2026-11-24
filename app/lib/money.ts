import type { Locale } from "~/lib/i18n/config";

/**
 * Money is always integer piastres (`*_piastres`) — floats are forbidden
 * (AGENT.md §7). Pure formatting — covered by tests/money.test.ts.
 */

// one formatter per locale: building an Intl.NumberFormat is far costlier
// than using one, and tables format hundreds of prices per render
const formatters = new Map<string, Intl.NumberFormat>();
function moneyFormat(locale: Locale): Intl.NumberFormat {
  let f = formatters.get(locale);
  if (!f) {
    f = new Intl.NumberFormat(locale === "ar" ? "ar-EG-u-nu-latn" : "en-EG", {
      style: "currency",
      currency: "EGP",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    formatters.set(locale, f);
  }
  return f;
}

export function formatPiastres(piastres: number, locale: Locale): string {
  return moneyFormat(locale).format(piastres / 100);
}

/**
 * Admin/vendor forms take prices in Egyptian pounds ("1" = 1 EGP,
 * "1.5" = 1 EGP 50 piastres); storage stays integer piastres. Accepts
 * Arabic-Indic digits and the Arabic decimal mark. Returns null for anything
 * that is not a non-negative amount with at most two decimals.
 */
export function egpToPiastres(input: unknown): number | null {
  if (input == null) return null;
  const text = String(input)
    .trim()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[٫,]/g, ".")
    .replace(/[\s٬]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole = "0", frac = ""] = text.split(".");
  const piastres = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return Number.isSafeInteger(piastres) ? piastres : null;
}

/** Signed variant for wallet adjustments ("-12.5" → -1250). */
export function signedEgpToPiastres(input: unknown): number | null {
  const text = String(input ?? "").trim();
  const negative = text.startsWith("-") || text.startsWith("−");
  const abs = egpToPiastres(negative ? text.slice(1) : text.replace(/^\+/, ""));
  return abs == null ? null : negative ? -abs : abs;
}

/** Piastres → the plain pound value for an input field (150 → "1.5", 100 → "1"). */
export function piastresToEgp(piastres: number | null | undefined): string {
  if (piastres == null || !Number.isFinite(piastres)) return "";
  const sign = piastres < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(piastres));
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  return `${sign}${whole}${frac ? `.${String(frac).padStart(2, "0").replace(/0$/, "")}` : ""}`;
}

/**
 * Shared money formatting for the checkout UI: piastres in, localized EGP
 * string out. Same formatter the checkout route always used — extracted so
 * every checkout section renders identical amounts.
 */

/** Format an integer piastre amount as EGP in the active language. */
export function formatMoney(language: string | undefined, piastres: number): string {
  return new Intl.NumberFormat(language?.startsWith("en") ? "en-EG" : "ar-EG-u-nu-latn", {
    style: "currency", currency: "EGP", maximumFractionDigits: 2,
  }).format(piastres / 100);
}

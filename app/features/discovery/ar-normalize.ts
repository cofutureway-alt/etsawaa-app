/**
 * Client mirror of the DB `ar_norm()` (hamza/alef variants, taa marbuta,
 * alef maqsura, tashkeel) — used where the UI needs the same matching
 * behavior (tests, future client-side highlighting). Keep in sync with the
 * SQL function in 20261031000005_phase04_storefront.sql.
 */
export function arNorm(input: string): string {
  return (input ?? "")
    .replace(/[\u064B-\u0652\u0670\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .toLowerCase();
}

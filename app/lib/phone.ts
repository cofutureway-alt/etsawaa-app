/**
 * Egyptian phone normalization (PLAN.md §8: "unique phone index +
 * normalization (+20, strip spaces)").
 * Pure functions — covered by tests/phone.test.ts.
 */

const EGYPT_COUNTRY_CODE = "+20";

const VALID_MOBILE_PREFIXES = ["010", "011", "012", "015"] as const;

export type PhoneResult =
  | { ok: true; e164: string; local: string }
  | { ok: false; reason: "not_a_number" | "wrong_prefix" | "wrong_length" };

/**
 * Normalize any common Egyptian mobile spelling to E.164 (+20XXXXXXXXXX)
 * and local form (01XXXXXXXXX). Accepts Arabic-Indic digits, strips spaces,
 * dashes, dots and parentheses.
 */
export function normalizeEgyptianPhone(input: string): PhoneResult {
  // Convert Arabic-Indic and Extended Arabic-Indic digits to ASCII.
  const ascii = input.replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (d) =>
    String(d.charCodeAt(0) & 0xf),
  );
  let digits = ascii.replace(/[\s\-().]/g, "");
  if (!/^\+?\d+$/.test(digits)) return { ok: false, reason: "not_a_number" };

  // Strip country prefixes: +20 / 0020 / bare 20 (only when it leaves 10 digits).
  if (digits.startsWith("+20")) digits = digits.slice(3);
  else if (digits.startsWith("0020")) digits = digits.slice(4);
  else if (digits.length === 12 && digits.startsWith("20")) digits = digits.slice(2);
  if (!digits.startsWith("0") && digits.length === 10) digits = `0${digits}`;

  if (!/^01\d{9}$/.test(digits)) {
    if (digits.length === 11) return { ok: false, reason: "wrong_prefix" };
    return { ok: false, reason: "wrong_length" };
  }
  const prefix = digits.slice(0, 3) as (typeof VALID_MOBILE_PREFIXES)[number];
  if (!(VALID_MOBILE_PREFIXES as readonly string[]).includes(prefix)) {
    return { ok: false, reason: "wrong_prefix" };
  }
  return { ok: true, e164: `${EGYPT_COUNTRY_CODE}${digits.slice(1)}`, local: digits };
}

/** Mask a normalized phone for display: +20 100 ••• 4567 */
export function maskPhone(e164: string): string {
  if (!/^\+\d{12}$/.test(e164)) return e164;
  return `${e164.slice(0, 4)} ${e164.slice(4, 7)} ••• ${e164.slice(-4)}`;
}

/** True when the string looks like an email (used to route login identifier). */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

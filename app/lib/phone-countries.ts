/**
 * Countries the phone fields accept. Only Egypt is on today; adding one is
 * a row here plus its number rules in ~/lib/phone. Pure — tested.
 */

export interface PhoneCountry {
  code: string;
  dial: string;
  flag: string;
  name_ar: string;
  name_en: string;
  placeholder: string;
  /** digits in the local form, leading 0 included */
  localDigits: number;
  groups: number[];
}

export const PHONE_COUNTRIES: PhoneCountry[] = [
  { code: "EG", dial: "+20", flag: "/flags/eg.svg", name_ar: "مصر", name_en: "Egypt", placeholder: "010 1234 5678", localDigits: 11, groups: [3, 4, 4] },
];

export const DEFAULT_COUNTRY = PHONE_COUNTRIES[0]!;

/** Arabic-Indic and Persian digits → ASCII. */
export function asciiDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (d) => String(d.charCodeAt(0) & 0xf));
}

/** A sign-in value that is becoming a phone number: starts with a digit or "+", no letters or "@". */
export function looksLikePhone(value: string): boolean {
  const v = asciiDigits(value).trim();
  return /^[+\d]/.test(v) && /^[+\d\s\-().]*$/.test(v);
}

/** Digits of the local number: "+20 10 1234 5678" / "0020101..." / "010-1234" → "01012345678". */
export function localDigits(value: string, country: PhoneCountry = DEFAULT_COUNTRY): string {
  let d = asciiDigits(value).replace(/[^\d+]/g, "");
  const dial = country.dial.slice(1);
  if (d.startsWith(`+${dial}`)) d = d.slice(dial.length + 1);
  else if (d.startsWith(`00${dial}`)) d = d.slice(dial.length + 2);
  d = d.replace(/\D/g, "");
  if (d && !d.startsWith("0") && d.length >= country.localDigits - 1) d = `0${d}`;
  return d.slice(0, country.localDigits);
}

/** "01012345678" → "010 1234 5678" (partial input keeps its groups). */
export function formatLocal(digits: string, country: PhoneCountry = DEFAULT_COUNTRY): string {
  const out: string[] = [];
  let i = 0;
  for (const size of country.groups) {
    if (i >= digits.length) break;
    out.push(digits.slice(i, i + size));
    i += size;
  }
  if (i < digits.length) out.push(digits.slice(i));
  return out.join(" ");
}

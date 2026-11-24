/**
 * Display names for spec units. `attribute_defs.unit` stores a short machine
 * unit ("cm", "kg", "W"); the Arabic store shows the Arabic abbreviation.
 * Technical units customers read in Latin anyway (GB, MP, HDMI-style codes)
 * stay as they are.
 */
const AR: Record<string, string> = {
  mm: "مم", cm: "سم", m: "م", km: "كم", in: "بوصة", "m²": "م²", "m³/h": "م³/ساعة",
  g: "جم", kg: "كجم", mg: "مجم",
  mL: "مل", ml: "مل", L: "لتر", "L/min": "لتر/دقيقة", "g/min": "جم/دقيقة",
  W: "وات", kW: "كيلووات", V: "فولت", A: "أمبير", Ah: "أمبير/ساعة", mAh: "مللي أمبير",
  h: "ساعة", min: "دقيقة", s: "ثانية", month: "شهر", year: "سنة",
  "km/h": "كم/ساعة", rpm: "لفة/دقيقة", bar: "بار", dB: "ديسيبل", lm: "لومن", nit: "نت",
  pair: "زوج", slot: "فتحة", x: "×", count: "",
};

export function unitLabel(unit: string | null | undefined, lang: "ar" | "en"): string {
  if (!unit) return "";
  if (unit === "count") return "";
  return lang === "ar" ? (AR[unit] ?? unit) : unit;
}

/**
 * A spec value with its unit: numbers always get it; free text gets it only
 * when the seller typed a bare number ("30" → "30 سم", but "30 × 20 سم" stays).
 */
export function withUnit(value: string, unit: string | null | undefined, lang: "ar" | "en"): string {
  const u = unitLabel(unit, lang);
  if (!u) return value;
  return /^\s*[\d٠-٩]+([.,٫][\d٠-٩]+)?\s*$/.test(value) ? `${value.trim()} ${u}` : value;
}

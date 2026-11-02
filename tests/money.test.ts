import { test } from "node:test";
import assert from "node:assert/strict";
import { formatPiastres } from "../app/lib/money.ts";

test("money is always integer piastres formatted as EGP (AGENT.md §7)", () => {
  assert.ok(formatPiastres(125000, "en").includes("1,250.00"));
  assert.ok(formatPiastres(125000, "ar").length > 0);
  assert.ok(formatPiastres(99900, "en").includes("999.00"));
  assert.ok(formatPiastres(5, "en").includes("0.05"));
  assert.ok(formatPiastres(0, "en").includes("0.00"));
});

test("arabic formatting keeps digits convertible (tabular-nums handled in CSS)", () => {
  // The ar-EG locale formats with Arabic-Indic digits; both renders must be non-empty.
  const ar = formatPiastres(125000, "ar");
  assert.ok(ar.length > 0);
  assert.ok(/[0-9\u0660-\u0669]/.test(ar), "must contain digits");
});

test("arabic formatter emits Arabic-Indic digits, the ar separators and the EGP suffix", () => {
  const ar = formatPiastres(125000, "ar");
  assert.match(ar, /[\u0660-\u0669]/, "Arabic-Indic digits");
  assert.doesNotMatch(ar, /[0-9]/, "no Latin digits in the ar render");
  assert.ok(ar.includes("\u066C"), "Arabic thousands separator");
  assert.ok(ar.includes("\u066B"), "Arabic decimal separator");
  assert.ok(ar.includes("ج.م"), "EGP suffix in Arabic");
  assert.ok(formatPiastres(0, "ar").includes("\u0660\u066B\u0660\u0660"), "zero → ٠٫٠٠");
});

test("english formatter keeps Latin digits and EGP with two decimals", () => {
  assert.equal(formatPiastres(125000, "en").replace(/\s+/g, " ").trim(), "EGP 1,250.00");
  assert.equal(formatPiastres(5, "en").replace(/\s+/g, " ").trim(), "EGP 0.05");
  assert.ok(formatPiastres(125000, "en").includes(","), "thousands separator");
});

test("negative amounts keep their sign in both locales", () => {
  const en = formatPiastres(-474400, "en");
  assert.ok(en.includes("-") && en.includes("4,744.00"), en);
  const ar = formatPiastres(-474400, "ar");
  assert.match(ar, /\u0664\u066C\u0667\u0664\u0664\u066B\u0660\u0660/, ar); // ٤٬٧٤٤٫٠٠
});

test("every piastre value renders exactly two decimals", () => {
  for (const p of [0, 1, 5, 99, 100, 12345, 99999999]) {
    for (const locale of ["ar", "en"] as const) {
      const out = formatPiastres(p, locale);
      const decimals = locale === "en" ? out.split(".")[1] : out.split("\u066B")[1];
      assert.match(decimals ?? "", /^[\d\u0660-\u0669]{2}/, `${p}/${locale} → ${out}`);
    }
  }
});

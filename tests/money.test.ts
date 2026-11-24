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

// owner rule 2026-11-07: standard digits (1 2 3) everywhere, Arabic UI included
test("arabic formatter uses standard digits with the EGP suffix", () => {
  const ar = formatPiastres(125000, "ar");
  assert.doesNotMatch(ar, /[\u0660-\u0669\u06F0-\u06F9]/, "no Eastern Arabic digits");
  assert.ok(ar.includes("1,250.00"), ar);
  assert.ok(ar.includes("ج.م"), "EGP suffix in Arabic");
  assert.ok(formatPiastres(0, "ar").includes("0.00"), "zero → 0.00");
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
  assert.ok(ar.includes("-") && ar.includes("4,744.00"), ar);
});

test("every piastre value renders exactly two decimals", () => {
  for (const p of [0, 1, 5, 99, 100, 12345, 99999999]) {
    for (const locale of ["ar", "en"] as const) {
      const out = formatPiastres(p, locale);
      const decimals = out.split(".")[1];
      assert.match(decimals ?? "", /^\d{2}/, `${p}/${locale} → ${out}`);
    }
  }
});

test("EGP form input converts to integer piastres", async () => {
  const { egpToPiastres, signedEgpToPiastres, piastresToEgp } = await import("../app/lib/money.ts");
  assert.equal(egpToPiastres("1"), 100);
  assert.equal(egpToPiastres("1.5"), 150);
  assert.equal(egpToPiastres("1.05"), 105);
  assert.equal(egpToPiastres("0"), 0);
  assert.equal(egpToPiastres("١٫٥"), 150);
  assert.equal(egpToPiastres("2,25"), 225);
  assert.equal(egpToPiastres("1.005"), null);
  assert.equal(egpToPiastres("-1"), null);
  assert.equal(egpToPiastres("abc"), null);
  assert.equal(egpToPiastres(""), null);
  assert.equal(signedEgpToPiastres("-12.5"), -1250);
  assert.equal(signedEgpToPiastres("+3"), 300);
  assert.equal(piastresToEgp(150), "1.5");
  assert.equal(piastresToEgp(100), "1");
  assert.equal(piastresToEgp(105), "1.05");
  assert.equal(piastresToEgp(-1250), "-12.5");
  assert.equal(piastresToEgp(null), "");
});

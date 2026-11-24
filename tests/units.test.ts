import { test } from "node:test";
import assert from "node:assert/strict";
import { unitLabel, withUnit } from "../app/lib/units";

test("unitLabel: Arabic abbreviations, English untouched, count hidden", () => {
  assert.equal(unitLabel("cm", "ar"), "سم");
  assert.equal(unitLabel("kg", "ar"), "كجم");
  assert.equal(unitLabel("cm", "en"), "cm");
  assert.equal(unitLabel("GB", "ar"), "GB");
  assert.equal(unitLabel("count", "ar"), "");
  assert.equal(unitLabel("", "ar"), "");
  assert.equal(unitLabel(null, "en"), "");
});

test("withUnit: only bare numbers get the unit", () => {
  assert.equal(withUnit("30", "cm", "ar"), "30 سم");
  assert.equal(withUnit("1.5", "kg", "en"), "1.5 kg");
  assert.equal(withUnit("٣٠", "cm", "ar"), "٣٠ سم");
  assert.equal(withUnit("30 × 20 سم", "cm", "ar"), "30 × 20 سم");
  assert.equal(withUnit("قطن", "cm", "ar"), "قطن");
  assert.equal(withUnit("30", "", "ar"), "30");
});

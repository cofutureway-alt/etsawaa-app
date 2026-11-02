/**
 * Event-discount math (mirrors fn_create_order's SQL expression).
 * Regression guard for the inverted cap that raised the price to
 * max_discount_piastres instead of limiting the discount to it.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { applyEventDiscount } from "../app/features/checkout/pricing.server.ts";

test("percent discount applies when under the cap", () => {
  // 1000 piastres, 10% off, cap 500 → discount 100 (< cap) → 900
  assert.equal(applyEventDiscount(1000, 10, 500), 900);
});

test("cap limits the discount, never raises the price", () => {
  // The reported bug: 6000 @ 50% = 3000 discount, capped at 5000
  // → the old code returned 5000; the correct answer is 6000-5000 = 1000? No:
  // discount is min(3000, 5000) = 3000 → 3000.
  assert.equal(applyEventDiscount(6000, 50, 5000), 3000);
});

test("cap below the computed discount truncates it", () => {
  // 10000 @ 50% = 5000 discount, cap 1000 → discount 1000 → 9000
  assert.equal(applyEventDiscount(10000, 50, 1000), 9000);
});

test("null cap means no ceiling", () => {
  assert.equal(applyEventDiscount(1000, 25, null), 750);
});

test("zero/negative percent is a no-op", () => {
  assert.equal(applyEventDiscount(1234, 0, 500), 1234);
  assert.equal(applyEventDiscount(1234, -5, 500), 1234);
});

test("discount never drives the price negative", () => {
  assert.equal(applyEventDiscount(100, 100, null), 0);
  assert.equal(applyEventDiscount(100, 100, 50), 50);
});

test("integer piastres only — truncates, never floats", () => {
  const out = applyEventDiscount(999, 33, null);
  assert.equal(Number.isInteger(out), true);
  assert.equal(out, 999 - Math.trunc((999 * 33) / 100));
});

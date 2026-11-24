import { test } from "node:test";
import assert from "node:assert/strict";
import { afterSaleKind, canCompletePayment, orderDate } from "../app/features/orders/customer-actions.ts";

const base = { status: "pending_payment", payment_method: "kashier", payment_status: "unpaid", delivered_at: null as string | null };

test("an unpaid card order can be paid; cash, paid or cancelled ones cannot", () => {
  assert.equal(canCompletePayment(base), true);
  assert.equal(canCompletePayment({ ...base, payment_method: "cod" }), false);
  assert.equal(canCompletePayment({ ...base, payment_status: "paid" }), false);
  assert.equal(canCompletePayment({ ...base, status: "cancelled" }), false);
});

test("return within 14 days of delivery, warranty up to 30, nothing after or before delivery", () => {
  const now = Date.parse("2026-11-30T12:00:00Z");
  const ago = (d: number) => new Date(now - d * 86_400_000).toISOString();
  assert.equal(afterSaleKind(base, now), null);
  assert.equal(afterSaleKind({ ...base, delivered_at: ago(1) }, now), "return");
  assert.equal(afterSaleKind({ ...base, delivered_at: ago(20) }, now), "warranty");
  assert.equal(afterSaleKind({ ...base, delivered_at: ago(31) }, now), null);
});

test("order date has no invisible direction marks", () => {
  const d = orderDate("2026-11-08T00:05:43Z", false);
  assert.equal(d, "8/11/2026");
  assert.equal(orderDate("2026-11-08T00:05:43Z", true), "08/11/2026");
});

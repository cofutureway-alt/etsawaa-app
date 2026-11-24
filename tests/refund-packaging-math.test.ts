import { test } from "node:test";
import assert from "node:assert/strict";
import { lineRefund, refundTotals, vendorDebit, type LineState } from "../app/features/orders/refund-math.ts";
import { availableQty, baseQty, lineError, orderTotals, type PackagingItem } from "../app/features/packaging/pricing.ts";

// The same line the SQL test used: 2 units, line 200 EGP, coupon share 15 EGP, commission 10 EGP.
const line: LineState = { qty: 2, qty_returned: 0, qty_left: 2, buyer_net: 18500, amount_refunded: 0, amount_left: 18500, vendor_net: 17500, commission: 1000 };

test("partial return refunds exactly the returned units, with their coupon share", () => {
  assert.equal(lineRefund(line, 1), 9250);
  assert.equal(lineRefund(line, 2), 18500);
  assert.equal(lineRefund(line, 3), 0, "never more units than are left");
});

test("the last units take the exact remainder — no rounding loss across returns", () => {
  const odd: LineState = { ...line, qty: 3, qty_left: 3, buyer_net: 10000, amount_left: 10000 };
  const first = lineRefund(odd, 1);
  const after: LineState = { ...odd, qty_returned: 1, qty_left: 2, amount_refunded: first, amount_left: 10000 - first };
  const rest = lineRefund(after, 2);
  assert.equal(first + rest, 10000);
});

test("vendor gives back its net share; vendor fault means the whole refund", () => {
  assert.equal(vendorDebit(line, 9250, false), 8750);
  assert.equal(vendorDebit(line, 18500, true), 18500);
  assert.equal(vendorDebit(line, 5000, false), 4730);
});

test("shipping refund is capped and the deduction never exceeds the refund", () => {
  assert.deepEqual(refundTotals([9250, 18500], 2000, 5000, 0), { items: 27750, shipping: 2000, deduction: 0, total: 29750 });
  assert.equal(refundTotals([1000], 9000, 500, 0).shipping, 500);
  assert.equal(refundTotals([1000], 0, 0, 5000).total, 0);
  assert.equal(refundTotals([], 2000, 2000, 0).total, 0, "no lines → no shipping refund");
});

const roll: PackagingItem = { id: "r", unit: "roll", roll_length_m: 50, price_piastres: 7000, meter_price_piastres: 200, stock_base: 120, min_qty: 1, max_qty: null };

test("rolls consume metres of stock; metres are sold from the same stock", () => {
  assert.equal(baseQty(roll, "roll", 2), 100);
  assert.equal(availableQty(roll, "roll"), 2);
  assert.equal(lineError(roll, "roll", 3), "out_of_stock");
  assert.equal(lineError(roll, "meter", 20, 100), null);
  assert.equal(lineError(roll, "meter", 21, 100), "out_of_stock");
  assert.equal(lineError(roll, "piece", 1), "bad_unit");
});

test("50% plan: deposit rounds up, the rest is the open balance", () => {
  const t = orderTotals(21000, 10000, "split", 50);
  assert.deepEqual([t.total, t.deposit, t.later, t.dueNow], [31000, 15500, 15500, 15500]);
  const odd = orderTotals(10001, 0, "split", 50);
  assert.equal(odd.deposit + odd.later, 10001);
  assert.equal(orderTotals(21000, 10000, "full", 50).dueNow, 31000);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { bulkFill, cartesianOptionKeys, combinationCount, optionKeyOf } from "../app/features/products/variant";

test("cartesian: 3 colors × 4 sizes = 12 ordered combinations", () => {
  const colors = ["c1", "c2", "c3"];
  const sizes = ["s1", "s2", "s3", "s4"];
  const combos = cartesianOptionKeys([
    { attribute_id: "color", option_ids: colors },
    { attribute_id: "size", option_ids: sizes },
  ]);
  assert.equal(combos.length, 12);
  // every combo carries one color + one size, sorted
  for (const combo of combos) {
    assert.equal(combo.length, 2);
    assert.deepEqual(combo, [...combo].sort());
  }
  // all distinct
  assert.equal(new Set(combos.map(optionKeyOf)).size, 12);
});

test("cartesian: single axis = N combos; zero axes = 1 plain combo", () => {
  assert.equal(cartesianOptionKeys([{ attribute_id: "a", option_ids: ["x", "y"] }]).length, 2);
  assert.deepEqual(cartesianOptionKeys([]), [[]]);
  assert.equal(combinationCount([]), 1);
});

test("optionKeyOf is canonical (order-independent)", () => {
  assert.equal(optionKeyOf(["b", "a"]), optionKeyOf(["a", "b"]));
});

test("bulkFill: empty_only touches blanks, all touches everything", () => {
  const rows = [
    { sku: "A", price: "" },
    { sku: "B", price: "10" },
  ];
  const emptied = bulkFill(rows, { price: "5" }, "empty_only");
  assert.equal(emptied[0]?.price, "5");
  assert.equal(emptied[1]?.price, "10");
  const all = bulkFill(rows, { price: "7" }, "all");
  assert.equal(all[0]?.price, "7");
  assert.equal(all[1]?.price, "7");
  // originals untouched (pure)
  assert.equal(rows[0]?.price, "");
});

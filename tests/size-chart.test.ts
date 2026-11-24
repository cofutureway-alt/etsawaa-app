import { test } from "node:test";
import assert from "node:assert/strict";
import { garmentFor } from "../app/features/products/size-chart.ts";

test("garmentFor only charts fashion / shoe branches", () => {
  // baby care sells pack volumes, not body measurements
  assert.equal(garmentFor(["baby-lotion", "baby-care", "baby-products"]), null);
  assert.equal(garmentFor(["bed-sheets", "bedding", "home"]), null);
  assert.equal(garmentFor(["sneakers", "shoes", "fashion"]), "shoes");
  assert.equal(garmentFor(["baby-bodysuit", "baby-clothes", "fashion"]), "kids");
});

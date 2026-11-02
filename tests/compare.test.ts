import test from "node:test";
import assert from "node:assert/strict";
import { compareProducts, toggleCompareStaging, type CompareProduct } from "../app/features/discovery/compare";
import { effectivePrice } from "../app/features/storefront/api";
import { arNorm } from "../app/features/discovery/ar-normalize";

/**
 * S-21/US-13 compare logic + price/normalization pure helpers (phase 04).
 */

function product(overrides: Partial<CompareProduct> & { id: string }): CompareProduct {
  return {
    name_ar: "منتج",
    name_en: "Product",
    slug_ar: "p",
    slug_en: "p",
    leaf_category_id: "cat-1",
    price_piastres: 10000,
    rating_avg: 4.5,
    rating_count: 3,
    store_name_ar: "متجر",
    store_name_en: "Store",
    store_slug: "store",
    image_path: null,
    attributes: [],
    ...overrides,
  };
}

test("compare: shared attributes only (same attribute id, valued on both sides)", () => {
  const a = product({
    id: "a",
    attributes: [
      { attribute_id: "color", label_ar: "اللون", label_en: "Color", value_ar: "أحمر", value_en: "Red" },
      { attribute_id: "size", label_ar: "المقاس", label_en: "Size", value_ar: "L", value_en: "L" },
      { attribute_id: "extra", label_ar: "إضافي", label_en: "Extra", value_ar: "س", value_en: "X" },
    ],
  });
  const b = product({
    id: "b",
    attributes: [
      { attribute_id: "color", label_ar: "اللون", label_en: "Color", value_ar: "أزرق", value_en: "Blue" },
      { attribute_id: "size", label_ar: "المقاس", label_en: "Size", value_ar: null, value_en: null },
      { attribute_id: "other", label_ar: "آخر", label_en: "Other", value_ar: "ص", value_en: "Y" },
    ],
  });
  const side = compareProducts(a, b, "ar");
  // size exists on both but has no value on b → not comparable; extra/other are one-sided
  assert.deepEqual(side.shared.map((s) => s.attribute_id), ["color"]);
  assert.equal(side.shared[0]?.value_a, "أحمر");
  assert.equal(side.shared[0]?.value_b, "أزرق");
});

test("compare: same category → no notice; different leaf categories → notice", () => {
  const a = product({ id: "a", attributes: [{ attribute_id: "x", label_ar: "س", label_en: "X", value_ar: "1", value_en: "1" }] });
  const b1 = product({ id: "b", attributes: [{ attribute_id: "x", label_ar: "س", label_en: "X", value_ar: "2", value_en: "2" }] });
  const b2 = product({ id: "b", leaf_category_id: "cat-2", attributes: [{ attribute_id: "x", label_ar: "س", label_en: "X", value_ar: "2", value_en: "2" }] });
  assert.equal(compareProducts(a, b1, "en").differentCategories, false);
  assert.equal(compareProducts(a, b2, "en").differentCategories, true);
});

test("compare: same product blocked (no shared rows) and null side → empty result", () => {
  const a = product({ id: "a", attributes: [{ attribute_id: "x", label_ar: "س", label_en: "X", value_ar: "1", value_en: "1" }] });
  assert.deepEqual(compareProducts(a, a, "ar").shared, []);
  assert.deepEqual(compareProducts(a, null, "ar").shared, []);
});

test("compare staging: max two, same id blocked, toggle removes", () => {
  const first = toggleCompareStaging([], "p1");
  assert.deepEqual(first.ids, ["p1"]);
  assert.equal(first.added, true);
  const second = toggleCompareStaging(["p1"], "p2");
  assert.deepEqual(second.ids, ["p1", "p2"]);
  const blocked = toggleCompareStaging(["p1", "p2"], "p3");
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.added, false);
  const dup = toggleCompareStaging(["p1", "p2"], "p1");
  assert.equal(dup.blocked, false);
  assert.deepEqual(dup.ids, ["p2"]);
});

test("effectivePrice: event percent applies on the sale-inclusive base, capped", () => {
  // base 10,000 (100 EGP), 10% event → 9,000
  assert.equal(effectivePrice({ min_price_piastres: 10000, event_percent: 10, event_max_piastres: null }), 9000);
  // capped at 5,000
  assert.equal(effectivePrice({ min_price_piastres: 10000, event_percent: 50, event_max_piastres: 5000 }), 5000);
  // no event → unchanged
  assert.equal(effectivePrice({ min_price_piastres: 12345, event_percent: 0, event_max_piastres: null }), 12345);
});

test("arNorm mirrors the SQL normalization (alef/hamza, taa marbuta, yaa, tashkeel)", () => {
  assert.equal(arNorm("أحمد"), arNorm("احمد"));
  assert.equal(arNorm("مُدرَّسةٍ"), arNorm("مدرسه"));
  assert.equal(arNorm("إسلام"), arNorm("اسلام"));
  assert.equal(arNorm("يُعطى"), arNorm("يعطي"));
  assert.equal(arNorm("آبار"), arNorm("ابار"));
});

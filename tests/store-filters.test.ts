import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyStoreFilters,
  buildStoreQuery,
  discountPercent,
  isOnOffer,
  parseStoreFilters,
  storeCategories,
  storeFilterCount,
  STORE_PAGE_SIZE,
} from "../app/features/storefront/store-filters.ts";
import type { ProductCard } from "../app/features/storefront/api.ts";

const base = (over: Partial<ProductCard>): ProductCard =>
  ({
    id: "p",
    name_ar: "x",
    name_en: "x",
    leaf_category_id: "00000000-0000-0000-0000-00000000000a",
    category_name_ar: "أ",
    category_name_en: "A",
    min_price_piastres: 10_000,
    min_sale_price_piastres: null,
    min_regular_piastres: 10_000,
    has_sale: false,
    event_percent: 0,
    event_max_piastres: null,
    stock_total: 5,
    rating_avg: null,
    rating_count: 0,
    is_listable: true,
    is_event_hidden: false,
    vendor_event_refused: false,
    published_at: "2026-01-01T00:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
    ...over,
  }) as ProductCard;

const EMPTY = parseStoreFilters(new URL("http://x/ar/store/s"));

test("parse + build round-trips every filter", () => {
  const url = new URL("http://x/s?cat=00000000-0000-0000-0000-00000000000b&pmin=50&pmax=900&off=1&stock=1&rating=4&sort=price_asc&page=3");
  const state = parseStoreFilters(url);
  assert.equal(state.category, "00000000-0000-0000-0000-00000000000b");
  assert.equal(state.priceMin, 5000);
  assert.equal(state.priceMax, 90_000);
  assert.equal(state.onOffer, true);
  assert.equal(state.inStock, true);
  assert.equal(state.rating, 4);
  assert.equal(state.sort, "price_asc");
  assert.equal(state.page, 3);
  assert.equal(buildStoreQuery(state), url.search);
});

test("rejects junk instead of trusting the URL", () => {
  const state = parseStoreFilters(new URL("http://x/s?cat=drop&pmin=-5&rating=9&sort=nope&page=-3"));
  assert.equal(state.category, null);
  assert.equal(state.priceMin, null);
  assert.equal(state.rating, 0);
  assert.equal(state.sort, "newest");
  assert.equal(state.page, 1);
});

test("offer means a real compare price above the selling price, or a live event", () => {
  assert.equal(isOnOffer(base({})), false);
  assert.equal(isOnOffer(base({ has_sale: true, min_price_piastres: 8_000, min_regular_piastres: 10_000 })), true);
  // has_sale with a null sale price must not read null as 0
  assert.equal(isOnOffer(base({ has_sale: true, min_regular_piastres: 10_000 })), false);
  // has_sale with no actual reduction is not an offer
  assert.equal(isOnOffer(base({ has_sale: true, min_price_piastres: 10_000, min_regular_piastres: 10_000 })), false);
  assert.equal(isOnOffer(base({ event_percent: 10 })), true);
});

test("discount percent follows the displayed price", () => {
  assert.equal(discountPercent(base({ min_price_piastres: 7_500, min_regular_piastres: 10_000, has_sale: true })), 25);
  assert.equal(discountPercent(base({ event_percent: 10 })), 10);
  assert.equal(discountPercent(base({})), 0);
});

test("price filter compares the effective price, not the base", () => {
  const p = base({ min_price_piastres: 10_000, event_percent: 50, event_max_piastres: null });
  // effective 5000 → inside this window, outside the un-discounted one
  assert.equal(applyStoreFilters([p], { ...EMPTY, priceMin: 4000, priceMax: 6000 }).total, 1);
  assert.equal(applyStoreFilters([p], { ...EMPTY, priceMin: 9000 }).total, 0);
});

test("sort orders by the same price the card shows", () => {
  const cheap = base({ id: "cheap", min_price_piastres: 5_000 });
  const dear = base({ id: "dear", min_price_piastres: 50_000, event_percent: 80 });
  const res = applyStoreFilters([dear, cheap], { ...EMPTY, sort: "price_asc" });
  assert.deepEqual(res.rows.map((r) => r.id), ["cheap", "dear"]);
});

test("pagination slices after filtering", () => {
  const rows = Array.from({ length: STORE_PAGE_SIZE + 1 }, (_, i) => base({ id: `p${i}` }));
  const first = applyStoreFilters(rows, EMPTY);
  assert.equal(first.total, STORE_PAGE_SIZE + 1);
  assert.equal(first.rows.length, STORE_PAGE_SIZE);
  const second = applyStoreFilters(rows, { ...EMPTY, page: 2 });
  assert.equal(second.rows.length, 1);
});

test("categories come from what the store sells, most-stocked first", () => {
  const cats = storeCategories([
    base({ leaf_category_id: "00000000-0000-0000-0000-00000000000a" }),
    base({ leaf_category_id: "00000000-0000-0000-0000-00000000000b" }),
    base({ leaf_category_id: "00000000-0000-0000-0000-00000000000b" }),
  ]);
  assert.equal(cats.length, 2);
  assert.equal(cats[0]!.id, "00000000-0000-0000-0000-00000000000b");
  assert.equal(cats[0]!.count, 2);
});

test("active-filter count ignores the sort and page", () => {
  assert.equal(storeFilterCount(EMPTY), 0);
  assert.equal(storeFilterCount({ ...EMPTY, sort: "discount", page: 4 }), 0);
  assert.equal(storeFilterCount({ ...EMPTY, onOffer: true, priceMax: 100 }), 2);
});

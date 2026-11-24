import { effectivePrice, type ProductCard } from "./api";

/**
 * Store-page filters.
 *
 * A store's catalogue is read in one query, so these run in memory and the
 * URL stays the single source of truth: `?cat=<leaf id>&pmin&pmax&off=1&sort`.
 * Every price below is the one the card displays (event discount applied),
 * which is why an offer filter can be exact instead of guessed from
 * `has_sale`.
 */

export const STORE_SORTS = ["newest", "price_asc", "price_desc", "rating", "discount"] as const;
export type StoreSort = (typeof STORE_SORTS)[number];

export interface StoreFilterState {
  category: string | null;
  priceMin: number | null;
  priceMax: number | null;
  /** only products carrying a sale price or an active event discount */
  onOffer: boolean;
  inStock: boolean;
  /** at or above this rating; 0 = any */
  rating: number;
  sort: StoreSort;
  page: number;
}

export const STORE_PAGE_SIZE = 24;

export function parseStoreFilters(url: URL): StoreFilterState {
  const sp = url.searchParams;
  const toPiastres = (raw: string | null): number | null => {
    if (!raw) return null;
    const n = Math.round(Number(raw) * 100);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 10_000_000) : null;
  };
  const rating = Number(sp.get("rating"));
  return {
    category: sp.get("cat")?.match(/^[0-9a-f-]{36}$/i)?.[0] ?? null,
    priceMin: toPiastres(sp.get("pmin")),
    priceMax: toPiastres(sp.get("pmax")),
    onOffer: sp.get("off") === "1",
    inStock: sp.get("stock") === "1",
    rating: [3, 4].includes(rating) ? rating : 0,
    sort: STORE_SORTS.includes(sp.get("sort") as never) ? (sp.get("sort") as StoreSort) : "newest",
    page: Math.max(1, Math.min(500, Number(sp.get("page")) || 1)),
  };
}

export function buildStoreQuery(state: StoreFilterState): string {
  const sp = new URLSearchParams();
  if (state.category) sp.set("cat", state.category);
  if (state.priceMin != null) sp.set("pmin", String(state.priceMin / 100));
  if (state.priceMax != null) sp.set("pmax", String(state.priceMax / 100));
  if (state.onOffer) sp.set("off", "1");
  if (state.inStock) sp.set("stock", "1");
  if (state.rating) sp.set("rating", String(state.rating));
  if (state.sort !== "newest") sp.set("sort", state.sort);
  if (state.page > 1) sp.set("page", String(state.page));
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

export function storeFilterCount(state: StoreFilterState): number {
  return [
    state.category,
    state.priceMin,
    state.priceMax,
    state.onOffer || null,
    state.inStock || null,
    state.rating || null,
  ].filter(Boolean).length;
}

/** True sale: a compare price above the selling price, or a live event cut. */
export function isOnOffer(card: ProductCard): boolean {
  if (card.event_percent > 0) return true;
  if (!card.has_sale) return false;
  // min_price_piastres is the selling price in this view (the sale price when
  // one is live); min_sale_price_piastres can be null on event-only rows, so
  // comparing against it would read null as 0 and call every row an offer.
  return discountPercent(card) > 0;
}

/** Percentage off, rounded down — matches what the price tag shows. */
export function discountPercent(card: ProductCard): number {
  const regular = card.min_regular_piastres ?? card.min_price_piastres ?? 0;
  const now = effectivePrice(card);
  if (regular <= 0 || now >= regular) return 0;
  return Math.floor(((regular - now) / regular) * 100);
}

export function applyStoreFilters(
  products: ProductCard[],
  state: StoreFilterState,
): { rows: ProductCard[]; total: number } {
  let rows = products.filter((p) => p.is_listable || p.is_event_hidden || p.vendor_event_refused);

  if (state.category) rows = rows.filter((p) => p.leaf_category_id === state.category);
  if (state.priceMin != null) rows = rows.filter((p) => effectivePrice(p) >= state.priceMin!);
  if (state.priceMax != null) rows = rows.filter((p) => effectivePrice(p) <= state.priceMax!);
  if (state.onOffer) rows = rows.filter(isOnOffer);
  if (state.inStock) rows = rows.filter((p) => p.stock_total > 0);
  if (state.rating) rows = rows.filter((p) => (p.rating_avg ?? 0) >= state.rating);

  switch (state.sort) {
    case "price_asc":
      rows = [...rows].sort((a, b) => effectivePrice(a) - effectivePrice(b));
      break;
    case "price_desc":
      rows = [...rows].sort((a, b) => effectivePrice(b) - effectivePrice(a));
      break;
    case "rating":
      rows = [...rows].sort(
        (a, b) => (b.rating_avg ?? 0) - (a.rating_avg ?? 0) || b.rating_count - a.rating_count,
      );
      break;
    case "discount":
      rows = [...rows].sort((a, b) => discountPercent(b) - discountPercent(a));
      break;
    default:
      rows = [...rows].sort(
        (a, b) => new Date(b.published_at ?? b.created_at).getTime() - new Date(a.published_at ?? a.created_at).getTime(),
      );
  }

  const total = rows.length;
  const start = (state.page - 1) * STORE_PAGE_SIZE;
  return { rows: rows.slice(start, start + STORE_PAGE_SIZE), total };
}

/** The leaf categories this store actually sells in, with counts. */
export function storeCategories(products: ProductCard[]): Array<{
  id: string;
  name_ar: string | null;
  name_en: string | null;
  count: number;
}> {
  const map = new Map<string, { id: string; name_ar: string | null; name_en: string | null; count: number }>();
  for (const p of products) {
    if (!p.leaf_category_id) continue;
    const hit = map.get(p.leaf_category_id);
    if (hit) hit.count += 1;
    else
      map.set(p.leaf_category_id, {
        id: p.leaf_category_id,
        name_ar: p.category_name_ar,
        name_en: p.category_name_en,
        count: 1,
      });
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

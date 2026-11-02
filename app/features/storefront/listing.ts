import type { FilterState, FacetDef } from "~/components/catalog/FacetPanel";

/**
 * Listing URL state (S-03 DoD: URL reflects filters, back restores exact
 * state). Params: q · cat · brand · <attribute-code>=opt1,opt2 · pmin/pmax
 * (EGP) · rating · stock=1 · sort · page. Attribute params are keyed by the
 * human-readable code and resolved through the facet defs.
 */

export const SORT_OPTIONS = ["newest", "price_asc", "price_desc", "rating"] as const;

export function parseListingState(
  url: URL,
  defs: FacetDef[],
  opts: { fixedCategory?: string | null } = {},
): FilterState {
  const sp = url.searchParams;
  const byCode = new Map(defs.map((d) => [d.code, d]));
  const attrs: FilterState["attrs"] = [];
  for (const [code, raw] of sp.entries()) {
    const def = byCode.get(code);
    if (!def) continue;
    const optionIds = raw.split(",").filter((id) => /^[0-9a-f-]{36}$/i.test(id));
    if (optionIds.length > 0) attrs.push({ attribute_id: def.attribute_id, option_ids: optionIds.slice(0, 20) });
  }
  const toPiastres = (raw: string | null): number | null => {
    if (!raw) return null;
    const n = Math.round(Number(raw) * 100);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 10_000_000) : null;
  };
  return {
    q: (sp.get("q") ?? "").slice(0, 80),
    category: opts.fixedCategory ?? sp.get("cat")?.match(/^[0-9a-f-]{36}$/i)?.[0] ?? null,
    brand: sp.get("brand")?.match(/^[0-9a-f-]{36}$/i)?.[0] ?? null,
    attrs,
    priceMin: toPiastres(sp.get("pmin")),
    priceMax: toPiastres(sp.get("pmax")),
    rating: [2, 3, 4].includes(Number(sp.get("rating"))) ? Number(sp.get("rating")) : null,
    inStock: sp.get("stock") === "1",
    sort: SORT_OPTIONS.includes(sp.get("sort") as never) ? sp.get("sort")! : "newest",
    page: Math.max(1, Math.min(500, Number(sp.get("page")) || 1)),
  };
}

export function buildListingQuery(state: FilterState, defs: FacetDef[]): string {
  const sp = new URLSearchParams();
  const byId = new Map(defs.map((d) => [d.attribute_id, d]));
  if (state.q) sp.set("q", state.q);
  if (state.category) sp.set("cat", state.category);
  if (state.brand) sp.set("brand", state.brand);
  for (const group of state.attrs) {
    const def = byId.get(group.attribute_id);
    if (def && group.option_ids.length > 0) sp.set(def.code, group.option_ids.join(","));
  }
  if (state.priceMin != null) sp.set("pmin", String(state.priceMin / 100));
  if (state.priceMax != null) sp.set("pmax", String(state.priceMax / 100));
  if (state.rating != null) sp.set("rating", String(state.rating));
  if (state.inStock) sp.set("stock", "1");
  if (state.sort && state.sort !== "newest") sp.set("sort", state.sort);
  if (state.page > 1) sp.set("page", String(state.page));
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

export function isFiltered(state: FilterState): boolean {
  return Boolean(
    state.q || state.brand || state.attrs.length > 0 || state.priceMin != null ||
    state.priceMax != null || state.rating != null || state.inStock || state.category,
  );
}

/** Count how many independent filter dimensions are active (for the
 * "remove the last filter" shortcut on zero results — US-03 edge). */
export function filterCount(state: FilterState): number {
  let n = 0;
  if (state.q) n += 1;
  if (state.brand) n += 1;
  if (state.attrs.length > 0) n += state.attrs.length;
  if (state.priceMin != null) n += 1;
  if (state.priceMax != null) n += 1;
  if (state.rating != null) n += 1;
  if (state.inStock) n += 1;
  if (state.category) n += 1;
  return n;
}

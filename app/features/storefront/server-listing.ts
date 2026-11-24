import type { SupabaseClient } from "@supabase/supabase-js";
import { parseListingState } from "./listing";
import {
  getBrandBySlug, getCategoryById, getCategoryBySlug, getCategoryChain, searchProducts,
  type BrandCard, type CategoryNode, type SearchResult,
} from "./api";
import type { FacetDef } from "~/components/catalog/FacetPanel";
import { getViewer } from "~/lib/auth/guards";

/**
 * Shared loader for the four listing surfaces (products / category /
 * search / brand): resolve scope → facet defs → one search RPC → wished
 * ids for the heart prefill.
 */

export interface ListingScope {
  category: CategoryNode | null;
  /** ancestors of the resolved category (breadcrumbs) */
  chain: CategoryNode[];
  brand: BrandCard | null;
  defs: FacetDef[];
}

export async function resolveScope(
  client: SupabaseClient,
  opts: { categorySlug?: string; categoryId?: string; brandSlug?: string } = {},
): Promise<ListingScope> {
  let chain: CategoryNode[] = [];
  // category (by slug, or by the `?cat=` id that /products, /search and
  // /brand narrow with) and brand are independent: one parallel round instead
  // of up to three sequential lookups
  const [category, brand] = await Promise.all([
    opts.categorySlug
      ? getCategoryBySlug(client, opts.categorySlug)
      : opts.categoryId ? getCategoryById(client, opts.categoryId) : Promise.resolve(null),
    opts.brandSlug ? getBrandBySlug(client, opts.brandSlug) : Promise.resolve(null),
  ]);

  // Breadcrumbs come from the node's own path and facets from one RPC over
  // the subtree: loading the whole tree (~1,600 nodes with the level-4
  // product types) per request was both slow and past PostgREST's row cap.
  let facetDefs: FacetDef[] = [];
  if (category) {
    const [ancestors, defs] = await Promise.all([
      getCategoryChain(client, category),
      client.rpc("fn_storefront_facet_defs", { p_category: category.id }),
    ]);
    chain = ancestors;
    if (!defs.error && defs.data) {
      facetDefs = (defs.data as Array<FacetDef & { sort: number }>).sort((a, b) => a.sort - b.sort);
    }
  }
  return { category, chain, brand, defs: facetDefs };
}

export interface ListingData {
  state: ReturnType<typeof parseListingState>;
  result: SearchResult;
  wishedIds: Set<string>;
  scope: ListingScope;
}

export async function loadListing(
  request: Request,
  client: SupabaseClient,
  opts: { fixedCategorySlug?: string; fixedBrandSlug?: string; forceQ?: string; perPage?: number } = {},
): Promise<ListingData> {
  const url = new URL(request.url);
  const urlCat = (url.searchParams.get("cat") ?? "").match(/^[0-9a-f-]{36}$/i)?.[0];
  // the session check runs alongside the scope lookups (it used to start
  // only after them), and the viewer's hearts load alongside the search
  const viewerP = getViewer(client);
  const wishedP: Promise<{ data: Array<{ product_id: string }> | null }> = viewerP.then(async (r) => r?.viewer
    ? await client.from("wishlist_items").select("product_id").eq("user_id", r.viewer.user.id).limit(500)
    : { data: null });
  const scope = await resolveScope(client, {
    categorySlug: opts.fixedCategorySlug,
    categoryId: opts.fixedCategorySlug ? undefined : urlCat,
    brandSlug: opts.fixedBrandSlug,
  });
  const state = parseListingState(url, scope.defs, {
    fixedCategory: scope.category?.id ?? null,
  });
  // a plain visit shows a fresh random order; in-page navigation carries the
  // seed so page 2 / a filter change keep the same shuffle
  if (state.sort === "recommended" && !state.seed) {
    state.seed = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  }
  const [result, wished] = await Promise.all([
    searchProducts(client, {
      q: opts.forceQ ?? state.q,
      category: scope.category?.id ?? state.category,
      brand: scope.brand?.id ?? state.brand,
      attrs: state.attrs,
      priceMin: state.priceMin,
      priceMax: state.priceMax,
      rating: state.rating,
      inStock: state.inStock,
      sort: state.sort,
      seed: state.seed,
      page: state.page,
      perPage: opts.perPage ?? 24,
    }),
    wishedP,
  ]);
  const wishedIds = new Set(
    ((wished.data ?? []) as Array<{ product_id: string }>).map((r) => r.product_id),
  );
  return { state, result, wishedIds, scope };
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { parseListingState } from "./listing";
import {
  getBrandBySlug, getCategoryBySlug, getCategories, searchProducts,
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
  opts: { categorySlug?: string; brandSlug?: string } = {},
): Promise<ListingScope> {
  let category: CategoryNode | null = null;
  let chain: CategoryNode[] = [];
  let brand: BrandCard | null = null;
  let all: CategoryNode[] = [];

  if (opts.categorySlug) {
    category = await getCategoryBySlug(client, opts.categorySlug);
    if (category) {
      all = await getCategories(client);
      const byId = new Map(all.map((c) => [c.id, c]));
      const parts = category.path.split("/").filter(Boolean);
      chain = parts
        .slice(0, -1)
        .map((id) => byId.get(id))
        .filter((c): c is CategoryNode => Boolean(c));
    }
  }
  if (opts.brandSlug) {
    brand = await getBrandBySlug(client, opts.brandSlug);
  }

  const defs = (await client.from("v_storefront_facet_defs").select("*")) as {
    data: Array<FacetDef & { leaf_category_id: string }> | null;
    error: { message: string } | null;
  };
  let facetDefs: FacetDef[] = [];
  if (!defs.error && defs.data) {
    if (category) {
      // the scope covers the whole subtree: category itself + every descendant
      const subtree = new Set([category.id]);
      for (const node of all) {
        if (node.path.startsWith(`${category.path}/`)) subtree.add(node.id);
      }
      facetDefs = defs.data.filter((d) => subtree.has(d.leaf_category_id));
    } else {
      facetDefs = [];
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
  const scope = await resolveScope(client, {
    categorySlug: opts.fixedCategorySlug,
    brandSlug: opts.fixedBrandSlug,
  });
  const state = parseListingState(url, scope.defs, {
    fixedCategory: scope.category?.id ?? null,
  });
  const { viewer } = (await getViewer(client)) ?? { viewer: null };
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
      page: state.page,
      perPage: opts.perPage ?? 24,
    }),
    viewer
      ? client.from("wishlist_items").select("product_id").eq("user_id", viewer.user.id)
      : Promise.resolve({ data: null, error: null }),
  ]);
  const wishedIds = new Set(
    ((wished.data ?? []) as Array<{ product_id: string }>).map((r) => r.product_id),
  );
  return { state, result, wishedIds, scope };
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { safeLikeTerm, safeSlug } from "~/lib/postgrest";
import { foldSearch, foldTokens } from "~/lib/search-fold";
import { fetchAll } from "~/lib/supabase/fetch-all";
import { parseChart, type SizeChart } from "~/features/products/size-chart";
import { scoped } from "~/lib/supabase/request-scope";
import { isSharedClient } from "~/lib/supabase/request-scope";
import type { ReviewMediaItem } from "~/lib/review-media";

/* Explicit column lists (no SELECT *): exactly the fields of the matching TS
 * interfaces, so a column added to a view never silently grows every payload. */
export const PRODUCT_CARD_COLUMNS = "id, slug_ar, slug_en, name_ar, name_en, short_ar, short_en, leaf_category_id, category_name_ar, category_name_en, category_slug_ar, category_slug_en, brand_id, brand_name_ar, brand_name_en, vendor_id, vendor_slug, store_name_ar, store_name_en, vendor_logo_path, level_name_ar, level_name_en, level_icon, main_image_path, min_price_piastres, min_sale_price_piastres, has_sale, event_percent, event_max_piastres, stock_total, rating_avg, rating_count, is_featured, is_event_hidden, vendor_event_refused, is_listable, published_at, created_at, colors, min_regular_piastres, max_discount_percent, sold_count, single_variant_id";
export const CATEGORY_COLUMNS = "id, parent_id, depth, path, slug_ar, slug_en, name_ar, name_en, description_ar, description_en, thumb_path, sort, icon";
export const STORE_COLUMNS = "id, slug, store_name_ar, store_name_en, short_desc_ar, short_desc_en, logo_path, banner_path, status, is_featured, is_listable, category_ids, level_name_ar, level_name_en, level_icon, level_color, rating_avg, rating_count, product_count, refused_event_id, refused_event_name_ar, refused_event_name_en";
export const BRAND_COLUMNS = "id, slug_ar, slug_en, name_ar, name_en, thumb_path, sort, product_count, description_ar, description_en, country_ar, country_en, founded_year, category_ids, root_category_ids";
export const EVENT_COLUMNS = "id, name_ar, name_en, desc_ar, desc_en, starts_at, ends_at";

/**
 * Storefront read layer — every function reads ONLY through the definer
 * storefront views / public-read tables / RPCs, so nothing draft, pending,
 * hidden or suspended can ever reach the client (G2).
 */

export interface ProductCard {
  id: string;
  slug_ar: string;
  slug_en: string;
  name_ar: string;
  name_en: string;
  short_ar: string;
  short_en: string;
  leaf_category_id: string;
  category_name_ar: string | null;
  category_name_en: string | null;
  category_slug_ar: string | null;
  category_slug_en: string | null;
  brand_id: string | null;
  brand_name_ar: string | null;
  brand_name_en: string | null;
  vendor_id: string;
  vendor_slug: string;
  store_name_ar: string;
  store_name_en: string;
  vendor_logo_path: string | null;
  level_name_ar: string | null;
  level_name_en: string | null;
  level_icon: string | null;
  main_image_path: string | null;
  min_price_piastres: number | null;
  min_sale_price_piastres: number | null;
  /** regular ("before discount") price of the cheapest live offer */
  min_regular_piastres: number | null;
  /** best running discount across the live offers (whole percent) */
  max_discount_percent?: number;
  /** units sold (non-cancelled orders) */
  sold_count?: number;
  has_sale: boolean;
  event_percent: number;
  event_max_piastres: number | null;
  stock_total: number;
  rating_avg: number | null;
  rating_count: number;
  is_featured: boolean;
  is_event_hidden: boolean;
  /** the only live variant when the product has no options (no colour/size) — the card adds it to the cart directly */
  single_variant_id?: string | null;
  vendor_event_refused: boolean;
  is_listable: boolean;
  published_at: string | null;
  created_at: string;
  event_price_piastres?: number;
  /** live child colours, once each, with that colour's first image */
  colors?: Array<{ id: string; hex: string | null; label_ar: string; label_en: string; image: string | null }>;
}

/**
 * Before/after pair a card shows: the price to pay now (sale + event) and the
 * regular price it is cut from, with the whole-percent saving. `before` is null
 * when nothing is discounted.
 */
export function cardPricing(card: Pick<ProductCard, "min_price_piastres" | "min_regular_piastres" | "event_percent" | "event_max_piastres" | "event_price_piastres">): { now: number; before: number | null; percent: number } {
  const now = card.event_price_piastres ?? effectivePrice(card);
  const regular = card.min_regular_piastres ?? card.min_price_piastres ?? now;
  if (regular <= now || now <= 0) return { now, before: null, percent: 0 };
  return { now, before: regular, percent: Math.max(1, Math.round(((regular - now) / regular) * 100)) };
}

/** The single price a card displays: variant sale (in window) else regular,
 * minus the active event discount, capped — identical arithmetic to the SQL
 * (integer division truncates toward zero; positives → floor). */
export function effectivePrice(card: Pick<ProductCard, "min_price_piastres" | "event_percent" | "event_max_piastres">): number {
  const base = card.min_price_piastres ?? 0;
  if (!card.event_percent || card.event_percent <= 0) return base;
  const discounted = base - Math.trunc((base * card.event_percent) / 100);
  if (card.event_max_piastres != null && discounted > card.event_max_piastres) {
    return card.event_max_piastres;
  }
  return discounted;
}

export interface CategoryNode {
  id: string;
  parent_id: string | null;
  depth: number;
  path: string;
  slug_ar: string;
  slug_en: string;
  name_ar: string;
  name_en: string;
  description_ar: string;
  description_en: string;
  thumb_path: string | null;
  sort: number;
  /** icon-library key (hero panel / mega menu) */
  icon: string | null;
}

export interface StoreCard {
  id: string;
  slug: string;
  store_name_ar: string;
  store_name_en: string;
  short_desc_ar: string;
  short_desc_en: string;
  logo_path: string | null;
  banner_path: string | null;
  status: "active" | "suspended";
  is_featured: boolean;
  is_listable: boolean;
  category_ids: string[];
  level_name_ar: string | null;
  level_name_en: string | null;
  level_icon: string | null;
  level_color: string | null;
  rating_avg: number | null;
  rating_count: number;
  product_count: number;
  refused_event_id: string | null;
  refused_event_name_ar: string | null;
  refused_event_name_en: string | null;
}

export interface BrandCard {
  id: string;
  slug_ar: string;
  slug_en: string;
  name_ar: string;
  name_en: string;
  thumb_path: string | null;
  sort: number;
  product_count: number;
  description_ar: string;
  description_en: string;
  country_ar: string;
  country_en: string;
  founded_year: number | null;
  /** linked categories (main/sub level) and their main categories */
  category_ids: string[];
  root_category_ids: string[];
}

export interface BannerRow {
  id: string;
  title_ar: string;
  title_en: string;
  image_path: string;
  link_url: string;
  position: number;
  /** "hero" = the top carousel; otherwise the home section it follows */
  placement: string;
}

export interface ActiveEvent {
  id: string;
  name_ar: string;
  name_en: string;
  desc_ar: string;
  desc_en: string;
  starts_at: string;
  ends_at: string;
}

export interface SearchFacets {
  brands: Array<{ id: string | null; name_ar: string | null; name_en: string | null; thumb_path?: string | null; count: number }>;
  categories: Array<{ id: string; name_ar: string; name_en: string; slug_ar: string; slug_en: string; count: number }>;
  attributes: Array<{
    attribute_id: string;
    code: string;
    label_ar: string;
    label_en: string;
    type: string;
    unit: string;
    option_id: string;
    option_label_ar: string;
    option_label_en: string;
    color_hex: string | null;
    count: number;
  }>;
}

export interface SearchResult {
  total: number;
  page: number;
  per_page: number;
  items: ProductCard[];
  facets: SearchFacets;
}

export interface SearchParams {
  q?: string;
  category?: string | null;
  brand?: string | null;
  attrs?: Array<{ attribute_id: string; option_ids: string[] }>;
  priceMin?: number | null;
  priceMax?: number | null;
  rating?: number | null;
  inStock?: boolean;
  sort?: string;
  page?: number;
  perPage?: number;
  /** random-order seed for the recommended sort */
  seed?: string;
}

async function rpcJson<T>(client: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T | null> {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(error.message);
  return (data ?? null) as T | null;
}

/** The listing/search engine (S-03/S-04): items + facets + counts in one RPC. */
export async function searchProducts(client: SupabaseClient, params: SearchParams): Promise<SearchResult> {
  const raw = await rpcJson<SearchResult>(client, "fn_search_products", {
    p_q: params.q ?? null,
    p_category: params.category ?? null,
    p_brand: params.brand ?? null,
    p_attrs: params.attrs && params.attrs.length > 0 ? params.attrs : null,
    p_price_min: params.priceMin ?? null,
    p_price_max: params.priceMax ?? null,
    p_rating: params.rating ?? null,
    p_in_stock: params.inStock ?? null,
    p_sort: params.sort ?? "recommended",
    p_page: params.page ?? 1,
    p_per_page: params.perPage ?? 24,
    p_seed: params.seed ?? null,
  });
  return raw ?? { total: 0, page: 1, per_page: params.perPage ?? 24, items: [], facets: { brands: [], categories: [], attributes: [] } };
}

export interface BrandSuggestion {
  slug_ar: string;
  slug_en: string;
  name_ar: string;
  name_en: string;
  thumb_path: string | null;
}

export async function searchSuggestions(
  client: SupabaseClient,
  q: string,
): Promise<{ products: Array<{ id: string; slug_ar: string; slug_en: string; name_ar: string; name_en: string; main_image_path: string | null; price_piastres: number | null }>; stores: Array<{ slug: string; name_ar: string; name_en: string; logo_path: string | null }>; categories: Array<{ slug_ar: string; slug_en: string; name_ar: string; name_en: string; depth: number }>; brands: BrandSuggestion[] }> {
  const raw = await rpcJson<{ products: unknown[]; stores: unknown[]; categories: unknown[]; brands: unknown[] }>(
    client, "fn_search_suggestions", { p_q: q, p_limit: 4 },
  );
  const empty = { products: [], stores: [], categories: [], brands: [] };
  if (!raw) return empty;
  return {
    products: (raw.products ?? []) as never,
    stores: (raw.stores ?? []) as never,
    categories: (raw.categories ?? []) as never,
    brands: (raw.brands ?? []) as never,
  };
}

export async function didYouMean(client: SupabaseClient, q: string): Promise<string | null> {
  const { data, error } = await client.rpc("fn_search_did_you_mean", { p_q: q });
  if (error) return null;
  return typeof data === "string" && data.length > 0 ? data : null;
}

/**
 * Active categories, ordered by depth then sort. `maxDepth: 3` returns the
 * browse tree only (menus, home tiles) — level 4 holds the ~1,400 product
 * types, which would otherwise ride along in every page's loader data.
 * Paged: the full tree exceeds PostgREST's 1000-row cap.
 */
export async function getCategories(
  client: SupabaseClient,
  opts: { maxDepth?: number } = {},
): Promise<CategoryNode[]> {
  // the public layout (menus) and pages like home ask for the same tree in
  // the same request: fetched once, shared (request-scoped, not a cache)
  return scoped(client, `categories:${opts.maxDepth ?? "all"}`, () => fetchAll<CategoryNode>((from, to) => {
    let query = client.from("v_storefront_categories").select(CATEGORY_COLUMNS);
    if (opts.maxDepth) query = query.lte("depth", opts.maxDepth);
    return query.order("depth").order("sort").order("id").range(from, to);
  }), isSharedClient(client));
}

/** One active category by id (listing `?cat=`), or null. */
export async function getCategoryById(client: SupabaseClient, id: string): Promise<CategoryNode | null> {
  const { data, error } = await client.from("v_storefront_categories").select(CATEGORY_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as CategoryNode | null) ?? null;
}

/** Ancestors of a category in root → parent order (breadcrumbs). */
export async function getCategoryChain(client: SupabaseClient, category: CategoryNode): Promise<CategoryNode[]> {
  const ids = category.path.split("/").filter(Boolean).slice(0, -1);
  if (ids.length === 0) return [];
  const { data, error } = await client.from("v_storefront_categories").select(CATEGORY_COLUMNS).in("id", ids);
  if (error) throw new Error(error.message);
  const byId = new Map(((data ?? []) as CategoryNode[]).map((c) => [c.id, c]));
  return ids.map((id) => byId.get(id)).filter((c): c is CategoryNode => Boolean(c));
}

export async function getCategoryBySlug(client: SupabaseClient, rawSlug: string): Promise<CategoryNode | null> {
  const slug = safeSlug(rawSlug);
  if (!slug) return null;
  return scoped(client, `category-slug:${slug}`, async () => {
    const { data, error } = await client.from("v_storefront_categories").select(CATEGORY_COLUMNS).or(`slug_ar.eq.${slug},slug_en.eq.${slug}`).limit(1);
    if (error) throw new Error(error.message);
    return (data?.[0] as CategoryNode | undefined) ?? null;
  }, isSharedClient(client));
}

export async function getFeaturedProducts(client: SupabaseClient, limit = 8): Promise<ProductCard[]> {
  const { data, error } = await client
    .from("v_storefront_products")
    .select(PRODUCT_CARD_COLUMNS)
    .eq("is_listable", true)
    .eq("is_featured", true)
    .not("min_price_piastres", "is", null)
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as ProductCard[];
}

/**
 * "Our best products": featured + ad-promoted products (is_featured covers
 * both). Fewer than 5 → topped up to 10 with the newest regular products,
 * which keep is_featured = false and so are never labelled featured.
 */
export async function getBestProducts(client: SupabaseClient, max = 20): Promise<ProductCard[]> {
  const featured = await getFeaturedProducts(client, max);
  if (featured.length >= 5) return featured;
  const { data, error } = await client
    .from("v_storefront_products")
    .select(PRODUCT_CARD_COLUMNS)
    .eq("is_listable", true)
    .eq("is_featured", false)
    .not("min_price_piastres", "is", null)
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(10 - featured.length);
  if (error) throw new Error(error.message);
  return [...featured, ...((data ?? []) as ProductCard[])];
}

/** Newest listable products, featured or not (home "Recently added"). */
export async function getRecentProducts(client: SupabaseClient, limit = 20): Promise<ProductCard[]> {
  const { data, error } = await client
    .from("v_storefront_products")
    .select(PRODUCT_CARD_COLUMNS)
    .eq("is_listable", true)
    .not("min_price_piastres", "is", null)
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as ProductCard[];
}

/** Products on sale, biggest discount first (home "Deals & discounts"). */
export async function getDiscountedProducts(client: SupabaseClient, limit = 20): Promise<ProductCard[]> {
  const { data, error } = await client
    .from("v_storefront_products")
    .select(PRODUCT_CARD_COLUMNS)
    .eq("is_listable", true)
    .eq("has_sale", true)
    .not("min_price_piastres", "is", null)
    .order("max_discount_percent", { ascending: false, nullsFirst: false })
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as ProductCard[];
}

export async function getTopRatedProducts(client: SupabaseClient, limit = 8): Promise<ProductCard[]> {
  const { data, error } = await client
    .from("v_storefront_products")
    .select(PRODUCT_CARD_COLUMNS)
    .eq("is_listable", true)
    .gt("rating_count", 0)
    .not("min_price_piastres", "is", null)
    .order("rating_avg", { ascending: false, nullsFirst: false })
    .order("rating_count", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as ProductCard[];
}

/** Most units sold (non-cancelled orders); empty until something sells. */
export async function getBestSellingProducts(client: SupabaseClient, limit = 16): Promise<ProductCard[]> {
  const { data, error } = await client
    .from("v_storefront_products")
    .select(PRODUCT_CARD_COLUMNS)
    .eq("is_listable", true)
    .gt("sold_count", 0)
    .not("min_price_piastres", "is", null)
    .order("sold_count", { ascending: false })
    .order("rating_avg", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as ProductCard[];
}

export async function getBanners(client: SupabaseClient): Promise<BannerRow[]> {
  // L-04 — only live banners: active flag + publish window (null bounds = open)
  const now = new Date().toISOString();
  const { data, error } = await client
    .from("banners")
    .select("id, title_ar, title_en, image_path, link_url, position, placement")
    .eq("is_active", true)
    .or(`starts_at.is.null,starts_at.lte.${now}`)
    .or(`ends_at.is.null,ends_at.gte.${now}`)
    .order("position");
  if (error) return []; // banners are optional decoration — an empty list hides the block
  return (data ?? []) as BannerRow[];
}

export async function getActiveEvent(client: SupabaseClient): Promise<ActiveEvent | null> {
  const { data, error } = await client.from("v_storefront_active_event").select(EVENT_COLUMNS).limit(1);
  if (error) return null;
  return (data?.[0] as ActiveEvent | undefined) ?? null;
}

export async function getFeaturedStores(client: SupabaseClient, limit = 8): Promise<StoreCard[]> {
  const { data, error } = await client
    .from("v_storefront_stores")
    .select(STORE_COLUMNS)
    .eq("status", "active")
    .eq("is_featured", true)
    .eq("in_store_lists", true)
    .order("product_count", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as StoreCard[];
}

export async function listStores(client: SupabaseClient, opts: { featuredOnly?: boolean } = {}): Promise<StoreCard[]> {
  let query = client.from("v_storefront_stores").select(STORE_COLUMNS).eq("status", "active").eq("in_store_lists", true);
  if (opts.featuredOnly) query = query.eq("is_featured", true);
  const { data, error } = await query.order("is_featured", { ascending: false }).order("product_count", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as StoreCard[];
}

export async function getStoreBySlug(client: SupabaseClient, slug: string): Promise<StoreCard | null> {
  const { data, error } = await client.from("v_storefront_stores").select(STORE_COLUMNS).eq("slug", slug).limit(1);
  if (error) throw new Error(error.message);
  const store = (data?.[0] as StoreCard | undefined) ?? null;
  // A store hidden from listings must not be reachable by direct URL either.
  if (!store || store.is_listable === false) return null;
  return store;
}

/** A random brand strip (home page): a wide pool of brands with a thumbnail,
 * reshuffled per request on the server so the client hydrates the same order. */
export async function listBrands(client: SupabaseClient, limit = 16): Promise<BrandCard[]> {
  const { data, error } = await client
    .from("v_storefront_brands")
    .select(BRAND_COLUMNS)
    .not("thumb_path", "is", null)
    .order("product_count", { ascending: false })
    .order("sort")
    .limit(Math.max(limit, 80));
  if (error) throw new Error(error.message);
  const pool = (data ?? []) as BrandCard[];
  // Fisher–Yates: every visit shows a different 16, no client-side shuffle
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const swap = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = swap;
  }
  return pool.slice(0, limit);
}

export const BRANDS_PER_PAGE = 48;

/** /brands directory: folded search (both names), first-letter filter,
 * main-category filter, paging. */
export async function listBrandsPage(
  client: SupabaseClient,
  opts: { q?: string; rootCategoryId?: string | null; letter?: string; page?: number },
): Promise<{ items: BrandCard[]; total: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const from = (page - 1) * BRANDS_PER_PAGE;
  let query = client.from("v_storefront_brands").select(BRAND_COLUMNS, { count: "exact" })
    .order("product_count", { ascending: false }).order("name_en").order("id").range(from, from + BRANDS_PER_PAGE - 1);
  // tokens arrive folded; a visitor's % and _ stay literal through safeLikeTerm
  const tokens = foldTokens(opts.q ?? "")
    .flatMap((token) => safeLikeTerm(token, 60).split(" "))
    .filter(Boolean)
    .slice(0, 6);
  for (const token of tokens) query = query.like("search_norm", `%${token}%`);
  const letter = (opts.letter ?? "").trim();
  if (letter === "#") query = query.eq("letter_en", "#");
  else if (/^[A-Za-z]$/.test(letter)) query = query.eq("letter_en", letter.toUpperCase());
  else if (/^[\u0621-\u064A]$/.test(letter)) {
    const ar = foldSearch(letter);
    if (/^[\u0621-\u064A]$/.test(ar)) query = query.eq("letter_ar", ar);
  }
  if (opts.rootCategoryId && /^[0-9a-f-]{36}$/i.test(opts.rootCategoryId)) query = query.contains("root_category_ids", [opts.rootCategoryId]);
  const { data, error, count } = await query;
  if (error) throw new Error(error.message);
  return { items: (data ?? []) as BrandCard[], total: count ?? 0 };
}

/** Name + slug of the categories a brand is linked to (brand page chips). */
export async function getCategoriesByIds(client: SupabaseClient, ids: string[]) {
  if (ids.length === 0) return [] as Array<{ id: string; name_ar: string; name_en: string; slug_ar: string; slug_en: string; depth: number }>;
  const { data } = await client.from("categories").select("id, name_ar, name_en, slug_ar, slug_en, depth")
    .in("id", ids.slice(0, 20)).eq("is_active", true).is("deleted_at", null).order("depth").order("sort");
  return (data ?? []) as Array<{ id: string; name_ar: string; name_en: string; slug_ar: string; slug_en: string; depth: number }>;
}

export async function getBrandBySlug(client: SupabaseClient, slug: string): Promise<BrandCard | null> {
  const slugSafe = safeSlug(slug);
  if (!slugSafe) return null;
  const { data, error } = await client.from("v_storefront_brands").select(BRAND_COLUMNS).or(`slug_ar.eq.${slugSafe},slug_en.eq.${slugSafe}`).limit(1);
  if (error) throw new Error(error.message);
  return (data?.[0] as BrandCard | undefined) ?? null;
}

export interface StaticPage {
  id: string;
  slug_ar: string;
  slug_en: string;
  title_ar: string;
  title_en: string;
  content_ar: string;
  content_en: string;
  show_in_header: boolean;
}

export async function getStaticPage(client: SupabaseClient, rawSlug: string): Promise<StaticPage | null> {
  const slug = safeSlug(rawSlug);
  if (!slug) return null;
  const { data, error } = await client
    .from("static_pages")
    .select("id, slug_ar, slug_en, title_ar, title_en, content_ar, content_en, show_in_header")
    .or(`slug_ar.eq.${slug},slug_en.eq.${slug}`)
    .limit(1);
  if (error) throw new Error(error.message);
  return (data?.[0] as StaticPage | undefined) ?? null;
}

export async function listHeaderPages(client: SupabaseClient): Promise<Array<{ slug_ar: string; slug_en: string; title_ar: string; title_en: string }>> {
  const { data, error } = await client
    .from("static_pages")
    .select("slug_ar, slug_en, title_ar, title_en")
    .eq("show_in_header", true)
    .order("created_at");
  if (error) return [];
  return data ?? [];
}

/* ------------------------------------------------------------------ product page */

export interface VariantRow {
  id: string;
  sku: string | null;
  option_key: string;
  option_ids: string[];
  price_piastres: number | null;
  sale_price_piastres: number | null;
  stock: number;
  image_path: string | null;
  is_active: boolean;
  /** child product (variant_groups) this size row belongs to */
  group_id: string | null;
  /** the child's discount window (start is never shown to customers) */
  sale_starts_at: string | null;
  sale_ends_at: string | null;
}

/** One child product's colour + images, for the gallery swap on colour pick. */
export interface ProductGroup {
  id: string;
  color_option_id: string | null;
  images: string[];
}

export interface AttributeView {
  attribute_id: string;
  code: string;
  type: string;
  unit: string;
  label_ar: string;
  label_en: string;
  option_label_ar: string | null;
  option_label_en: string | null;
  color_hex: string | null;
  /** every chosen option (multi-choice specs list several) */
  options: Array<{ label_ar: string | null; label_en: string | null; color_hex: string | null }>;
  value_text: string | null;
  value_text_en?: string | null;
  value_number: number | null;
  value_bool: boolean | null;
  is_axis: boolean;
}

export interface ReviewRow {
  id: string;
  rating: number;
  title: string;
  body: string;
  created_at: string;
  author_name: string;
  media?: ReviewMediaItem[] | null;
}

export interface ProductPage {
  card: ProductCard;
  desc_ar: string;
  desc_en: string;
  specs: Record<string, unknown>;
  is_fragile: boolean;
  shipping_mode: string;
  weight_g: number | null;
  sale_starts_at: string | null;
  sale_ends_at: string | null;
  /** apparel size chart (products.size_chart), parsed */
  size_chart: SizeChart | null;
  brand_id: string | null;
  brand_name_ar: string | null;
  brand_name_en: string | null;
  brand_slug_ar: string | null;
  brand_slug_en: string | null;
  /** brand logo (media path) for the brand link on the product page */
  brand_thumb_path: string | null;
  media: Array<{ id: string; kind: string; path: string }>;
  variants: VariantRow[];
  groups: ProductGroup[];
  /** the live event when this product carries its discount */
  event: ActiveEvent | null;
  axes: Array<{ attribute_id: string; code: string; label_ar: string; label_en: string; type: string; options: Array<{ id: string; label_ar: string; label_en: string; color_hex: string | null }> }>;
  attributes: AttributeView[];
  reviews: ReviewRow[];
}

export async function getProductPage(client: SupabaseClient, rawSlug: string): Promise<ProductPage | null> {
  const slug = safeSlug(rawSlug);
  if (!slug) return null;
  // ── round 1: the card (view) and the base product row, in parallel — both
  // by slug (the row used to wait for the card's id: one extra round-trip).
  // Safe: the public RLS policy only exposes approved+public product rows.
  const PRODUCT_FIELDS = "id, desc_ar, desc_en, specs, is_fragile, shipping_mode, weight_g, sale_starts_at, sale_ends_at, brand_id, deleted_at, status, size_chart";
  const [cardRes, prowRes] = await Promise.all([
    client.from("v_storefront_products").select(PRODUCT_CARD_COLUMNS).or(`slug_ar.eq.${slug},slug_en.eq.${slug}`).limit(1),
    client.from("products").select(PRODUCT_FIELDS).or(`slug_ar.eq.${slug},slug_en.eq.${slug}`).is("deleted_at", null).limit(2),
  ]);
  if (cardRes.error) throw new Error(cardRes.error.message);
  if (prowRes.error) throw new Error(prowRes.error.message);
  const base = cardRes.data?.[0] as unknown as ProductCard | undefined;
  if (!base) return null;
  type ProductRowFields = { id: string; desc_ar: string; desc_en: string; specs: Record<string, unknown>; is_fragile: boolean; shipping_mode: string; weight_g: number | null; sale_starts_at: string | null; sale_ends_at: string | null; brand_id: string | null; deleted_at: string | null; status: string; size_chart: unknown };
  const product = ((prowRes.data ?? []) as ProductRowFields[]).find((r) => r.id === base.id);
  if (!product || product.status !== "approved" || product.deleted_at) return null;

  // ── round 2: everything keyed by the product id, in one parallel batch
  // (colour groups are read by product id now instead of waiting for the
  // variants to list their group ids; the live event joins this round too)
  const [mediaRes, variantsRes, pavRes, reviewsRes, brandRes, groupRes, event] = await Promise.all([
    client.from("product_media").select("id, kind, path").eq("product_id", base.id).order("position"),
    client.from("variants").select("id, sku, option_key, option_ids, price_piastres, sale_price_piastres, stock, image_path, is_active, group_id, sale_starts_at, sale_ends_at")
      .eq("product_id", base.id).is("deleted_at", null).eq("is_active", true).order("created_at"),
    // !inner + is(deleted_at, null): a soft-deleted attribute must disappear
    // from the public spec table, not linger because the product still has rows.
    client.from("product_attribute_values").select(
      "attribute_id, option_id, option_ids, value_text, value_text_en, value_number, value_bool, attribute_defs!inner(id, code, type, unit, label_ar, label_en, is_variant_axis, sort)",
    ).eq("product_id", base.id).is("attribute_defs.deleted_at", null),
    client.from("v_storefront_reviews").select("id, rating, title, body, created_at, author_name, media").eq("product_id", base.id)
      .order("created_at", { ascending: false }).limit(50),
    product.brand_id
      ? client.from("v_storefront_brands").select("id, name_ar, name_en, slug_ar, slug_en, thumb_path").eq("id", product.brand_id).limit(1)
      : Promise.resolve({ data: null, error: null }),
    client.from("variant_groups").select("id, color_option_id, sort, variant_group_media(path, position)").eq("product_id", base.id).order("sort"),
    base.event_percent > 0 ? getActiveEvent(client) : Promise.resolve(null),
  ]);
  if (mediaRes.error) throw new Error(mediaRes.error.message);
  if (variantsRes.error) throw new Error(variantsRes.error.message);
  if (pavRes.error) throw new Error(pavRes.error.message);
  if (reviewsRes.error) throw new Error(reviewsRes.error.message);

  const variants = (variantsRes.data ?? []) as VariantRow[];
  // only the groups the live variants actually use (same set as before)
  const usedGroupIds = new Set(variants.map((v) => v.group_id).filter((id): id is string => Boolean(id)));
  const groups: ProductGroup[] = ((groupRes.data ?? []) as Array<{ id: string; color_option_id: string | null; variant_group_media: Array<{ path: string; position: number }> | null }>)
    .filter((g) => usedGroupIds.has(g.id))
    .map((g) => ({
      id: g.id,
      color_option_id: g.color_option_id,
      images: (g.variant_group_media ?? []).sort((a, b) => a.position - b.position).map((m) => m.path),
    }));
  const defs = (pavRes.data ?? []) as unknown as Array<{
    attribute_id: string; option_id: string | null; option_ids: string[] | null; value_text: string | null; value_text_en: string | null; value_number: number | null; value_bool: boolean | null;
    attribute_defs: { id: string; code: string; type: string; unit: string; label_ar: string | null; label_en: string | null; is_variant_axis: boolean; sort: number };
  }>;

  // ── round 3: option labels for the variant selector AND the spec table,
  // with each option's attribute definition embedded (the axis definitions
  // used to be a 4th round-trip)
  const variantOptionIds = [...new Set(variants.flatMap((v) => v.option_ids ?? []))];
  const specOptionIds = [...new Set(defs.flatMap((d) => d.option_ids?.length ? d.option_ids : d.option_id ? [d.option_id] : []))];
  const allOptionIds = [...new Set([...variantOptionIds, ...specOptionIds])];
  type OptionRow = { id: string; attribute_id: string; code: string; label_ar: string; label_en: string; color_hex: string | null; attribute_defs: { id: string; code: string; type: string; label_ar: string | null; label_en: string | null } | null };
  const fetchedOptions = allOptionIds.length > 0
    ? await client.from("attribute_options").select("id, attribute_id, code, label_ar, label_en, color_hex, attribute_defs!attribute_options_attribute_id_fkey(id, code, type, label_ar, label_en)").in("id", allOptionIds)
    : { data: [], error: null };
  if (fetchedOptions.error) throw new Error(fetchedOptions.error.message);
  const optionRows = (fetchedOptions.data ?? []) as unknown as OptionRow[];
  const variantIdSet = new Set(variantOptionIds);
  const variantOptionRows = optionRows.filter((o) => variantIdSet.has(o.id));
  // axis definitions: from the variants' options, plus pav rows flagged as axes
  const axisDefs = new Map<string, { id: string; code: string; type: string; label_ar: string | null; label_en: string | null }>();
  for (const o of variantOptionRows) if (o.attribute_defs) axisDefs.set(o.attribute_defs.id, o.attribute_defs);
  for (const d of defs) {
    if (d.attribute_defs.is_variant_axis && !axisDefs.has(d.attribute_id)) {
      const a = d.attribute_defs;
      axisDefs.set(d.attribute_id, { id: a.id, code: a.code, type: a.type, label_ar: a.label_ar, label_en: a.label_en });
    }
  }
  const defRes = { data: [...axisDefs.values()], error: null as { message: string } | null };
  const optRes = {
    data: variantOptionRows.map(({ id, attribute_id, code, label_ar, label_en, color_hex }) => ({ id, attribute_id, code, label_ar, label_en, color_hex })),
    error: null as { message: string } | null,
  };

  const axes = ((defRes.data ?? []) as Array<{ id: string; code: string; type: string; label_ar: string | null; label_en: string | null }>).map((d) => {
    const options = ((optRes.data ?? []) as Array<{ id: string; attribute_id: string; code: string; label_ar: string; label_en: string; color_hex: string | null }>)
      .filter((o) => o.attribute_id === d.id);
    // pack sizes (wt_… grams / vol_… mL) are a «الحجم» and capacities (st_… / rs_… RAM+storage)
    // a «المساحة», not a clothing «المقاس». Cookware diameters (dia_…) read
    // «القطر» and capacity sizes (cap_…) «السعة»; a mix keeps the attribute label.
    const pack = options.length > 0 && options.every((o) => /^(wt|vol)_/.test(o.code ?? ""));
    const storage = options.length > 0 && options.every((o) => /^(st|rs)_/.test(o.code ?? ""));
    const diameter = options.length > 0 && options.every((o) => (o.code ?? "").startsWith("dia_"));
    const capacity = options.length > 0 && options.every((o) => (o.code ?? "").startsWith("cap_"));
    return {
    attribute_id: d.id,
    code: d.code,
    label_ar: diameter ? "القطر" : capacity ? "السعة" : pack ? "الحجم" : storage ? "المساحة" : d.label_ar ?? d.code,
    label_en: diameter ? "Diameter" : capacity ? "Capacity" : pack ? "Pack size" : storage ? "Storage" : d.label_en ?? d.code,
    type: d.type,
    options: options.map(({ code: _code, ...o }) => o),
  // colour / size are optional for sellers: an axis no variant uses is not shown
  };
  }).filter((axis) => axis.options.length > 0);

  const optionById = new Map(((fetchedOptions.data ?? []) as Array<{ id: string; label_ar: string; label_en: string; color_hex: string | null }>).map((o) => [o.id, o]));
  const attributes: AttributeView[] = defs
    .sort((a, b) => (a.attribute_defs.sort ?? 0) - (b.attribute_defs.sort ?? 0))
    .map((row) => {
      const ids = row.option_ids?.length ? row.option_ids : row.option_id ? [row.option_id] : [];
      const chosen = ids.map((id) => optionById.get(id)).filter((o): o is { id: string; label_ar: string; label_en: string; color_hex: string | null } => Boolean(o));
      const opt = chosen[0];
      return {
        attribute_id: row.attribute_id,
        code: row.attribute_defs.code,
        type: row.attribute_defs.type,
        unit: row.attribute_defs.unit,
        label_ar: row.attribute_defs.label_ar ?? row.attribute_defs.code,
        label_en: row.attribute_defs.label_en ?? row.attribute_defs.code,
        option_label_ar: opt?.label_ar ?? null,
        option_label_en: opt?.label_en ?? null,
        color_hex: opt?.color_hex ?? null,
        options: chosen.map((o) => ({ label_ar: o.label_ar, label_en: o.label_en, color_hex: o.color_hex })),
        value_text: row.value_text,
        value_text_en: row.value_text_en,
        value_number: row.value_number,
        value_bool: row.value_bool,
        is_axis: row.attribute_defs.is_variant_axis,
      };
    });

  return {
    card: base,
    desc_ar: product.desc_ar,
    desc_en: product.desc_en,
    specs: product.specs ?? {},
    is_fragile: product.is_fragile,
    shipping_mode: product.shipping_mode,
    weight_g: product.weight_g,
    sale_starts_at: product.sale_starts_at,
    sale_ends_at: product.sale_ends_at,
    size_chart: parseChart(product.size_chart),
    brand_id: product.brand_id,
    brand_name_ar: (brandRes.data?.[0] as { name_ar: string; name_en: string; slug_ar: string; slug_en: string } | undefined)?.name_ar ?? null,
    brand_name_en: (brandRes.data?.[0] as { name_ar: string; name_en: string; slug_ar: string; slug_en: string } | undefined)?.name_en ?? null,
    brand_slug_ar: (brandRes.data?.[0] as { name_ar: string; name_en: string; slug_ar: string; slug_en: string } | undefined)?.slug_ar ?? null,
    brand_slug_en: (brandRes.data?.[0] as { name_ar: string; name_en: string; slug_ar: string; slug_en: string } | undefined)?.slug_en ?? null,
    brand_thumb_path: (brandRes.data?.[0] as { thumb_path?: string | null } | undefined)?.thumb_path ?? null,
    media: (mediaRes.data ?? []) as Array<{ id: string; kind: string; path: string }>,
    variants,
    groups,
    event,
    axes,
    attributes,
    reviews: (reviewsRes.data ?? []) as ReviewRow[],
  };
}

/** Products from the same leaf (related strip); excludes the current one. */
export async function getRelatedProducts(client: SupabaseClient, leafId: string, excludeId: string, limit = 8): Promise<ProductCard[]> {
  const { data, error } = await client
    .from("v_storefront_products")
    .select(PRODUCT_CARD_COLUMNS)
    .eq("leaf_category_id", leafId)
    .eq("is_listable", true)
    .neq("id", excludeId)
    .not("min_price_piastres", "is", null)
    .order("rating_count", { ascending: false })
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as ProductCard[];
}

/** Store-page products (S-06): event-hidden products stay visible HERE with a
 * notice — the view flags them, the listing contexts filter is_listable. */
/**
 * Every listable product of one store. The store page filters this set in
 * memory (discount and effective price are computed here, not in SQL), so the
 * ceiling is the page's own browse depth — 60 truncated large stores mid-grid.
 */
export async function getStoreProducts(
  client: SupabaseClient,
  vendorId: string,
  limit = 240,
): Promise<ProductCard[]> {
  const { data, error } = await client
    .from("v_storefront_products")
    .select(PRODUCT_CARD_COLUMNS)
    .eq("vendor_id", vendorId)
    .not("min_price_piastres", "is", null)
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as ProductCard[];
}

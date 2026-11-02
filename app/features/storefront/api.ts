import type { SupabaseClient } from "@supabase/supabase-js";

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
  min_regular_piastres: number | null;
  has_sale: boolean;
  event_percent: number;
  event_max_piastres: number | null;
  stock_total: number;
  rating_avg: number | null;
  rating_count: number;
  is_featured: boolean;
  is_event_hidden: boolean;
  vendor_event_refused: boolean;
  is_listable: boolean;
  published_at: string | null;
  created_at: string;
  event_price_piastres?: number;
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
}

export interface BannerRow {
  id: string;
  title_ar: string;
  title_en: string;
  image_path: string;
  link_url: string;
  position: number;
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
  brands: Array<{ id: string | null; name_ar: string | null; name_en: string | null; count: number }>;
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
    p_sort: params.sort ?? "newest",
    p_page: params.page ?? 1,
    p_per_page: params.perPage ?? 24,
  });
  return raw ?? { total: 0, page: 1, per_page: params.perPage ?? 24, items: [], facets: { brands: [], categories: [], attributes: [] } };
}

export async function searchSuggestions(
  client: SupabaseClient,
  q: string,
): Promise<{ products: Array<{ id: string; slug_ar: string; slug_en: string; name_ar: string; name_en: string; main_image_path: string | null; price_piastres: number | null }>; stores: Array<{ slug: string; name_ar: string; name_en: string; logo_path: string | null }>; categories: Array<{ slug_ar: string; slug_en: string; name_ar: string; name_en: string; depth: number }> }> {
  const raw = await rpcJson<{ products: unknown[]; stores: unknown[]; categories: unknown[] }>(
    client, "fn_search_suggestions", { p_q: q, p_limit: 4 },
  );
  const empty = { products: [], stores: [], categories: [] };
  if (!raw) return empty;
  return {
    products: (raw.products ?? []) as never,
    stores: (raw.stores ?? []) as never,
    categories: (raw.categories ?? []) as never,
  };
}

export async function didYouMean(client: SupabaseClient, q: string): Promise<string | null> {
  const { data, error } = await client.rpc("fn_search_did_you_mean", { p_q: q });
  if (error) return null;
  return typeof data === "string" && data.length > 0 ? data : null;
}

export async function getCategories(client: SupabaseClient): Promise<CategoryNode[]> {
  const { data, error } = await client.from("v_storefront_categories").select("*").order("depth").order("sort");
  if (error) throw new Error(error.message);
  return (data ?? []) as CategoryNode[];
}

export async function getCategoryBySlug(client: SupabaseClient, slug: string): Promise<CategoryNode | null> {
  const { data, error } = await client.from("v_storefront_categories").select("*").or(`slug_ar.eq.${slug},slug_en.eq.${slug}`).limit(1);
  if (error) throw new Error(error.message);
  return (data?.[0] as CategoryNode | undefined) ?? null;
}

export async function getFeaturedProducts(client: SupabaseClient, limit = 8): Promise<ProductCard[]> {
  const { data, error } = await client
    .from("v_storefront_products")
    .select("*")
    .eq("is_listable", true)
    .eq("is_featured", true)
    .not("min_price_piastres", "is", null)
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as ProductCard[];
}

export async function getTopRatedProducts(client: SupabaseClient, limit = 8): Promise<ProductCard[]> {
  const { data, error } = await client
    .from("v_storefront_products")
    .select("*")
    .eq("is_listable", true)
    .gt("rating_count", 0)
    .not("min_price_piastres", "is", null)
    .order("rating_count", { ascending: false })
    .order("rating_avg", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as ProductCard[];
}

export async function getNewestProducts(client: SupabaseClient, limit = 8): Promise<ProductCard[]> {
  const { data, error } = await client
    .from("v_storefront_products")
    .select("*")
    .eq("is_listable", true)
    .not("min_price_piastres", "is", null)
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as ProductCard[];
}

export async function getBanners(client: SupabaseClient): Promise<BannerRow[]> {
  // L-04 — only live banners: active flag + publish window (null bounds = open)
  const now = new Date().toISOString();
  const { data, error } = await client
    .from("banners")
    .select("id, title_ar, title_en, image_path, link_url, position")
    .eq("is_active", true)
    .or(`starts_at.is.null,starts_at.lte.${now}`)
    .or(`ends_at.is.null,ends_at.gte.${now}`)
    .order("position");
  if (error) return []; // banners are optional decoration — an empty list hides the block
  return (data ?? []) as BannerRow[];
}

export async function getActiveEvent(client: SupabaseClient): Promise<ActiveEvent | null> {
  const { data, error } = await client.from("v_storefront_active_event").select("*").limit(1);
  if (error) return null;
  return (data?.[0] as ActiveEvent | undefined) ?? null;
}

export async function getFeaturedStores(client: SupabaseClient, limit = 8): Promise<StoreCard[]> {
  const { data, error } = await client
    .from("v_storefront_stores")
    .select("*")
    .eq("status", "active")
    .eq("is_featured", true)
    .eq("is_listable", true)
    .order("product_count", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as StoreCard[];
}

export async function listStores(client: SupabaseClient, opts: { featuredOnly?: boolean } = {}): Promise<StoreCard[]> {
  let query = client.from("v_storefront_stores").select("*").eq("status", "active").eq("is_listable", true);
  if (opts.featuredOnly) query = query.eq("is_featured", true);
  const { data, error } = await query.order("is_featured", { ascending: false }).order("product_count", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as StoreCard[];
}

export async function getStoreBySlug(client: SupabaseClient, slug: string): Promise<StoreCard | null> {
  const { data, error } = await client.from("v_storefront_stores").select("*").eq("slug", slug).limit(1);
  if (error) throw new Error(error.message);
  const store = (data?.[0] as StoreCard | undefined) ?? null;
  // A store hidden from listings must not be reachable by direct URL either.
  if (!store || store.is_listable === false) return null;
  return store;
}

export async function listBrands(client: SupabaseClient): Promise<BrandCard[]> {
  const { data, error } = await client
    .from("v_storefront_brands")
    .select("*")
    .order("sort")
    .order("name_ar");
  if (error) throw new Error(error.message);
  return (data ?? []) as BrandCard[];
}

export async function getBrandBySlug(client: SupabaseClient, slug: string): Promise<BrandCard | null> {
  const { data, error } = await client.from("v_storefront_brands").select("*").or(`slug_ar.eq.${slug},slug_en.eq.${slug}`).limit(1);
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

export async function getStaticPage(client: SupabaseClient, slug: string): Promise<StaticPage | null> {
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
  value_text: string | null;
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
  brand_id: string | null;
  brand_name_ar: string | null;
  brand_name_en: string | null;
  brand_slug_ar: string | null;
  brand_slug_en: string | null;
  media: Array<{ id: string; kind: string; path: string }>;
  variants: VariantRow[];
  axes: Array<{ attribute_id: string; code: string; label_ar: string; label_en: string; type: string; options: Array<{ id: string; label_ar: string; label_en: string; color_hex: string | null }> }>;
  attributes: AttributeView[];
  reviews: ReviewRow[];
}

export async function getProductPage(client: SupabaseClient, slug: string): Promise<ProductPage | null> {
  const { data: card, error } = await client
    .from("v_storefront_products")
    .select("*")
    .or(`slug_ar.eq.${slug},slug_en.eq.${slug}`)
    .limit(1);
  if (error) throw new Error(error.message);
  const base = card?.[0] as ProductCard | undefined;
  if (!base) return null;

  // base product row for the fields the card view doesn't carry — safe: the
  // public RLS policy only exposes approved+public rows
  const { data: prow, error: perr } = await client
    .from("products")
    .select("id, desc_ar, desc_en, specs, is_fragile, shipping_mode, weight_g, sale_starts_at, sale_ends_at, brand_id, deleted_at, status")
    .eq("id", base.id)
    .limit(1);
  if (perr) throw new Error(perr.message);
  const product = prow?.[0] as
    | { id: string; desc_ar: string; desc_en: string; specs: Record<string, unknown>; is_fragile: boolean; shipping_mode: string; weight_g: number | null; sale_starts_at: string | null; sale_ends_at: string | null; brand_id: string | null; deleted_at: string | null; status: string }
    | undefined;
  if (!product || product.status !== "approved" || product.deleted_at) return null;

  const [mediaRes, variantsRes, pavRes, reviewsRes, brandRes] = await Promise.all([
    client.from("product_media").select("id, kind, path").eq("product_id", base.id).order("position"),
    client.from("variants").select("id, sku, option_key, option_ids, price_piastres, sale_price_piastres, stock, image_path, is_active")
      .eq("product_id", base.id).is("deleted_at", null).eq("is_active", true).order("created_at"),
    // !inner + is(deleted_at, null): a soft-deleted attribute must disappear
    // from the public spec table, not linger because the product still has rows.
    client.from("product_attribute_values").select(
      "attribute_id, option_id, value_text, value_number, value_bool, attribute_defs!inner(id, code, type, unit, label_ar, label_en, is_variant_axis, sort)",
    ).eq("product_id", base.id).is("attribute_defs.deleted_at", null),
    client.from("v_storefront_reviews").select("id, rating, title, body, created_at, author_name").eq("product_id", base.id)
      .order("created_at", { ascending: false }).limit(50),
    product.brand_id
      ? client.from("v_storefront_brands").select("id, name_ar, name_en, slug_ar, slug_en").eq("id", product.brand_id).limit(1)
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (mediaRes.error) throw new Error(mediaRes.error.message);
  if (variantsRes.error) throw new Error(variantsRes.error.message);
  if (pavRes.error) throw new Error(pavRes.error.message);
  if (reviewsRes.error) throw new Error(reviewsRes.error.message);

  const variants = (variantsRes.data ?? []) as VariantRow[];
  const defs = (pavRes.data ?? []) as unknown as Array<{
    attribute_id: string; option_id: string | null; value_text: string | null; value_number: number | null; value_bool: boolean | null;
    attribute_defs: { id: string; code: string; type: string; unit: string; label_ar: string | null; label_en: string | null; is_variant_axis: boolean; sort: number };
  }>;

  // axis defs + their options (for the variant selector): axes live in the
  // VARIANTS' option_ids (attribute_options.attribute_id), not in pav rows
  const variantOptionIds = [...new Set(variants.flatMap((v) => v.option_ids ?? []))];
  const variantOptions = variantOptionIds.length > 0
    ? await client.from("attribute_options").select("id, attribute_id, label_ar, label_en, color_hex").in("id", variantOptionIds)
    : { data: [], error: null };
  if (variantOptions.error) throw new Error(variantOptions.error.message);
  const axisDefIdsFromVariants = [...new Set(((variantOptions.data ?? []) as Array<{ attribute_id: string }>).map((o) => o.attribute_id))];
  const axisDefIds = [...new Set([
    ...axisDefIdsFromVariants,
    ...defs.filter((d) => d.attribute_defs.is_variant_axis).map((d) => d.attribute_id),
  ])];
  const [defRes, optRes] = await Promise.all([
    axisDefIds.length > 0
      ? client.from("attribute_defs").select("id, code, type, label_ar, label_en").in("id", axisDefIds)
      : Promise.resolve({ data: [], error: null } as { data: Array<{ id: string; code: string; type: string; label_ar: string | null; label_en: string | null }>; error: null }),
    Promise.resolve(variantOptions as { data: Array<{ id: string; attribute_id: string; label_ar: string; label_en: string; color_hex: string | null }> | null; error: { message: string } | null }),
  ]);
  if (defRes.error) throw new Error(defRes.error.message);
  if (optRes.error) throw new Error(optRes.error.message);

  const axes = ((defRes.data ?? []) as Array<{ id: string; code: string; type: string; label_ar: string | null; label_en: string | null }>).map((d) => ({
    attribute_id: d.id,
    code: d.code,
    label_ar: d.label_ar ?? d.code,
    label_en: d.label_en ?? d.code,
    type: d.type,
    options: ((optRes.data ?? []) as Array<{ id: string; attribute_id: string; label_ar: string; label_en: string; color_hex: string | null }>)
      .filter((o) => o.attribute_id === d.id),
  }));

  const optionById = new Map(((optRes.data ?? []) as Array<{ id: string; label_ar: string; label_en: string; color_hex: string | null }>).map((o) => [o.id, o]));
  const attributes: AttributeView[] = defs
    .sort((a, b) => (a.attribute_defs.sort ?? 0) - (b.attribute_defs.sort ?? 0))
    .map((row) => {
      const opt = row.option_id ? optionById.get(row.option_id) : undefined;
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
        value_text: row.value_text,
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
    brand_id: product.brand_id,
    brand_name_ar: (brandRes.data?.[0] as { name_ar: string; name_en: string; slug_ar: string; slug_en: string } | undefined)?.name_ar ?? null,
    brand_name_en: (brandRes.data?.[0] as { name_ar: string; name_en: string; slug_ar: string; slug_en: string } | undefined)?.name_en ?? null,
    brand_slug_ar: (brandRes.data?.[0] as { name_ar: string; name_en: string; slug_ar: string; slug_en: string } | undefined)?.slug_ar ?? null,
    brand_slug_en: (brandRes.data?.[0] as { name_ar: string; name_en: string; slug_ar: string; slug_en: string } | undefined)?.slug_en ?? null,
    media: (mediaRes.data ?? []) as Array<{ id: string; kind: string; path: string }>,
    variants,
    axes,
    attributes,
    reviews: (reviewsRes.data ?? []) as ReviewRow[],
  };
}

/** Products from the same leaf (related strip); excludes the current one. */
export async function getRelatedProducts(client: SupabaseClient, leafId: string, excludeId: string, limit = 8): Promise<ProductCard[]> {
  const { data, error } = await client
    .from("v_storefront_products")
    .select("*")
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
export async function getStoreProducts(client: SupabaseClient, vendorId: string): Promise<ProductCard[]> {
  const { data, error } = await client
    .from("v_storefront_products")
    .select("*")
    .eq("vendor_id", vendorId)
    .not("min_price_piastres", "is", null)
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(60);
  if (error) throw new Error(error.message);
  return (data ?? []) as ProductCard[];
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "~/lib/supabase/fetch-all";
import type { LoaderChild, SizeOption } from "~/features/products/components/wizard/children";
import type {
  PickerCategory,
  TemplateAttr,
  TemplateOption,
  WizardBrand,
  WizardProduct,
} from "~/features/products/components/wizard/types";

/**
 * Loader helpers shared by the seller wizard (/vendor/products/:id/edit) and
 * the admin product editor (/admin/products/:id/edit): the product bundle, the
 * leaf template, size options, brands, the category picker tree and tags.
 *
 * The admin route intentionally has no vendor_id filter — RLS lets a
 * products.view holder read every product.
 */

export interface WizardProductBundle {
  product: WizardProduct;
  childrenData: LoaderChild[];
  template: TemplateAttr[];
  sizeOptions: SizeOption[];
  brands: WizardBrand[];
  /** the store the product belongs to (admin header) */
  store: { name_ar: string; name_en: string } | null;
}

export async function loadWizardProduct(client: SupabaseClient, productId: string, vendorId?: string): Promise<WizardProductBundle | null> {
  let query = client
    .from("products")
    .select("*, vendors(store_name_ar, store_name_en)")
    .eq("id", productId)
    .is("deleted_at", null);
  if (vendorId) query = query.eq("vendor_id", vendorId);
  const { data: row } = await query.maybeSingle();
  if (!row) return null;

  const [mediaRes, tagsRes, valuesRes, childrenData] = await Promise.all([
    client.from("product_media").select("kind, path, position").eq("product_id", productId).order("position"),
    client.from("product_tags").select("tag_id").eq("product_id", productId),
    client
      .from("product_attribute_values")
      .select("attribute_id, option_id, option_ids, value_text, value_text_en, value_number, value_bool")
      .eq("product_id", productId),
    loadChildren(client, productId),
  ]);

  const product: WizardProduct = {
    id: row.id,
    status: row.status,
    rejected_final: Boolean(row.rejected_final),
    rejection_reason: row.rejection_reason,
    name_ar: row.name_ar,
    name_en: row.name_en,
    desc_ar: row.desc_ar,
    desc_en: row.desc_en,
    short_ar: row.short_ar,
    short_en: row.short_en,
    leaf_category_id: row.leaf_category_id,
    brand_id: row.brand_id,
    is_fragile: row.is_fragile,
    sale_starts_at: row.sale_starts_at,
    sale_ends_at: row.sale_ends_at,
    weight_g: row.weight_g,
    dims: (row.dims ?? {}) as WizardProduct["dims"],
    shipping_class: row.shipping_class,
    shipping_mode: row.shipping_mode,
    size_chart: row.size_chart ?? null,
    updated_at: row.updated_at,
    media: (mediaRes.data ?? []).map((m: { kind: string; path: string }) => ({ kind: m.kind as "image" | "video", path: m.path })),
    tag_ids: (tagsRes.data ?? []).map((tag: { tag_id: string }) => tag.tag_id),
    attribute_values: valuesRes.data ?? [],
  };
  const vendor = row.vendors as { store_name_ar: string | null; store_name_en: string | null } | null;

  const [template, sizeOptions, brands] = await Promise.all([
    loadTemplate(client, row.leaf_category_id),
    loadSizeOptions(client, row.leaf_category_id),
    loadBrands(client, row.leaf_category_id, row.brand_id, vendorId),
  ]);

  return {
    product,
    childrenData,
    template,
    sizeOptions,
    brands,
    store: vendor ? { name_ar: vendor.store_name_ar ?? "", name_en: vendor.store_name_en ?? "" } : null,
  };
}

/**
 * Leaf template load (V-11): defs in configured order + admin options only.
 * A link may narrow the options for this category (`allowed_option_ids`, e.g.
 * a shirt's material offers textiles, not plastic or marble); null = all.
 */
export async function loadTemplate(client: SupabaseClient, leafCategoryId: string | null): Promise<TemplateAttr[]> {
  if (!leafCategoryId) return [];
  // template = defs owned by the leaf (phase-02 model) + defs linked to it
  const [{ data: ownDefs }, { data: linkedDefs }] = await Promise.all([
    client.from("attribute_defs").select("*").eq("category_id", leafCategoryId).is("deleted_at", null),
    client
      .from("category_attributes")
      .select("sort, allowed_option_ids, is_required, attribute_defs!inner(*)")
      .eq("category_id", leafCategoryId),
  ]);
  const defRows = new Map<string, Record<string, unknown>>();
  const allowed = new Map<string, Set<string>>();
  for (const def of (ownDefs ?? []) as unknown as Array<Record<string, unknown>>) {
    defRows.set(def.id as string, def);
  }
  for (const row of (linkedDefs ?? []) as unknown as Array<{ sort: number; allowed_option_ids: string[] | null; is_required: boolean | null; attribute_defs: Record<string, unknown> }>) {
    const def = row.attribute_defs;
    // a linked attribute (global dictionary spec) is placed by the link — the
    // leaf's template order — not by its own dictionary-wide sort
    if (def && !def.deleted_at) {
      // required in THIS category (the link) or everywhere (the spec)
      defRows.set(def.id as string, { ...def, sort: row.sort, is_required: Boolean(def.is_required) || Boolean(row.is_required) });
      if (row.allowed_option_ids) allowed.set(def.id as string, new Set(row.allowed_option_ids));
    }
  }
  // every option of the template in one paged query (was one query per spec)
  const defIds = [...defRows.keys()];
  const allOptions = defIds.length
    ? await fetchAll<TemplateOption & { attribute_id: string }>((from, to) =>
        client.from("attribute_options").select("id, attribute_id, code, label_ar, label_en, color_hex")
          .in("attribute_id", defIds).is("deleted_at", null).order("sort").order("id").range(from, to))
    : [];
  const attrs: TemplateAttr[] = [];
  for (const def of defRows.values()) {
    const scope = allowed.get(def.id as string);
    const options = allOptions
      .filter((o) => o.attribute_id === def.id && (!scope || scope.has(o.id)))
      .map(({ attribute_id: _a, ...o }) => o);
    attrs.push({
      id: def.id as string,
      code: def.code as string,
      label_ar: (def.label_ar as string | null) ?? "",
      label_en: (def.label_en as string | null) ?? "",
      type: def.type as TemplateAttr["type"],
      unit: def.unit as string,
      is_required: def.is_required as boolean,
      is_filterable: def.is_filterable as boolean,
      is_variant_axis: def.is_variant_axis as boolean,
      is_multi: Boolean(def.is_multi),
      sort: def.sort as number,
      options,
    });
  }
  attrs.sort((a, b) => a.sort - b.sort);
  return attrs;
}

/**
 * Brands offered for a leaf: those linked to the leaf or any ancestor (brands
 * are linked at main/sub level), plus the seller's own pending proposals for
 * that branch. Replaces shipping all ~1,500 brands with their links in every
 * form load. `keepId` (the product's saved brand) is always included.
 */
export async function loadBrands(client: SupabaseClient, leafCategoryId: string | null, keepId?: string | null, vendorId?: string | null): Promise<WizardBrand[]> {
  if (!leafCategoryId) return [];
  const { data: leaf } = await client.from("categories").select("path").eq("id", leafCategoryId).maybeSingle();
  const branch = [...new Set([leafCategoryId, ...String(leaf?.path ?? "").split("/").filter(Boolean)])];
  const [{ data: linked }, { data: kept }, { data: own }] = await Promise.all([
    client.from("brands").select("id, name_ar, name_en, thumb_path, brand_categories!inner(category_id)")
      .in("brand_categories.category_id", branch).eq("is_active", true).is("deleted_at", null).order("sort").limit(1000),
    keepId ? client.from("brands").select("id, name_ar, name_en, thumb_path, review_status").eq("id", keepId).maybeSingle() : Promise.resolve({ data: null }),
    // the seller must keep seeing their proposal (and its pending badge) on reload
    vendorId
      ? client.from("brands").select("id, name_ar, name_en, thumb_path, review_status, brand_categories!inner(category_id)")
          .in("brand_categories.category_id", branch).eq("review_status", "pending")
          .eq("proposed_vendor_id", vendorId).is("deleted_at", null)
      : Promise.resolve({ data: null }),
  ]);
  const out = new Map<string, WizardBrand>();
  const add = (b: { id: string; name_ar: string; name_en: string; thumb_path: string | null; review_status?: string }) =>
    out.set(b.id, { id: b.id, name_ar: b.name_ar, name_en: b.name_en, thumb_path: b.thumb_path ?? null, pending: b.review_status === "pending" });
  for (const b of (linked ?? []) as Array<{ id: string; name_ar: string; name_en: string; thumb_path: string | null }>) add(b);
  const k = kept as { id: string; name_ar: string; name_en: string; thumb_path: string | null; review_status?: string } | null;
  if (k && !out.has(k.id)) add(k);
  for (const b of (own ?? []) as Array<{ id: string; name_ar: string; name_en: string; thumb_path: string | null; review_status: string }>) add(b);
  return [...out.values()];
}

/** Sizes offered for a leaf: the size types assigned to its branch. */
export async function loadSizeOptions(client: SupabaseClient, leafCategoryId: string | null): Promise<SizeOption[]> {
  if (!leafCategoryId) return [];
  const { data: rows } = await client.rpc("fn_size_options_for", { p_leaf: leafCategoryId });
  return (rows ?? []) as SizeOption[];
}

/** A product's child products with their images and live per-size rows. */export async function loadChildren(client: SupabaseClient, productId: string): Promise<LoaderChild[]> {
  const { data: groups } = await client
    .from("variant_groups")
    .select("id, color_option_id, price_piastres, sale_price_piastres, sale_starts_at, sale_ends_at, sort, variant_group_media(path, position), variants(size_option_id, ram_option_id, price_piastres, sale_price_piastres, stock, sku, option_key, deleted_at)")
    .eq("product_id", productId)
    .is("deleted_at", null)
    .order("sort");
  return ((groups ?? []) as Array<Record<string, unknown>>).map((g) => ({
    id: g.id as string,
    color_option_id: (g.color_option_id as string | null) ?? null,
    price_piastres: (g.price_piastres as number | null) ?? null,
    sale_price_piastres: (g.sale_price_piastres as number | null) ?? null,
    sale_starts_at: (g.sale_starts_at as string | null) ?? null,
    sale_ends_at: (g.sale_ends_at as string | null) ?? null,
    images: ((g.variant_group_media as Array<{ path: string; position: number }> | null) ?? [])
      .sort((x, y) => x.position - y.position).map((m) => m.path),
    sizes: ((g.variants as Array<{ size_option_id: string | null; ram_option_id: string | null; price_piastres: number | null; sale_price_piastres: number | null; stock: number; sku: string | null; option_key: string; deleted_at: string | null }> | null) ?? [])
      .filter((v) => !v.deleted_at)
      .sort((x, y) => x.option_key.localeCompare(y.option_key))
      .map((v) => ({ size_option_id: v.size_option_id, ram_option_id: v.ram_option_id, price_piastres: v.price_piastres, sale_price_piastres: v.sale_price_piastres, stock: v.stock, sku: v.sku })),
  }));
}

/**
 * Category tree for the picker. `chosen` = the seller's registered branches:
 * only those (and their ancestors) are offered. Empty = the whole tree.
 */
export async function loadWizardCategories(client: SupabaseClient, chosen: string[] = []): Promise<PickerCategory[]> {
  // paged: browse tree + level-4 product types exceed the 1000-row cap
  const cats = await fetchAll<PickerCategory & { path: string }>((from, to) =>
    client
      .from("categories")
      .select("id, parent_id, depth, name_ar, name_en, slug_en, path")
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("sort")
      .order("id")
      .range(from, to));
  const chosenSet = new Set(chosen);
  if (chosenSet.size === 0) return cats.map(({ path: _path, ...c }) => c);
  // ancestors of a chosen sub-category stay too — the cascading picker starts at the root
  const ancestors = new Set(cats.filter((c) => chosenSet.has(c.id)).flatMap((c) => c.path.split("/")));
  return cats
    .filter((c) => ancestors.has(c.id) || c.path.split("/").some((id) => chosenSet.has(id)))
    .map(({ path: _path, ...c }) => c);
}

/** Tags offered on the classification step. */
export async function loadWizardTags(client: SupabaseClient) {
  const { data } = await client.from("tags").select("id, name_ar, name_en").is("deleted_at", null).order("sort");
  return (data ?? []) as Array<{ id: string; name_ar: string; name_en: string }>;
}

/** Write helper shared by both wizard actions: children rows for one product. */
export async function saveChildrenRpc(client: SupabaseClient, productId: string | null, raw: string) {
  let children: unknown;
  try { children = JSON.parse(raw); } catch { return { ok: false as const, error: "payload" }; }
  const { data: res, error } = await client.rpc("fn_save_children", { p_product_id: productId, p_children: children });
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const, children: (res as { children: Array<{ id: string; sizes: Array<{ variant_id: string; size_option_id: string | null; ram_option_id?: string | null; sku: string | null; stock: number }> }> }).children };
}

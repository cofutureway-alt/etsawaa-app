import type { Route } from "./+types/product-wizard";
import { data, redirect } from "react-router";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireLang } from "~/lib/lang.server";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { fetchVendorRow } from "~/features/vendor/api";
import { parseMediaSettings } from "~/lib/media.shared";
import {
  ProductWizard,
  type LoaderVariant,
  type PickerCategory,
  type TemplateAttr,
  type WizardProduct,
} from "~/features/products/components/product-wizard";
import type { SaveActionData } from "~/features/products/components/product-wizard";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonForm } from "~/components/ui/Skeleton";


/**
 * /vendor/products/new + /vendor/products/:id/edit — the 5-step wizard.
 * Server action maps every intent onto the definer RPCs (atomic multi-row
 * writes); loaders feed the template that generates the form.
 */

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) {
    throw redirect(`/${lang}/auth/login?error=db`);
  }
  const viewer = await requirePanelAccess(client, lang, "vendor", request);
  const vendor = await fetchVendorRow(client, viewer.user.id);
  if (!vendor) {
    throw redirect(`/${lang}/vendor/onboarding`);
  }
  const productId = params.id ?? null;

  let product: WizardProduct | null = null;
  let variants: LoaderVariant[] = [];
  let template: TemplateAttr[] = [];

  if (productId) {
    const { data: row } = await client
      .from("products")
      .select("*")
      .eq("id", productId)
      .eq("vendor_id", vendor.id)
      .maybeSingle();
    if (!row) throw redirect(`/${lang}/vendor/products`);

    const [mediaRes, tagsRes, valuesRes, variantsRes] = await Promise.all([
      client.from("product_media").select("kind, path, position").eq("product_id", productId).order("position"),
      client.from("product_tags").select("tag_id").eq("product_id", productId),
      client
        .from("product_attribute_values")
        .select("attribute_id, option_id, value_text, value_number, value_bool")
        .eq("product_id", productId),
      client
        .from("variants")
        .select("id, option_key, option_ids, sku, price_piastres, sale_price_piastres, stock, image_path")
        .eq("product_id", productId)
        .is("deleted_at", null)
        .order("option_key"),
    ]);

    product = {
      id: row.id,
      status: row.status,
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
      updated_at: row.updated_at,
      media: (mediaRes.data ?? []).map((m: { kind: string; path: string }) => ({ kind: m.kind as "image" | "video", path: m.path })),
      tag_ids: (tagsRes.data ?? []).map((tag: { tag_id: string }) => tag.tag_id),
      attribute_values: valuesRes.data ?? [],
    };
    variants = (variantsRes.data ?? []) as LoaderVariant[];
    template = await loadTemplate(client, row.leaf_category_id);
  }

  const [catsRes, brandsRes, tagsRes, mediaRow] = await Promise.all([
    client
      .from("categories")
      .select("id, parent_id, depth, name_ar, name_en")
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("sort"),
    client.from("brands").select("id, name_ar, name_en").eq("is_active", true).is("deleted_at", null).order("sort"),
    client.from("tags").select("id, name_ar, name_en").is("deleted_at", null).order("sort"),
    client.from("settings").select("value").eq("key", "media").maybeSingle(),
  ]);

  return data({
    lang,
    uid: viewer.user.id,
    product,
    template,
    variants,
    categories: (catsRes.data ?? []) as PickerCategory[],
    brands: brandsRes.data ?? [],
    tags: tagsRes.data ?? [],
    media: parseMediaSettings(mediaRow?.value),
    supabaseUrl: process.env.SUPABASE_URL ?? "",
  });
}

/** Leaf template load (V-11): defs in configured order + admin options only. */
async function loadTemplate(client: SupabaseClient, leafCategoryId: string | null): Promise<TemplateAttr[]> {
  if (!leafCategoryId) return [];
  // template = defs owned by the leaf (phase-02 model) + defs linked to it
  const [{ data: ownDefs }, { data: linkedDefs }] = await Promise.all([
    client.from("attribute_defs").select("*").eq("category_id", leafCategoryId).is("deleted_at", null),
    client
      .from("category_attributes")
      .select("attribute_defs!inner(*)")
      .eq("category_id", leafCategoryId),
  ]);
  const defRows = new Map<string, Record<string, unknown>>();
  for (const def of (ownDefs ?? []) as unknown as Array<Record<string, unknown>>) {
    defRows.set(def.id as string, def);
  }
  for (const row of (linkedDefs ?? []) as unknown as Array<{ attribute_defs: Record<string, unknown> }>) {
    const def = row.attribute_defs;
    if (def && !def.deleted_at) defRows.set(def.id as string, def);
  }
  const attrs: TemplateAttr[] = [];
  for (const def of defRows.values()) {
    const { data: options } = await client
      .from("attribute_options")
      .select("id, label_ar, label_en, color_hex")
      .eq("attribute_id", def.id as string)
      .is("deleted_at", null)
      .order("sort");
    attrs.push({
      id: def.id as string,
      code: def.code as string,
      type: def.type as TemplateAttr["type"],
      unit: def.unit as string,
      is_required: def.is_required as boolean,
      is_filterable: def.is_filterable as boolean,
      is_variant_axis: def.is_variant_axis as boolean,
      sort: def.sort as number,
      options: options ?? [],
    });
  }
  attrs.sort((a, b) => a.sort - b.sort);
  return attrs;
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data<SaveActionData>({ intent: "save", ok: false, error: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "vendor", request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const productId = (String(form.get("productId") ?? "") || null) as string | null;

  if (intent === "save") {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(String(form.get("payload") ?? "{}")) as Record<string, unknown>;
    } catch {
      return data<SaveActionData>({ intent, ok: false, error: "payload" }, { status: 400 });
    }
    // two-tab conflict (US-10): last save wins, but the vendor is warned
    let stale = false;
    if (productId) {
      const { data: current } = await client
        .from("products")
        .select("updated_at")
        .eq("id", productId)
        .maybeSingle();
      const base = String(form.get("baseUpdatedAt") ?? "");
      if (current?.updated_at && base && current.updated_at !== base) stale = true;
    }
    const { data: saved, error } = await client.rpc("fn_save_product", {
      p_product: payload,
      p_id: productId,
    });
    if (error) {
      console.error("[product-wizard:save]", error.message);
      return data<SaveActionData>({ intent, ok: false, error: error.message }, { status: 400 });
    }
    const result = saved as { id: string; updated_at: string };
    return data<SaveActionData>({
      intent,
      ok: true,
      stale,
      updatedAt: result.updated_at,
      redirectTo: productId ? undefined : `/${lang}/vendor/products/${result.id}/edit`,
    });
  }

  if (intent === "generate_variants") {
    let axes: unknown = [];
    let defaults: unknown = {};
    try {
      axes = JSON.parse(String(form.get("axes") ?? "[]"));
      defaults = JSON.parse(String(form.get("defaults") ?? "{}"));
    } catch {
      return data<SaveActionData>({ intent, ok: false, error: "payload" }, { status: 400 });
    }
    const { data: result, error } = await client.rpc("fn_generate_variants", {
      p_product_id: productId,
      p_axes: axes,
      p_defaults: defaults,
    });
    if (error) return data<SaveActionData>({ intent, ok: false, error: error.message }, { status: 400 });
    const r = result as { inserted: number; removed: number; skipped: string[] };
    return data<SaveActionData>({ intent, ok: true, skipped: r.skipped ?? [] });
  }

  if (intent === "restore_variant") {
    const optionKey = String(form.get("optionKey") ?? "");
    const { error } = await client.rpc("fn_restore_variants", {
      p_product_id: productId,
      p_keys: optionKey ? [optionKey] : [],
    });
    if (error) return data<SaveActionData>({ intent, ok: false, error: error.message }, { status: 400 });
    return { intent, ok: true } as SaveActionData;
  }

  if (intent === "save_variants") {
    let rows: unknown = [];
    try {
      rows = JSON.parse(String(form.get("rows") ?? "[]"));
    } catch {
      return data<SaveActionData>({ intent, ok: false, error: "payload" }, { status: 400 });
    }
    const { error } = await client.rpc("fn_save_variants", { p_product_id: productId, p_rows: rows });
    if (error) return data<SaveActionData>({ intent, ok: false, error: error.message }, { status: 400 });
    return { intent, ok: true } as SaveActionData;
  }

  if (intent === "submit") {
    // no variant rows yet (no-axis product) → ensure the plain row exists first
    const { count } = await client
      .from("variants")
      .select("id", { count: "exact", head: true })
      .eq("product_id", productId ?? "")
      .is("deleted_at", null);
    if ((count ?? 0) === 0) {
      await client.rpc("fn_generate_variants", { p_product_id: productId, p_axes: [], p_defaults: {} });
    }
    const { error } = await client.rpc("fn_submit_product", { p_product_id: productId });
    if (error) return data<SaveActionData>({ intent, ok: false, error: error.message }, { status: 400 });
    return data<SaveActionData>({ intent, ok: true, redirectTo: `/${lang}/vendor/products` });
  }

  return data<SaveActionData>({ intent: "save", ok: false, error: "intent" }, { status: 400 });
}

export default function ProductWizardRoute({ loaderData }: Route.ComponentProps) {
  return (
    <ProductWizard
      uid={loaderData.uid}
      supabaseUrl={loaderData.supabaseUrl}
      media={loaderData.media}
      product={loaderData.product}
      template={loaderData.template}
      categories={loaderData.categories}
      brands={loaderData.brands}
      tags={loaderData.tags}
      variants={loaderData.variants}
      isAr={loaderData.lang === "ar"}
    />
  );
}


/** H-06: friendly route error page (500s log a CORERR id; 403/404 keep their message) */
export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonForm />;
}

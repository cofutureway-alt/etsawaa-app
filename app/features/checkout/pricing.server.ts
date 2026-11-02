import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Checkout pricing mirror (DISPLAY-ONLY).
 *
 * `fn_create_order` is the sole authority — it recomputes every price inside
 * the DB transaction. This module produces the same numbers for the checkout
 * UI (summary + COD reasons + coupon preview) so the customer never sees a
 * total the server would reject. Rules are the storefront's:
 * sale window → event discount → coupon (fn_apply_coupon) → one shipping fee
 * by governorate; COD blocked over the settings cap or on vendor-shipped items.
 */

export interface CheckoutLine {
  variant_id: string;
  product_id: string;
  vendor_id: string;
  leaf_category_id: string;
  brand_id: string | null;
  name_ar: string;
  name_en: string;
  slug_ar: string;
  slug_en: string;
  option_key: string;
  image_path: string | null;
  store_name_ar: string;
  store_name_en: string;
  qty: number;
  stock: number;
  unit_piastres: number;      // after sale + event (display price)
  regular_piastres: number;
  on_sale: boolean;
  shipping_mode: "platform" | "vendor";
  is_fragile: boolean;
  listable: boolean;          // false → blocked line with reason
}

export interface QuoteTotals {
  subtotal_piastres: number;
  discount_piastres: number;
  shipping_piastres: number;
  total_piastres: number;
  coupon: { code: string; ok: boolean; reason?: string };
  free_shipping: boolean;
}

export interface CodState {
  allowed: boolean;
  reason: "cap" | "vendor_ship" | null;
  cap_piastres: number;
}

export interface CheckoutQuote {
  lines: CheckoutLine[];
  blockedNames: string[];
  totals: QuoteTotals;
  cod: CodState;
  vendorCount: number;
}

interface EventRate { percent: number; max: number | null }

/** Live cart rows + the same pricing rules fn_create_order applies. */
export async function loadCheckoutQuote(
  client: SupabaseClient,
  userId: string,
  input: { governorateId: number | null; areaId: number | null; couponCode?: string | null },
): Promise<CheckoutQuote> {
  // 1) cart rows joined with sellability + shipping mode
  const { data: raw, error } = await client
    .from("cart_items")
    .select(`variant_id, qty,
             variants!inner(id, sku, option_key, price_piastres, sale_price_piastres, stock, image_path,
               products!inner(id, name_ar, name_en, slug_ar, slug_en, leaf_category_id, brand_id, vendor_id,
                 shipping_mode, is_fragile, status, deleted_at, sale_starts_at, sale_ends_at, event_hidden,
                 vendors!inner(id, status, verification_status, hidden_from_listings)))`)
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);

  type Row = {
    variant_id: string; qty: number;
    variants: {
      id: string; sku: string | null; option_key: string; price_piastres: number | null;
      sale_price_piastres: number | null; stock: number; image_path: string | null;
      products: {
        id: string; name_ar: string; name_en: string; slug_ar: string; slug_en: string;
        leaf_category_id: string; brand_id: string | null; vendor_id: string;
        shipping_mode: "platform" | "vendor"; is_fragile: boolean; status: string;
        deleted_at: string | null; sale_starts_at: string | null; sale_ends_at: string | null;
        event_hidden: boolean;
        vendors: { id: string; status: string; verification_status: string; hidden_from_listings: boolean };
      };
    };
  };
  const rows = (raw ?? []) as unknown as Row[];

  // vendor refusal → whole cart unlistable (same rule as the storefront)
  const vendorIds = [...new Set(rows.map((r) => r.variants.products.vendor_id))];
  const refused = new Set<string>();
  if (vendorIds.length > 0) {
    const { data: aev } = await client
      .from("v_active_event_vendors")
      .select("vendor_id, status")
      .in("vendor_id", vendorIds)
      .eq("status", "refused");
    for (const v of (aev ?? []) as Array<{ vendor_id: string }>) refused.add(v.vendor_id);
  }

  // 2) event rates for the vendors/categories/products involved (accepted only)
  const eventRate = new Map<string, EventRate>();
  if (vendorIds.length > 0) {
    const { data: disc } = await client
      .from("v_active_event_vendors")
      .select("vendor_id, event_id, status")
      .in("vendor_id", vendorIds)
      .eq("status", "accepted");
    const eventIds = [...new Set(((disc ?? []) as Array<{ event_id: string }>).map((d) => d.event_id))];
    if (eventIds.length > 0) {
      const { data: rates } = await client
        .from("event_discounts")
        .select("event_id, scope, ref_id, percent, max_discount_piastres")
        .in("event_id", eventIds);
      const acceptedVendorEvents = ((disc ?? []) as Array<{ vendor_id: string; event_id: string }>);
      for (const r of rows) {
        const p = r.variants.products;
        const candidates = ((rates ?? []) as Array<{ event_id: string; scope: string; ref_id: string; percent: number; max_discount_piastres: number | null }>)
          .filter((d) =>
            acceptedVendorEvents.some((a) => a.vendor_id === p.vendor_id && a.event_id === d.event_id) &&
            ((d.scope === "product" && d.ref_id === p.id) || (d.scope === "category" && d.ref_id === p.leaf_category_id)))
          .sort((a, b) => ((b.scope === "product" ? 1 : 0) - (a.scope === "product" ? 1 : 0)) || b.percent - a.percent);
        const best = candidates[0];
        if (best) eventRate.set(`${p.id}`, { percent: best.percent, max: best.max_discount_piastres });
      }
    }
  }

  // 3) display price per line (sale → event) + sellability
  const now = Date.now();
  const lines: CheckoutLine[] = [];
  const blockedNames: string[] = [];
  for (const r of rows) {
    const v = r.variants;
    const p = v.products;
    const saleActive =
      p.sale_starts_at !== null && new Date(p.sale_starts_at).getTime() <= now &&
      (p.sale_ends_at === null || new Date(p.sale_ends_at).getTime() > now) &&
      v.sale_price_piastres !== null;
    let unit = saleActive ? Math.min(v.price_piastres ?? 0, v.sale_price_piastres ?? 0) : (v.price_piastres ?? 0);
    const rate = eventRate.get(p.id);
    if (rate && rate.percent > 0) {
      unit = unit - Math.trunc((unit * rate.percent) / 100);
      if (rate.max !== null && unit < rate.max) unit = rate.max;
    }
    const listable =
      p.status === "approved" && p.deleted_at === null && !p.event_hidden &&
      p.vendors.status === "active" && p.vendors.verification_status !== "grace_expired" &&
      !p.vendors.hidden_from_listings && !refused.has(p.vendor_id) &&
      v.price_piastres !== null;
    const line: CheckoutLine = {
      variant_id: v.id, product_id: p.id, vendor_id: p.vendor_id,
      leaf_category_id: p.leaf_category_id, brand_id: p.brand_id,
      name_ar: p.name_ar, name_en: p.name_en, slug_ar: p.slug_ar, slug_en: p.slug_en,
      option_key: v.option_key, image_path: v.image_path,
      store_name_ar: "", store_name_en: "",
      qty: Math.min(r.qty, v.stock, 99), stock: v.stock,
      unit_piastres: unit, regular_piastres: v.price_piastres ?? 0,
      on_sale: unit < (v.price_piastres ?? 0),
      shipping_mode: p.shipping_mode, is_fragile: p.is_fragile,
      listable,
    };
    if (!listable) blockedNames.push(p.name_ar || p.name_en);
    lines.push(line);
  }

  const sellable = lines.filter((l) => l.listable);
  const subtotal = sellable.reduce((s, l) => s + l.unit_piastres * l.qty, 0);

  // store names via the storefront view (no vendors grant needed)
  if (vendorIds.length > 0) {
    const { data: stores } = await client
      .from("v_storefront_stores")
      .select("id, store_name_ar, store_name_en")
      .in("id", vendorIds);
    for (const s of (stores ?? []) as Array<{ id: string; store_name_ar: string; store_name_en: string }>) {
      for (const l of lines) {
        if (l.vendor_id === s.id) { l.store_name_ar = s.store_name_ar; l.store_name_en = s.store_name_en; }
      }
    }
  }

  // 4) shipping fee — one per order by governorate
  let shipping = 0;
  if (input.governorateId !== null) {
    const { data: gov } = await client
      .from("governorates")
      .select("shipping_fee_piastres, is_active")
      .eq("id", input.governorateId)
      .maybeSingle();
    if (gov?.is_active) shipping = gov.shipping_fee_piastres;
  }

  // 5) coupon via the shared engine
  let discount = 0;
  let freeShipping = false;
  let coupon: QuoteTotals["coupon"] = { code: "", ok: true };
  const code = input.couponCode?.trim() ?? "";
  if (code && sellable.length > 0) {
    const payload = sellable.map((l) => ({
      product_id: l.product_id, vendor_id: l.vendor_id,
      leaf_category_id: l.leaf_category_id, brand_id: l.brand_id,
      unit_price_piastres: l.unit_piastres, qty: l.qty, on_sale: l.on_sale,
    }));
    const { data: res, error: cerr } = await client.rpc("fn_apply_coupon", { p_code: code, p_lines: payload });
    if (cerr) coupon = { code, ok: false, reason: "invalid" };
    else {
      const r = res as { ok: boolean; reason?: string; discount_piastres?: number; free_shipping?: boolean };
      coupon = { code, ok: r.ok, reason: r.ok ? undefined : r.reason };
      if (r.ok) {
        discount = r.discount_piastres ?? 0;
        freeShipping = r.free_shipping ?? false;
      }
    }
  }
  if (freeShipping) shipping = 0;

  // 6) COD rules (display mirror of fn_create_order)
  const { data: capRow } = await client
    .from("settings")
    .select("value")
    .eq("key", "checkout")
    .maybeSingle();
  const cap = ((capRow?.value as { cod_max_total_piastres?: number } | null)?.cod_max_total_piastres) ?? 500000;
  const total = subtotal - discount + shipping;
  const vendorShip = sellable.some((l) => l.shipping_mode === "vendor");
  const cod: CodState = vendorShip
    ? { allowed: false, reason: "vendor_ship", cap_piastres: cap }
    : total > cap
      ? { allowed: false, reason: "cap", cap_piastres: cap }
      : { allowed: true, reason: null, cap_piastres: cap };

  return {
    lines,
    blockedNames,
    totals: {
      subtotal_piastres: subtotal,
      discount_piastres: discount,
      shipping_piastres: shipping,
      total_piastres: total,
      coupon,
      free_shipping: freeShipping,
    },
    cod,
    vendorCount: new Set(sellable.map((l) => l.vendor_id)).size,
  };
}

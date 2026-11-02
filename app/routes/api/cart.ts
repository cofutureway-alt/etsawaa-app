import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { getViewer } from "~/lib/auth/guards";
import type { CartLine } from "~/features/cart/api";

/**
 * POST /:lang/api/cart — the single cart resource (JOURNEYS §5).
 * Intents:
 *  - get     (auth)  → authoritative DB lines via fn_cart_get
 *  - peek    (any)   → live display data for guest lines, nothing persisted
 *  - add/set/remove (auth) → RPC mutations, capped at live stock
 *  - merge   (auth)  → guest lines combine into the DB cart (US-11)
 */

interface PeekRow {
  variant_id: string;
  product_id: string;
  sku: string | null;
  option_key: string;
  price_piastres: number | null;
  sale_price_piastres: number | null;
  stock: number;
  name_ar: string;
  name_en: string;
  slug_ar: string;
  slug_en: string;
  leaf_category_id: string;
  brand_id: string | null;
  vendor_id: string;
  store_name_ar: string;
  store_name_en: string;
  sale_starts_at: string | null;
  sale_ends_at: string | null;
  image_path: string | null;
}

export async function action({ request }: ActionFunctionArgs) {
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db_not_connected" }, { status: 503 });
  const { viewer } = (await getViewer(client)) ?? { viewer: null };

  const body = (await request.json().catch(() => null)) as
    | { intent?: string; variant_id?: string; product_id?: string; qty?: number; lines?: Array<{ variant_id: string; product_id?: string; qty?: number }> }
    | null;
  if (!body?.intent) return data({ ok: false, reason: "bad_request" }, { status: 400 });

  if (body.intent === "peek") {
    const ids = (body.lines ?? [])
      .map((l) => l.variant_id)
      .filter((id): id is string => typeof id === "string")
      .slice(0, 40);
    if (ids.length === 0) return data({ ok: true, lines: [], notices: [] });
    // anon RLS on variants/products guarantees ONLY public purchasable rows.
    // store names come from v_storefront_stores (vendors has no anon grant —
    // a vendors() embed would 500 for guests)
    const { data: rows, error } = await client
      .from("variants")
      .select(`id, product_id, sku, option_key, price_piastres, sale_price_piastres, stock,
               products!inner(id, name_ar, name_en, slug_ar, slug_en, leaf_category_id, brand_id, vendor_id, sale_starts_at, sale_ends_at,
                 product_media(path, kind, position))`)
      .in("id", ids)
      .is("deleted_at", null)
      .eq("is_active", true);
    if (error) {
      console.error("[api/cart peek]", error.message, error.details ?? "", error.hint ?? "");
      return data({ ok: false, reason: "query_failed" }, { status: 500 });
    }
    const vendorIds = [...new Set(((rows ?? []) as Array<{ products: { vendor_id: string } }>).map((r) => r.products.vendor_id))];
    const storeNames = new Map<string, { ar: string; en: string }>();
    if (vendorIds.length > 0) {
      const { data: stores } = await client.from("v_storefront_stores").select("id, store_name_ar, store_name_en").in("id", vendorIds);
      for (const s of (stores ?? []) as Array<{ id: string; store_name_ar: string; store_name_en: string }>) {
        storeNames.set(s.id, { ar: s.store_name_ar, en: s.store_name_en });
      }
    }
    const lines: CartLine[] = ((rows ?? []) as unknown[]).map((raw) => {
      const row = raw as unknown as {
        id: string; product_id: string; sku: string | null; option_key: string;
        price_piastres: number | null; sale_price_piastres: number | null; stock: number;
        products: {
          id: string; name_ar: string; name_en: string; slug_ar: string; slug_en: string;
          leaf_category_id: string; brand_id: string | null; vendor_id: string;
          sale_starts_at: string | null; sale_ends_at: string | null;
          product_media: Array<{ path: string; kind: string; position: number }> | null;
        };
      };
      const p = row.products;
      const onSale =
        p.sale_starts_at !== null && new Date(p.sale_starts_at).getTime() <= Date.now() &&
        (p.sale_ends_at === null || new Date(p.sale_ends_at).getTime() > Date.now()) &&
        row.sale_price_piastres !== null;
      const img = (p.product_media ?? []).filter((m) => m.kind === "image").sort((a, b) => a.position - b.position)[0];
      const requested = (body.lines ?? []).find((l) => l.variant_id === row.id);
      return {
        variant_id: row.id,
        product_id: p.id,
        qty: Math.min(Math.max(1, requested?.qty ?? 1), row.stock, 99),
        vendor_id: p.vendor_id,
        leaf_category_id: p.leaf_category_id,
        brand_id: p.brand_id,
        stock: row.stock,
        sku: row.sku,
        option_key: row.option_key,
        price_piastres: onSale ? (row.sale_price_piastres ?? row.price_piastres ?? 0) : (row.price_piastres ?? 0),
        regular_price_piastres: row.price_piastres ?? 0,
        on_sale: onSale,
        name_ar: p.name_ar,
        name_en: p.name_en,
        slug_ar: p.slug_ar,
        slug_en: p.slug_en,
        image_path: img?.path ?? null,
        store_name_ar: storeNames.get(p.vendor_id)?.ar ?? "",
        store_name_en: storeNames.get(p.vendor_id)?.en ?? "",
        capped: (requested?.qty ?? 1) > row.stock,
      };
    });
    const found = new Set(lines.map((l) => l.variant_id));
    const notices = ids.filter((id) => !found.has(id)).map((variant_id) => ({ variant_id, key: "unavailable" }));
    return data({ ok: true, lines, notices });
  }

  // everything below requires a session
  if (!viewer) return data({ ok: false, reason: "unauthenticated" }, { status: 401 });

  if (body.intent === "get") {
    const { data: lines, error } = await client.rpc("fn_cart_get");
    if (error) return data({ ok: false, reason: "query_failed" }, { status: 500 });
    return data({ ok: true, lines: lines ?? [] });
  }

  if (body.intent === "add") {
    if (!body.variant_id || !body.product_id || !body.qty || body.qty < 1) {
      return data({ ok: false, reason: "bad_request" }, { status: 400 });
    }
    const { data: res, error } = await client.rpc("fn_cart_add", { p_variant_id: body.variant_id, p_qty: Math.min(body.qty, 99) });
    if (error) {
      const reason = error.message.includes("out_of_stock") ? "out_of_stock"
        : error.message.includes("variant_unavailable") ? "unavailable"
        : "query_failed";
      return data({ ok: false, reason }, { status: reason === "query_failed" ? 500 : 400 });
    }
    const { data: lines } = await client.rpc("fn_cart_get");
    return data({ ok: true, ...(res as { qty: number; stock: number; capped: boolean }), lines: lines ?? [] });
  }

  if (body.intent === "set") {
    if (!body.variant_id || typeof body.qty !== "number") {
      return data({ ok: false, reason: "bad_request" }, { status: 400 });
    }
    const { data: res, error } = await client.rpc("fn_cart_set_qty", { p_variant_id: body.variant_id, p_qty: Math.min(Math.round(body.qty ?? 0), 99) });
    if (error) return data({ ok: false, reason: "query_failed" }, { status: 500 });
    const { data: lines } = await client.rpc("fn_cart_get");
    return data({ ok: true, ...(res as { removed?: boolean }), lines: lines ?? [] });
  }

  if (body.intent === "remove") {
    if (!body.variant_id) return data({ ok: false, reason: "bad_request" }, { status: 400 });
    const { error } = await client.rpc("fn_cart_remove", { p_variant_id: body.variant_id });
    if (error) return data({ ok: false, reason: "query_failed" }, { status: 500 });
    const { data: lines } = await client.rpc("fn_cart_get");
    return data({ ok: true, lines: lines ?? [] });
  }

  if (body.intent === "merge") {
    const lines = (body.lines ?? [])
      .filter((l) => typeof l?.variant_id === "string" && typeof l?.qty === "number" && l.qty >= 1)
      .map((l) => ({ variant_id: l.variant_id as string, qty: Math.min(Math.round(l.qty as number), 99) }));
    const { data: res, error } = await client.rpc("fn_cart_merge", { p_lines: lines });
    if (error) return data({ ok: false, reason: "query_failed" }, { status: 500 });
    const merged = res as { lines: CartLine[]; notices: Array<{ variant_id: string; key: string }> };
    return data({ ok: true, lines: merged.lines, notices: merged.notices });
  }

  return data({ ok: false, reason: "bad_request" }, { status: 400 });
}

// exported for the type check above (peek row shape)
export type { PeekRow };

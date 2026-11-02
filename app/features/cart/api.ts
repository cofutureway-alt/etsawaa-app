/**
 * Cart client API — one resource route (`/api/cart`) backed by definer RPCs.
 * Guests never hit the DB cart; they use localStorage (JOURNEYS §5) and the
 * `peek` intent resolves live display data without persisting anything.
 */

export interface CartLine {
  variant_id: string;
  product_id: string;
  qty: number;
  vendor_id?: string;
  leaf_category_id?: string;
  brand_id?: string | null;
  stock?: number;
  sku?: string | null;
  option_key?: string;
  price_piastres?: number;
  regular_price_piastres?: number;
  on_sale?: boolean;
  name_ar?: string;
  name_en?: string;
  slug_ar?: string;
  slug_en?: string;
  image_path?: string | null;
  store_name_ar?: string;
  store_name_en?: string;
  capped?: boolean;
}

export interface CartLineInput {
  variant_id: string;
  product_id: string;
  qty: number;
}

async function post(body: Record<string, unknown>): Promise<{ ok: boolean; lines?: CartLine[]; reason?: string; notices?: Array<{ variant_id: string; key: string }>; added?: boolean; qty?: number; stock?: number; capped?: boolean; removed?: boolean }> {
  const res = await fetch("/api/cart", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as Awaited<ReturnType<typeof post>>;
}

/** Live display data for guest lines — never persists. */
export async function peekLines(lines: CartLineInput[]): Promise<{ lines: CartLine[]; unavailable: string[] }> {
  const res = await post({ intent: "peek", lines });
  return { lines: res.lines ?? [], unavailable: res.notices?.map((n) => n.variant_id) ?? [] };
}

export async function fetchCart(): Promise<CartLine[]> {
  const res = await post({ intent: "get" });
  return res.lines ?? [];
}

export async function apiAdd(variantId: string, productId: string, qty: number): Promise<{ ok: boolean; reason?: string; qty?: number; stock?: number; capped?: boolean; lines?: CartLine[] }> {
  const res = await post({ intent: "add", variant_id: variantId, product_id: productId, qty });
  return { ok: res.ok, reason: res.reason, qty: res.qty, stock: res.stock, capped: res.capped, lines: res.lines };
}

export async function apiSetQty(variantId: string, qty: number): Promise<{ ok: boolean; lines?: CartLine[]; reason?: string }> {
  const res = await post({ intent: "set", variant_id: variantId, qty });
  return { ok: res.ok, lines: res.lines, reason: res.reason };
}

export async function apiRemove(variantId: string): Promise<{ ok: boolean; lines?: CartLine[] }> {
  const res = await post({ intent: "remove", variant_id: variantId });
  return { ok: res.ok, lines: res.lines };
}

/** Guest cart merge on sign-in (JOURNEYS §5 / US-11). */
export async function apiMergeCart(lines: CartLineInput[]): Promise<{ lines: CartLine[]; notices: Array<{ variant_id: string; key: string }> }> {
  const res = await post({ intent: "merge", lines });
  return { lines: res.lines ?? [], notices: res.notices ?? [] };
}

export interface CouponResult {
  ok: boolean;
  reason?: string;
  discount_piastres?: number;
  free_shipping?: boolean;
}

export async function applyCoupon(code: string, lines: CartLine[]): Promise<CouponResult> {
  const payload = lines.map((line) => ({
    product_id: line.product_id,
    vendor_id: line.vendor_id ?? null,
    leaf_category_id: line.leaf_category_id ?? null,
    brand_id: line.brand_id ?? null,
    unit_price_piastres: line.price_piastres ?? 0,
    qty: line.qty,
    on_sale: line.on_sale ?? false,
  }));
  const res = await fetch("/api/coupon", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, lines: payload }),
  });
  return (await res.json()) as CouponResult;
}

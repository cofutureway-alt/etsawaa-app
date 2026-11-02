import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Order reads (all RLS-scoped by the caller's client — customers see only
 * their own orders, vendors only their groups, admins everything).
 */

export interface OrderRow {
  id: string;
  number: string;
  status: "pending_payment" | "processing" | "on_hold" | "completed" | "cancelled";
  payment_method: "kashier" | "cod";
  payment_status: "unpaid" | "paid" | "cod_pending" | "cod_collected";
  email: string;
  phone_primary: string;
  phone_alternate: string;
  ship_name: string;
  governorate_id: number;
  area_id: number;
  address1: string;
  address2: string | null;
  postal_code: string | null;
  subtotal_piastres: number;
  discount_piastres: number;
  shipping_fee_piastres: number;
  total_piastres: number;
  coupon_code: string | null;
  delivered_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  /** L-20 delivery pin — ADMIN/CARRIER only; never selected for vendor snapshots */
  shipping_lat?: number | null;
  shipping_lng?: number | null;
  shipping_geo_accuracy_m?: number | null;
}

export interface GroupRow {
  id: string;
  vendor_id: string;
  status: "pending" | "preparing" | "on_hold" | "handed_to_carrier" | "out_for_delivery" | "delivered" | "cancelled";
  shipping_mode: "platform" | "vendor";
  vendor_ship_status: "not_required" | "pending_admin" | "approved" | "rejected";
  items_subtotal_piastres: number;
  discount_piastres: number;
  commission_piastres: number;
  shipped_at: string | null;
  delivered_at: string | null;
  cancel_reason: string | null;
  vendor: { store_name_ar: string; store_name_en: string; slug: string };
}

export interface ItemRow {
  id: string;
  group_id: string;
  product_id: string;
  variant_id: string;
  product_name_ar: string;
  product_name_en: string;
  option_key: string;
  sku: string | null;
  image_path: string | null;
  unit_price_piastres: number;
  qty: number;
  line_total_piastres: number;
  coupon_discount_piastres: number;
  commission_piastres: number;
  commission_rate_bps: number;
  is_fragile: boolean;
  leaf_category_id: string;
}

export interface HistoryRow {
  id: string;
  group_id: string | null;
  status: string;
  note: string;
  created_at: string;
}

const ORDER_SELECT = "*";

export async function getOwnOrder(client: SupabaseClient, number: string): Promise<OrderRow | null> {
  const { data } = await client
    .from("orders")
    .select(ORDER_SELECT)
    .eq("number", decodeURIComponent(number))
    .maybeSingle();
  return (data as OrderRow) ?? null;
}

export async function listOwnOrders(
  client: SupabaseClient,
  filter: "all" | "active" | "completed" | "cancelled",
  limit = 30,
): Promise<OrderRow[]> {
  let q = client.from("orders").select(ORDER_SELECT).order("created_at", { ascending: false }).limit(limit);
  if (filter === "active") q = q.in("status", ["pending_payment", "processing", "on_hold"]);
  else if (filter === "completed") q = q.eq("status", "completed");
  else if (filter === "cancelled") q = q.eq("status", "cancelled");
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as OrderRow[];
}

/** Groups + items + history for one order the caller can read (RLS enforces). */
export async function getOrderParts(client: SupabaseClient, orderId: string): Promise<{
  groups: GroupRow[];
  items: ItemRow[];
  history: HistoryRow[];
}> {
  const [groupsRes, itemsRes, historyRes] = await Promise.all([
    // no vendors() embed — customers have no SELECT on vendors (phase-04
    // lesson); store names resolve through the public storefront view below
    client.from("order_vendor_groups").select("*").eq("order_id", orderId).order("created_at"),
    client.from("order_items").select("*").eq("order_id", orderId).order("created_at"),
    client.from("order_status_history").select("id, group_id, status, note, created_at").eq("order_id", orderId).order("created_at"),
  ]);
  const groups = (groupsRes.data ?? []) as unknown as GroupRow[];
  const vendorIds = [...new Set(groups.map((g) => g.vendor_id))];
  if (vendorIds.length > 0) {
    const { data: stores } = await client
      .from("v_storefront_stores")
      .select("id, store_name_ar, store_name_en, slug")
      .in("id", vendorIds);
    const byId = new Map(((stores ?? []) as Array<{ id: string; store_name_ar: string; store_name_en: string; slug: string }>).map((st) => [st.id, st]));
    for (const g of groups) {
      const st = byId.get(g.vendor_id);
      g.vendor = st ?? { store_name_ar: "", store_name_en: "", slug: "" };
    }
  }
  return {
    groups,
    items: (itemsRes.data ?? []) as unknown as ItemRow[],
    history: (historyRes.data ?? []) as HistoryRow[],
  };
}

export async function getGeoNames(client: SupabaseClient, governorateId: number, areaId: number): Promise<{
  governorate: { name_ar: string; name_en: string } | null;
  area: { name_ar: string; name_en: string } | null;
}> {
  const [g, a] = await Promise.all([
    client.from("governorates").select("name_ar, name_en").eq("id", governorateId).maybeSingle(),
    client.from("areas").select("name_ar, name_en").eq("id", areaId).maybeSingle(),
  ]);
  return {
    governorate: (g.data as { name_ar: string; name_en: string } | null),
    area: (a.data as { name_ar: string; name_en: string } | null),
  };
}

/** Customer-view reorder payload: live availability for every ordered line. */
export async function getReorderLines(client: SupabaseClient, orderId: string): Promise<Array<{
  item: ItemRow;
  variantLive: boolean;
  stock: number;
  priceNow: number | null;
}>> {
  const { data: items } = await client.from("order_items").select("*").eq("order_id", orderId);
  const rows = (items ?? []) as unknown as ItemRow[];
  if (rows.length === 0) return [];
  const variantIds = [...new Set(rows.map((r) => r.variant_id))];
  const { data: variants } = await client
    .from("variants")
    .select("id, stock, is_active, deleted_at, price_piastres, sale_price_piastres, products(status, deleted_at)")
    .in("id", variantIds);
  const live = new Map(((variants ?? []) as unknown as Array<{
    id: string; stock: number; is_active: boolean; deleted_at: string | null;
    price_piastres: number | null; sale_price_piastres: number | null;
    products: { status: string; deleted_at: string | null };
  }>).map((v) => [v.id, v]));
  return rows.map((item) => {
    const v = live.get(item.variant_id);
    const variantLive =
      Boolean(v) && v!.is_active && v!.deleted_at === null &&
      v!.products.status === "approved" && v!.products.deleted_at === null;
    return {
      item,
      variantLive,
      stock: v?.stock ?? 0,
      priceNow: v ? (v.sale_price_piastres ?? v.price_piastres) : null,
    };
  });
}

/* ---------------- refunds ---------------- */

export interface RefundRequestRow {
  id: string;
  order_id: string;
  kind: "return" | "warranty";
  description: string;
  evidence: string[];
  status: "pending_admin" | "approved" | "rejected" | "refunded" | "closed";
  decision_note: string | null;
  created_at: string;
  order?: { number: string };
}

export async function listRefundRequests(client: SupabaseClient, limit = 30): Promise<RefundRequestRow[]> {
  const { data, error } = await client
    .from("refund_requests")
    .select("*, order:orders(number)")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as Array<RefundRequestRow & { order: { number: string } | null }>)
    .map((r) => ({ ...r, order: r.order ?? undefined }));
}

/** Quantities already requested per order item (partial-remainder rule). */
export async function requestedQtyByItem(client: SupabaseClient, orderItemIds: string[]): Promise<Map<string, number>> {
  if (orderItemIds.length === 0) return new Map();
  const { data } = await client
    .from("refund_request_items")
    .select("order_item_id, qty")
    .in("order_item_id", orderItemIds);
  const map = new Map<string, number>();
  for (const row of ((data ?? []) as Array<{ order_item_id: string; qty: number }>)) {
    map.set(row.order_item_id, (map.get(row.order_item_id) ?? 0) + row.qty);
  }
  return map;
}

/* ---------------- reviews ---------------- */

export interface ReviewRow {
  id: string;
  product_id: string;
  rating: number;
  title: string;
  body: string;
  status: "pending" | "published" | "spam" | "trash";
  created_at: string;
  product: { name_ar: string; name_en: string; slug_ar: string; slug_en: string };
}

export async function listOwnReviews(client: SupabaseClient, limit = 50): Promise<ReviewRow[]> {
  const { data, error } = await client
    .from("reviews")
    .select("id, product_id, rating, title, body, status, created_at, product:products(name_ar, name_en, slug_ar, slug_en)")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as Array<ReviewRow & { product: ReviewRow["product"] | null }>)
    .map((r) => ({ ...r, product: r.product ?? undefined as unknown as ReviewRow["product"] }));
}

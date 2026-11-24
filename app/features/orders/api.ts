import type { SupabaseClient } from "@supabase/supabase-js";
import { asRow, asRows } from "~/lib/supabase/typed";
import type { ReviewMediaItem } from "~/lib/review-media";

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
  /** Kashier mode — "test" orders are sandbox payments kept out of wallets and billing */
  payment_mode?: "live" | "test";
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
  /** readable options ("أسود · M · 8 جيجا"), from the key */
  option_label_ar?: string | null;
  option_label_en?: string | null;
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

export const ORDER_SELECT = "*";

export async function getOwnOrder(client: SupabaseClient, number: string): Promise<OrderRow | null> {
  const { data } = await client
    .from("orders")
    .select(ORDER_SELECT)
    .eq("number", decodeURIComponent(number))
    .maybeSingle();
  return asRow<OrderRow>(data);
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
  return asRows<OrderRow>(data);
}

const ORDER_GROUP_COLUMNS = "id, order_id, vendor_id, status, shipping_mode, vendor_ship_status, items_subtotal_piastres, discount_piastres, commission_piastres, cancel_reason, shipped_at, delivered_at, cancelled_at, created_at";
const ORDER_ITEM_COLUMNS = "id, order_id, group_id, vendor_id, variant_id, product_id, leaf_category_id, product_name_ar, product_name_en, option_key, option_label_ar, option_label_en, sku, image_path, unit_price_piastres, qty, line_total_piastres, coupon_discount_piastres, commission_piastres, commission_rate_bps, is_fragile, created_at";

/** Groups + items + history for one order the caller can read (RLS enforces). */
export async function getOrderParts(client: SupabaseClient, orderId: string): Promise<{
  groups: GroupRow[];
  items: ItemRow[];
  history: HistoryRow[];
}> {
  const [groupsRes, itemsRes, historyRes] = await Promise.all([
    // no vendors() embed — customers have no SELECT on vendors (phase-04
    // lesson); store names resolve through the public storefront view below
    client.from("order_vendor_groups").select(ORDER_GROUP_COLUMNS).eq("order_id", orderId).order("created_at"),
    client.from("order_items").select(ORDER_ITEM_COLUMNS).eq("order_id", orderId).order("created_at"),
    client.from("order_status_history").select("id, group_id, status, note, created_at").eq("order_id", orderId).order("created_at"),
  ]);
  const groups = asRows<GroupRow>(groupsRes.data);
  const vendorIds = [...new Set(groups.map((g) => g.vendor_id))];
  if (vendorIds.length > 0) {
    const { data: stores } = await client
      .from("v_storefront_stores")
      .select("id, store_name_ar, store_name_en, slug")
      .in("id", vendorIds);
    const byId = new Map(asRows<{ id: string; store_name_ar: string; store_name_en: string; slug: string }>(stores).map((st) => [st.id, st]));
    for (const g of groups) {
      const st = byId.get(g.vendor_id);
      g.vendor = st ?? { store_name_ar: "", store_name_en: "", slug: "" };
    }
  }
  return {
    groups,
    items: asRows<ItemRow>(itemsRes.data),
    history: asRows<HistoryRow>(historyRes.data),
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
    governorate: asRow<{ name_ar: string; name_en: string }>(g.data),
    area: asRow<{ name_ar: string; name_en: string }>(a.data),
  };
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
  return asRows<RefundRequestRow & { order: { number: string } | null }>(data)
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
  for (const row of asRows<{ order_item_id: string; qty: number }>(data)) {
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
  media?: ReviewMediaItem[] | null;
  product: { name_ar: string; name_en: string; slug_ar: string; slug_en: string };
}

export async function listOwnReviews(client: SupabaseClient, limit = 50): Promise<ReviewRow[]> {
  const { data, error } = await client
    .from("reviews")
    .select("id, product_id, rating, title, body, status, created_at, media, product:products(name_ar, name_en, slug_ar, slug_en)")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  // the products join comes back null when the product was hard-deleted;
  // consumers treat it as absent, so keep undefined without inventing a row
  return asRows<ReviewRow & { product: ReviewRow["product"] | null }>(data)
    .map((r) => ({ ...r, product: (r.product ?? undefined) as ReviewRow["product"] }));
}

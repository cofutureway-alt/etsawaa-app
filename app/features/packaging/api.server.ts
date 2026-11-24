import type { SupabaseClient } from "@supabase/supabase-js";
import type { PackagingOrderDoc } from "./documents.server";

/**
 * Packaging order with everything its pages and documents need. Reads go
 * through the caller's own client, so RLS decides: an admin sees any order,
 * a seller only their own (anything else → null → 404).
 */

export interface PackagingReturnRow {
  id: string; number: string; source: string; status: string; reason: string; admin_note: string | null;
  refund_piastres: number; refund_method: string | null; refund_reference: string | null;
  balance_offset_piastres: number; created_at: string;
  items: Array<{ order_item_id: string; qty: number }>;
}
export interface PackagingEventRow { id: string; event: string; note: string | null; return_id: string | null; created_at: string }
export interface PackagingOrderFull extends PackagingOrderDoc {
  id: string;
  /** Kashier mode the order is paid in — "test" orders never touch money totals */
  payment_mode: "live" | "test";
  vendor_id: string;
  notes: string;
  cancel_reason: string | null;
  delivered_at: string | null;
  items: Array<PackagingOrderDoc["items"][number] & { id: string; item_id: string; base_qty: number }>;
  balance: { id: string; status: string; amount_piastres: number; original_piastres: number; collected_at: string | null; note: string | null } | null;
  returns: PackagingReturnRow[];
  events: PackagingEventRow[];
}

export async function getPackagingOrder(client: SupabaseClient, number: string): Promise<PackagingOrderFull | null> {
  const { data: o } = await client
    .from("packaging_orders")
    .select(`id, number, vendor_id, status, payment_plan, payment_method, payment_status, payment_mode, subtotal_piastres, shipping_fee_piastres,
             total_piastres, deposit_piastres, paid_piastres, refunded_piastres, ship_name, ship_phone, ship_address, carrier,
             tracking_number, notes, cancel_reason, delivered_at, created_at, vendors(store_name_ar, store_name_en)`)
    .eq("number", number)
    .maybeSingle();
  if (!o) return null;
  const row = o as unknown as Record<string, unknown>;
  const id = row.id as string;
  const [items, payments, balance, returns, events] = await Promise.all([
    client.from("packaging_order_items").select("id, item_id, sku, name_ar, name_en, unit, qty, base_qty, unit_price_piastres, line_total_piastres").eq("order_id", id).order("sku"),
    client.from("packaging_payments").select("kind, method, amount_piastres, status, created_at, provider_ref, failure_reason").eq("order_id", id).order("created_at"),
    client.from("packaging_balances").select("id, status, amount_piastres, original_piastres, collected_at, note").eq("order_id", id).maybeSingle(),
    client.from("packaging_returns").select("id, number, source, status, reason, admin_note, refund_piastres, refund_method, refund_reference, balance_offset_piastres, created_at, packaging_return_items(order_item_id, qty)").eq("order_id", id).order("created_at", { ascending: false }),
    client.from("packaging_events").select("id, event, note, return_id, created_at").eq("order_id", id).order("created_at"),
  ]);
  const vendor = row.vendors as { store_name_ar: string; store_name_en: string } | null;
  const bal = balance.data as PackagingOrderFull["balance"];
  return {
    ...(row as unknown as PackagingOrderFull),
    store_name: vendor?.store_name_ar || vendor?.store_name_en || "",
    items: (items.data ?? []) as PackagingOrderFull["items"],
    payments: (payments.data ?? []) as PackagingOrderFull["payments"],
    balance: bal,
    open_balance_piastres: bal && bal.status === "open" ? bal.amount_piastres : 0,
    returns: ((returns.data ?? []) as unknown as Array<Record<string, unknown>>).map((r) => ({
      ...(r as unknown as PackagingReturnRow),
      items: (r.packaging_return_items ?? []) as PackagingReturnRow["items"],
    })),
    events: (events.data ?? []) as PackagingEventRow[],
  };
}

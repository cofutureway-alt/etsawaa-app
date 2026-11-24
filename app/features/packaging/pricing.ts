/**
 * Packaging pricing — mirrors fn_vendor_place_packaging_order (the server is
 * the authority; this drives the cart preview).
 * Stock is kept in BASE units: pieces, or metres for rolls. A roll consumes
 * roll_length_m metres; a metre purchase consumes one metre.
 */
export type PackagingUnit = "piece" | "roll" | "meter";

export interface PackagingItem {
  id: string;
  unit: "piece" | "roll";
  roll_length_m: number | null;
  price_piastres: number;
  meter_price_piastres: number | null;
  stock_base: number;
  min_qty: number;
  max_qty: number | null;
}

export function unitsFor(item: PackagingItem): PackagingUnit[] {
  if (item.unit === "piece") return ["piece"];
  return item.meter_price_piastres ? ["roll", "meter"] : ["roll"];
}

export function unitPrice(item: PackagingItem, unit: PackagingUnit): number | null {
  if (unit === "meter") return item.meter_price_piastres;
  if (unit !== item.unit) return null;
  return item.price_piastres;
}

export function baseQty(item: PackagingItem, unit: PackagingUnit, qty: number): number {
  return unit === "roll" ? qty * (item.roll_length_m ?? 0) : qty;
}

/** How many of `unit` are in stock. */
export function availableQty(item: PackagingItem, unit: PackagingUnit): number {
  if (unit === "roll") return item.roll_length_m ? Math.floor(item.stock_base / item.roll_length_m) : 0;
  return item.stock_base;
}

export function lineError(item: PackagingItem, unit: PackagingUnit, qty: number, baseInCart = 0): string | null {
  if (!Number.isInteger(qty) || qty <= 0) return "bad_qty";
  if (unitPrice(item, unit) === null) return "bad_unit";
  if (unit !== "meter" && (qty < item.min_qty || (item.max_qty !== null && qty > item.max_qty))) return "qty_out_of_range";
  if (baseInCart + baseQty(item, unit, qty) > item.stock_base) return "out_of_stock";
  return null;
}

export function orderTotals(subtotal: number, shipping: number, plan: "full" | "split", splitPercent: number) {
  const total = subtotal + shipping;
  const deposit = plan === "split" ? Math.ceil((total * splitPercent) / 100) : 0;
  return { subtotal, shipping, total, deposit, dueNow: plan === "split" ? deposit : total, later: plan === "split" ? total - deposit : 0 };
}

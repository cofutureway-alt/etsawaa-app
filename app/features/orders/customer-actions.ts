/**
 * What a customer can still do with an order, shared by the orders list and
 * the order page: finish an unpaid card payment (retry on the SAME order at
 * /order/:number) and ask for a return (14 days from delivery) or a warranty
 * claim (30 days).
 */
const DAY = 86_400_000;
export const RETURN_DAYS = 14;
export const WARRANTY_DAYS = 30;

export interface CustomerOrderLike {
  status: string;
  payment_method: string;
  payment_status: string;
  delivered_at: string | null;
}

export function canCompletePayment(o: CustomerOrderLike): boolean {
  return o.payment_method === "kashier" && o.payment_status === "unpaid" && o.status !== "cancelled";
}

/** "return" inside 14 days of delivery, "warranty" up to 30 days, else null. */
export function afterSaleKind(o: CustomerOrderLike, now = Date.now()): "return" | "warranty" | null {
  if (!o.delivered_at) return null;
  const age = now - new Date(o.delivered_at).getTime();
  if (age < RETURN_DAYS * DAY) return "return";
  if (age < WARRANTY_DAYS * DAY) return "warranty";
  return null;
}

/** Order date as day/month/year in Cairo time, without the invisible RTL marks Arabic dates carry. */
export function orderDate(iso: string, en: boolean): string {
  return new Date(iso)
    .toLocaleDateString(en ? "en-GB" : "ar-EG-u-nu-latn", { timeZone: "Africa/Cairo", day: "numeric", month: "numeric", year: "numeric" })
    .replace(/[\u200e\u200f\u061c]/g, "");
}

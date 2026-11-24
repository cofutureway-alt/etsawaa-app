/**
 * Refund preview math — mirrors fn_refund_line_state / fn_refund_apply on the
 * server (which recomputes and caps everything; these numbers are a preview).
 *
 * buyer_net   = what the buyer paid for the whole line (line total − coupon share)
 * amount_left = buyer_net − already refunded on this line
 * A return of q units refunds round(buyer_net × q / qty), and the last units
 * of a line take exactly what is left, so rounding never leaves a remainder.
 */
export interface LineState {
  qty: number;
  qty_returned: number;
  qty_left: number;
  buyer_net: number;
  amount_refunded: number;
  amount_left: number;
  vendor_net: number;
  commission: number;
}

export function lineRefund(state: LineState, qty: number): number {
  if (qty <= 0 || state.qty <= 0 || qty > state.qty_left) return 0;
  if (qty === state.qty_left) return state.amount_left;
  return Math.min(Math.round((state.buyer_net * qty) / state.qty), state.amount_left);
}

/** Vendor's wallet debit for a refund of `amount` on a line (vendor fault → the whole refund). */
export function vendorDebit(state: LineState, amount: number, vendorFault: boolean): number {
  const normal = state.buyer_net > 0 ? Math.round((state.vendor_net * amount) / state.buyer_net) : 0;
  return vendorFault ? Math.max(amount, normal) : normal;
}

export function refundTotals(lineAmounts: number[], shipping: number, shippingLeft: number, deduction: number) {
  const items = lineAmounts.reduce((s, a) => s + a, 0);
  const ship = lineAmounts.length === 0 ? 0 : Math.min(Math.max(shipping, 0), shippingLeft);
  const ded = Math.min(Math.max(deduction, 0), items + ship);
  return { items, shipping: ship, deduction: ded, total: items + ship - ded };
}

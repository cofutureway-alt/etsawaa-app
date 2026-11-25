/**
 * Customer wallet split math (Phase A) — pure functions, no React.
 *
 * The database stays the authority (fn_wallet_spend locks the rows and caps
 * the request); these helpers only drive the checkout preview and its tests.
 */

export interface WalletGiftLot {
  id: string;
  remaining_piastres: number;
  expires_at: string;
}

export interface WalletBalances {
  refund_piastres: number;
  gift_piastres: number;
}

const int = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};

/** What the customer can spend right now (both buckets). */
export function walletAvailable(wallet: WalletBalances | null | undefined): number {
  if (!wallet) return 0;
  return Math.max(0, int(wallet.refund_piastres)) + Math.max(0, int(wallet.gift_piastres));
}

/**
 * The wallet part of an order: what the customer asked for, capped by the
 * balance and by the order total. Anything unusable spends nothing.
 */
export function walletCap(requested: number, available: number, total: number): number {
  const ask = int(requested);
  const bal = Math.max(0, int(available));
  const cap = Math.max(0, int(total));
  if (ask <= 0 || bal <= 0 || cap <= 0) return 0;
  return Math.min(ask, bal, cap);
}

/** The amount left for the card / cash on delivery. */
export function walletRemainder(total: number, walletPart: number): number {
  return Math.max(0, Math.max(0, int(total)) - Math.max(0, int(walletPart)));
}

/** True when the wallet pays the whole order (the method choice is hidden). */
export function walletCoversAll(total: number, walletPart: number): boolean {
  const t = int(total);
  return t > 0 && int(walletPart) >= t;
}

export interface WalletAllocation {
  /** per gift lot, in the order the server spends them */
  lots: Array<{ id: string; amount_piastres: number }>;
  gift_piastres: number;
  refund_piastres: number;
}

/**
 * Mirrors fn_wallet_spend: eligible lots (a balance left, not past the date)
 * in earliest-expiry order, then the refund bucket.
 */
export function allocateWallet(
  amount: number,
  lots: readonly WalletGiftLot[],
  refundPiastres: number,
  now: number = Date.now(),
): WalletAllocation {
  let left = Math.max(0, int(amount));
  const out: WalletAllocation = { lots: [], gift_piastres: 0, refund_piastres: 0 };
  if (left === 0) return out;
  const eligible = lots
    .filter((l) => int(l.remaining_piastres) > 0 && Date.parse(l.expires_at) > now)
    .slice()
    .sort((a, b) => Date.parse(a.expires_at) - Date.parse(b.expires_at) || a.id.localeCompare(b.id));
  for (const lot of eligible) {
    if (left === 0) break;
    const take = Math.min(left, int(lot.remaining_piastres));
    out.lots.push({ id: lot.id, amount_piastres: take });
    out.gift_piastres += take;
    left -= take;
  }
  if (left > 0) {
    const fromRefund = Math.min(left, Math.max(0, int(refundPiastres)));
    out.refund_piastres = fromRefund;
  }
  return out;
}

/** The nearest active expiry, for "the gift part expires on …". */
export function nearestExpiry(lots: readonly WalletGiftLot[], now: number = Date.now()): string | null {
  const upcoming = lots
    .filter((l) => int(l.remaining_piastres) > 0 && Date.parse(l.expires_at) > now)
    .map((l) => l.expires_at)
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  return upcoming[0] ?? null;
}

/** Reasons the database writes on automatic movements: codes, not text for people to read. */
export const SYSTEM_REASONS = new Set(["order_payment", "order_cancelled", "order_cancelled_admin", "expired", "refund"]);

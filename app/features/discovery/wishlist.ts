/**
 * Wishlist client helpers (S-13 / US-12): heart toggle on cards/product.
 * Guests are prompted to sign in; the intended product is stashed and saved
 * automatically right after sign-in (CartProvider merge pass).
 */

const WISH_PENDING_KEY = "etsawaa.wish.pending.v1";

export function stashPendingWishlist(productId: string): void {
  try {
    localStorage.setItem(WISH_PENDING_KEY, productId);
  } catch { /* non-critical */ }
}

export function popPendingWishlist(): string | null {
  try {
    const value = localStorage.getItem(WISH_PENDING_KEY);
    if (value) localStorage.removeItem(WISH_PENDING_KEY);
    return value;
  } catch {
    return null;
  }
}

/** POST /api/wishlist — returns the new state or `auth` when the guest must sign in. */
export async function toggleWishlist(productId: string): Promise<{ ok: boolean; added?: boolean; auth?: boolean }> {
  const res = await fetch("/api/wishlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ product_id: productId }),
  });
  if (res.status === 401) return { ok: false, auth: true };
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; added?: boolean };
  return { ok: body.ok === true, added: body.added };
}

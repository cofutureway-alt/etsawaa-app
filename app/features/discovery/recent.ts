/**
 * Recently viewed (S-22 / US-14): guests track views in localStorage
 * (newest first, deduped, capped at 20); signed-in users use the DB via
 * /api/recent; the guest history merges into the DB on sign-in
 * (CartProvider handles the merge pass).
 */

const RECENT_KEY = "etsawaa.recent.v1";
export const RECENT_CAP = 20;

export interface RecentEntry {
  id: string;
  at: number;
}

export function readRecent(): RecentEntry[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e) => typeof e?.id === "string" && typeof e?.at === "number")
      .slice(0, RECENT_CAP);
  } catch {
    return [];
  }
}

/** Record a product view (guest side). Dedupes to the newest position. */
export function recordRecentGuest(productId: string): RecentEntry[] {
  const now = Date.now();
  const next = [{ id: productId, at: now }, ...readRecent().filter((e) => e.id !== productId)].slice(0, RECENT_CAP);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* non-critical */ }
  return next;
}

/** Remove one product from the guest history (e.g. deleted product page). */
export function removeFromRecentGuest(productId: string): void {
  const next = readRecent().filter((e) => e.id !== productId);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* non-critical */ }
}

export async function recordViewRemote(productId: string): Promise<void> {
  await fetch("/api/recent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ intent: "record", product_id: productId }),
  }).catch(() => undefined);
}

export async function clearRecentRemote(): Promise<void> {
  await fetch("/api/recent", {
    method: "DELETE",
  }).catch(() => undefined);
}

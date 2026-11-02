import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  apiAdd, apiMergeCart, apiRemove, apiSetQty, fetchCart, peekLines,
  type CartLine, type CartLineInput,
} from "./api";

/**
 * Cart state (S-09 / JOURNEYS §5):
 * - guest → localStorage, live display data via the `peek` endpoint
 * - signed-in → DB cart via RPCs (stock-capped, authoritative)
 * - sign-in merges the guest lines into the DB cart once (US-11)
 */

const GUEST_KEY = "etsawaa.cart.v1";
const RECENT_KEY = "etsawaa.recent.v1";
const WISH_KEY = "etsawaa.wish.pending.v1";

function readGuestLines(): CartLineInput[] {
  try {
    const raw = localStorage.getItem(GUEST_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CartLineInput[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((l) => typeof l?.variant_id === "string" && typeof l?.qty === "number")
      .map((l) => ({ variant_id: l.variant_id, product_id: l.product_id ?? "", qty: Math.min(Math.max(1, Math.round(l.qty)), 99) }));
  } catch {
    return [];
  }
}

function writeGuestLines(lines: CartLineInput[]): void {
  try {
    localStorage.setItem(GUEST_KEY, JSON.stringify(lines));
  } catch { /* storage full/unavailable — cart stays in memory */ }
}

export interface CartContextValue {
  lines: CartLine[];
  /** false until the initial source (localStorage / DB) has loaded */
  ready: boolean;
  count: number;
  drawerOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  add: (variantId: string, productId: string, qty: number) => Promise<{ ok: boolean; capped?: boolean; reason?: string }>;
  setQty: (variantId: string, qty: number) => Promise<void>;
  remove: (variantId: string) => Promise<void>;
  clearLocal: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart outside CartProvider");
  return ctx;
}

export function CartProvider({
  viewerId,
  children,
  onMerged,
}: {
  /** signed-in user id or null (guest) */
  viewerId: string | null;
  children: ReactNode;
  /** called once after the guest data (cart/recents/wishlist) merges */
  onMerged?: (notices: Array<{ variant_id: string; key: string }>) => void;
}) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [ready, setReady] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const viewerRef = useRef<string | null>(viewerId);
  const mergedRef = useRef(false);

  const refresh = useCallback(async () => {
    if (viewerId) {
      const dbLines = await fetchCart().catch(() => []);
      setLines(dbLines);
    } else {
      const guest = readGuestLines();
      setLines(guest.map((g) => ({ ...g })));
    }
    setReady(true);
  }, [viewerId]);

  // initial load + reload whenever the viewer identity changes
  useEffect(() => {
    const identityChanged = viewerRef.current !== viewerId;
    viewerRef.current = viewerId;
    if (viewerId) {
      if (!mergedRef.current || identityChanged) {
        mergedRef.current = true;
        const guest = readGuestLines();
        void (async () => {
          if (guest.length > 0) {
            const { lines: merged, notices } = await apiMergeCart(guest).catch(() => ({ lines: [] as CartLine[], notices: [] }));
            writeGuestLines([]);
            setLines(merged);
            // guest recently-viewed merges server-side in the same pass
            try {
              const rawRecent = localStorage.getItem(RECENT_KEY);
              const items = rawRecent ? (JSON.parse(rawRecent) as Array<{ id: string; at: number }>) : [];
              if (items.length > 0) {
                await fetch("/api/recent", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ intent: "merge", items: items.map((i) => ({ product_id: i.id, viewed_at: new Date(i.at).toISOString() })) }),
                });
                localStorage.removeItem(RECENT_KEY);
              }
            } catch { /* non-critical */ }
            // pending wishlist item saved after sign-in (US-12)
            try {
              const pending = localStorage.getItem(WISH_KEY);
              if (pending) {
                localStorage.removeItem(WISH_KEY);
                await fetch("/api/wishlist", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ product_id: pending }),
                });
              }
            } catch { /* non-critical */ }
            onMerged?.(notices);
          } else {
            await refresh();
          }
          setReady(true);
        })();
        return;
      }
    }
    void refresh();
  }, [viewerId, refresh, onMerged]);

  const add = useCallback(
    async (variantId: string, productId: string, qty: number): Promise<{ ok: boolean; capped?: boolean; reason?: string }> => {
      if (viewerId) {
        const res = await apiAdd(variantId, productId, qty).catch(() => ({ ok: false, reason: "network", lines: undefined, capped: undefined }));
        if (res.ok && res.lines) setLines(res.lines);
        return { ok: res.ok, capped: res.capped, reason: res.reason };
      }
      const guest = readGuestLines();
      const existing = guest.find((l) => l.variant_id === variantId);
      if (existing) existing.qty = Math.min(existing.qty + qty, 99);
      else guest.push({ variant_id: variantId, product_id: productId, qty });
      writeGuestLines(guest);
      // display data resolves lazily; keep the line minimal until peek
      setLines(guest.map((g) => {
        const known = lines.find((l) => l.variant_id === g.variant_id);
        return known ?? { ...g };
      }));
      return { ok: true };
    },
    [viewerId, lines],
  );

  const setQty = useCallback(
    async (variantId: string, qty: number) => {
      if (viewerId) {
        const res = await apiSetQty(variantId, qty).catch(() => ({ ok: false, lines: undefined }));
        if (res.lines) setLines(res.lines);
        return;
      }
      const guest = readGuestLines();
      const line = guest.find((l) => l.variant_id === variantId);
      if (!line) return;
      if (qty < 1) {
        const next = guest.filter((l) => l.variant_id !== variantId);
        writeGuestLines(next);
        setLines(next.map((g) => ({ ...g })));
      } else {
        line.qty = Math.min(qty, 99);
        writeGuestLines(guest);
        setLines(guest.map((g) => {
          const known = lines.find((l) => l.variant_id === g.variant_id);
          return known ?? { ...g };
        }));
      }
    },
    [viewerId, lines],
  );

  const remove = useCallback(
    async (variantId: string) => {
      if (viewerId) {
        const res = await apiRemove(variantId).catch(() => ({ ok: false, lines: undefined }));
        if (res.lines) setLines(res.lines);
        return;
      }
      const next = readGuestLines().filter((l) => l.variant_id !== variantId);
      writeGuestLines(next);
      setLines(next.map((g) => ({ ...g })));
    },
    [viewerId],
  );

  const clearLocal = useCallback(() => {
    writeGuestLines([]);
    setLines([]);
  }, []);

  const count = useMemo(() => lines.reduce((sum, l) => sum + l.qty, 0), [lines]);

  const value = useMemo<CartContextValue>(
    () => ({
      lines,
      ready,
      count,
      drawerOpen,
      openDrawer: () => setDrawerOpen(true),
      closeDrawer: () => setDrawerOpen(false),
      add,
      setQty,
      remove,
      clearLocal,
    }),
    [lines, ready, count, drawerOpen, add, setQty, remove, clearLocal],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

/** Guest cart lines get live display data (name/price/image/stock) on demand. */
export async function ensureGuestDetails(lines: CartLine[]): Promise<CartLine[]> {
  const missing = lines.filter((l) => !l.name_ar);
  if (missing.length === 0) return lines;
  const { lines: detailed, unavailable } = await peekLines(
    missing.map((l) => ({ variant_id: l.variant_id, product_id: l.product_id, qty: l.qty })),
  );
  const byId = new Map(detailed.map((d) => [d.variant_id, d]));
  const dead = new Set(unavailable);
  return lines
    .filter((l) => !dead.has(l.variant_id))
    .map((l) => byId.get(l.variant_id) ?? l);
}

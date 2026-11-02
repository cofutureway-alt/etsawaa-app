import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ProductCard as ProductCardRow } from "~/features/storefront/api";
import { readRecent, recordRecentGuest, recordViewRemote } from "~/features/discovery/recent";
import { lazy, Suspense } from "react";
const ProductCard = lazy(() => import("./ProductCard").then((m) => ({ default: m.ProductCard })));

/**
 * "You viewed before" strip (S-22 / US-14): home + product page.
 * Guest → localStorage ids hydrated through /api/recent (hidden/deleted
 * ids are dropped server-side); signed-in → GET /api/recent (DB last 20).
 * Hidden when empty (US-01 edge: never an empty box).
 */
export function RecentStrip({
  lang,
  viewerId,
  excludeId,
  wishedIds = new Set<string>(),
}: {
  lang: string;
  viewerId: string | null;
  /** on the product page the current product is not part of its own strip */
  excludeId?: string;
  wishedIds?: Set<string>;
}) {
  const { t } = useTranslation();
  const [cards, setCards] = useState<ProductCardRow[] | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (viewerId) {
        const res = await fetch("/api/recent");
        if (!res.ok) { if (alive) setCards([]); return; }
        const body = (await res.json()) as { cards?: ProductCardRow[] };
        if (alive) setCards(body.cards ?? []);
        return;
      }
      // guest: strips read what this browser viewed
      const ids = readRecent().map((e) => e.id).filter((id) => id !== excludeId).slice(0, 12);
      if (ids.length === 0) { if (alive) setCards([]); return; }
      const res = await fetch("/api/recent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "cards", ids }),
      });
      const body = (await res.json().catch(() => ({ cards: [] }))) as { cards?: ProductCardRow[] };
      if (alive) setCards(body.cards ?? []);
    })();
    return () => { alive = false; };
  }, [viewerId, excludeId]);

  if (cards === null || cards.length === 0) return null;

  return (
    <section aria-label={t("store.recent.title")} className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-extrabold text-text">{t("store.recent.title")}</h2>
      </div>
      <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        <Suspense fallback={null}>
          {cards.filter((c) => c.id !== excludeId).slice(0, 6).map((card) => (
            <li key={card.id} className="min-w-0">
              <ProductCard card={card} lang={lang} wished={wishedIds.has(card.id)} />
            </li>
          ))}
        </Suspense>
      </ul>
    </section>
  );
}

/** Records a product view for the current visitor (call from the product page). */
export function useRecordView(productId: string, viewerId: string | null): void {
  useEffect(() => {
    if (!productId) return;
    if (viewerId) void recordViewRemote(productId);
    else recordRecentGuest(productId);
  }, [productId, viewerId]);
}

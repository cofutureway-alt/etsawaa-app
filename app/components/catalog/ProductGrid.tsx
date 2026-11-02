import type { ProductCard as ProductCardRow } from "~/features/storefront/api";
import { ProductCard } from "./ProductCard";

/**
 * Responsive card grid (S-17): 2/3/4/4 columns across the breakpoints,
 * with skeleton placeholders of the exact same cell shape — no layout jump.
 */
export function ProductGrid({
  cards,
  lang,
  wishedIds = new Set<string>(),
  eagerFirst = 0,
}: {
  cards: ProductCardRow[];
  lang: string;
  wishedIds?: Set<string>;
  eagerFirst?: number;
}) {
  return (
    <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4" aria-busy="false">
      {cards.map((card, index) => (
        <li key={card.id} className="min-w-0">
          <ProductCard card={card} lang={lang} wished={wishedIds.has(card.id)} eager={index < eagerFirst} />
        </li>
      ))}
    </ul>
  );
}

/** Skeleton twin of the grid — same cells, same gaps (S-17 DoD). */
export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4" aria-busy="true">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="overflow-hidden rounded-lg border border-border bg-surface">
          <div className="aspect-square w-full animate-pulse bg-surface-tint" />
          <div className="flex flex-col gap-2 p-2.5">
            <div className="h-3.5 w-full animate-pulse rounded bg-surface-tint" />
            <div className="h-3.5 w-2/3 animate-pulse rounded bg-surface-tint" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-surface-tint" />
          </div>
        </li>
      ))}
    </ul>
  );
}

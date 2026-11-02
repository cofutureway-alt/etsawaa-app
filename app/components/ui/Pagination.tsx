import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { ChevronLeftIcon, ChevronRightIcon } from "~/components/ui/icons";

/**
 * Shared page-link bar (AGENT §23 mentions Pagination as a primitive; the only
 * implementation lived inside components/catalog/Listing).
 * `hrefFor(page)` builds the URL, so callers keep their own query encoding.
 */
export interface PaginationProps {
  page: number;
  total: number;
  perPage: number;
  hrefFor: (page: number) => string;
  /** window size excluding the arrow buttons */
  window?: number;
}

export function Pagination({ page, total, perPage, hrefFor, window: span = 5 }: PaginationProps) {
  const { t } = useTranslation();
  const pages = Math.max(1, Math.ceil(total / perPage));
  if (pages <= 1) return null;

  const windowStart = Math.max(1, Math.min(page - Math.floor(span / 2), pages - (span - 1)));
  const windowEnd = Math.min(pages, windowStart + span - 1);
  const items: number[] = [];
  for (let p = windowStart; p <= windowEnd; p += 1) items.push(p);

  return (
    <nav aria-label={t("store.listing.pagination")} className="mt-5 flex items-center justify-center gap-1.5">
      {page > 1 ? (
        <Link
          to={hrefFor(page - 1)}
          rel="prev"
          aria-label={t("common.back")}
          className="flex size-10 items-center justify-center rounded-m border border-border bg-surface text-text transition-colors duration-150 hover:bg-surface-tint"
        >
          <ChevronRightIcon aria-hidden="true" className="mirr" />
        </Link>
      ) : null}
      {items.map((p) => (
        <Link
          key={p}
          to={hrefFor(p)}
          aria-current={p === page ? "page" : undefined}
          aria-label={t("store.listing.pageN", { page: p })}
          className={`num flex size-10 items-center justify-center rounded-m border text-[13px] font-bold transition-colors duration-150 ${
            p === page
              ? "border-action bg-action text-on-action"
              : "border-border bg-surface text-text hover:bg-surface-tint"
          }`}
        >
          {p}
        </Link>
      ))}
      {page < pages ? (
        <Link
          to={hrefFor(page + 1)}
          rel="next"
          aria-label={t("common.next")}
          className="flex size-10 items-center justify-center rounded-m border border-border bg-surface text-text transition-colors duration-150 hover:bg-surface-tint"
        >
          <ChevronLeftIcon aria-hidden="true" className="mirr" />
        </Link>
      ) : null}
      <span className="sr-only">{t("store.listing.pageOf", { page, total: pages })}</span>
    </nav>
  );
}

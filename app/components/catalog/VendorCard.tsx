import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Rating } from "~/components/ui/Rating";
import type { StoreCard } from "~/features/storefront/api";
import { MediaImg } from "./MediaImg";

/**
 * Store card for the vendors page / featured-vendors strip (S-07):
 * logo, name, level badge, rating, product count, featured border.
 */
export function VendorCard({ store, lang }: { store: StoreCard; lang: string }) {
  const { t } = useTranslation();
  const name = lang === "ar" ? store.store_name_ar || store.store_name_en : store.store_name_en || store.store_name_ar;
  const level = lang === "ar" ? store.level_name_ar : store.level_name_en;
  const desc = lang === "ar" ? store.short_desc_ar : store.short_desc_en;
  return (
    <article
      className={`flex flex-col items-center gap-2 rounded-lg border bg-surface p-4 text-center transition-shadow duration-200 hover:shadow-1 ${
        store.is_featured ? "border-featured border-2" : "border-border"
      }`}
    >
      <Link to={`/${lang}/store/${encodeURIComponent(store.slug)}`} className="shrink-0" tabIndex={-1} aria-hidden="true">
        {store.logo_path ? (
          <MediaImg path={store.logo_path} alt={name} width={96} height={96} className="size-20 rounded-full border border-border" />
        ) : (
          <span className="flex size-20 items-center justify-center rounded-full border border-border bg-surface-tint text-xl font-black text-action">
            {name.slice(0, 1)}
          </span>
        )}
      </Link>
      <div className="min-w-0">
        <h3 className="truncate text-sm font-extrabold text-text">
          <Link to={`/${lang}/store/${encodeURIComponent(store.slug)}`} className="transition-colors duration-150 hover:text-action">
            {name}
          </Link>
        </h3>
        {level ? (
          <span className="mt-1 inline-block rounded-full border border-featured bg-surface px-2 py-px text-2xs font-extrabold text-ink">
            {level}
          </span>
        ) : null}
      </div>
      {desc ? <p className="line-clamp-2 text-xs text-text-muted">{desc}</p> : null}
      {store.rating_count > 0 && store.rating_avg != null ? (
        <Rating value={store.rating_avg} count={store.rating_count} size="sm" />
      ) : (
        <span className="text-2xs text-text-faint">{t("store.noReviews")}</span>
      )}
      <span className="num text-2xs font-bold text-text-muted">
        {t("store.vendor.productCount", { count: store.product_count })}
      </span>
    </article>
  );
}

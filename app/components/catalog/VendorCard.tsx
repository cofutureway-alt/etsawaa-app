import { Link, useMatches } from "react-router";
import { useTranslation } from "react-i18next";
import { Rating } from "~/components/ui/Rating";
import { ChevronRightIcon } from "~/components/ui/icons";
import type { StoreCard } from "~/features/storefront/api";
import { MediaImg } from "./MediaImg";

/**
 * Store card for the vendors page / featured-vendors strip (S-07).
 *
 * Reads as a storefront, not a profile: the logo sits on the leading edge at
 * one size, the name and the level ride one line, and the secondary facts
 * (rating, catalogue size) share a single footer rule. Centering everything
 * left the card with no anchor and no way in; the whole card is the link.
 */
export function VendorCard({ store, lang }: { store: StoreCard; lang: string }) {
  const { t } = useTranslation();
  const name = lang === "ar" ? store.store_name_ar || store.store_name_en : store.store_name_en || store.store_name_ar;
  const level = lang === "ar" ? store.level_name_ar : store.level_name_en;
  // the bio stays on the store page; the card names the store's main categories
  // (resolved from the category tree the storefront layout already loaded)
  const matches = useMatches();
  const tree = (matches.map((m) => (m.data as { categories?: unknown } | undefined)?.categories).find(Array.isArray) ?? []) as Array<{ id: string; name_ar: string; name_en: string; depth: number; path: string }>;
  const byId = new Map(tree.map((c) => [c.id, c]));
  const mainCats = [...new Set((store.category_ids ?? []).map((id) => {
    const c = byId.get(id);
    if (!c) return null;
    // a sub-category is shown under its main (level-1) category
    const rootId = c.path?.split("/")[0];
    const root = (rootId && byId.get(rootId)) || c;
    return lang === "ar" ? root.name_ar || root.name_en : root.name_en || root.name_ar;
  }).filter((n): n is string => Boolean(n)))];
  const href = `/${lang}/store/${encodeURIComponent(store.slug)}`;

  return (
    <article
      className={`group relative flex h-full flex-col rounded-lg border bg-surface transition-colors duration-200 hover:border-border-strong ${
        store.is_featured ? "border-featured" : "border-border"
      }`}
    >
      <div className="flex min-w-0 items-start gap-3 p-3">
        <Link to={href} className="shrink-0" tabIndex={-1} aria-hidden="true">
          {store.logo_path ? (
            <MediaImg
              path={store.logo_path}
              alt={name}
              width={112}
              height={112}
              className="size-14 rounded-lg border border-border bg-surface object-cover"
            />
          ) : (
            <span className="flex size-14 items-center justify-center rounded-lg bg-surface-tint text-xl font-black text-action">
              {name.slice(0, 1)}
            </span>
          )}
        </Link>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 className="truncate text-sm font-extrabold text-text">
            <Link
              to={href}
              className="transition-colors duration-150 group-hover:text-action"
            >
              {name}
            </Link>
          </h3>
          {level ? (
            <span className="w-fit rounded-full bg-surface-tint px-2 py-px text-2xs font-extrabold text-action">
              {level}
            </span>
          ) : null}
          {store.rating_count > 0 && store.rating_avg != null ? (
            <Rating value={store.rating_avg} count={store.rating_count} size="sm" />
          ) : (
            <span className="text-2xs text-text-faint">{t("store.noReviews")}</span>
          )}
        </div>
      </div>

      {mainCats.length > 0 ? (
        <ul className="flex flex-wrap gap-1 px-3 pb-3" aria-label={t("store.vendor.mainCategories")}>
          {mainCats.slice(0, 3).map((name) => (
            <li key={name} className="max-w-full truncate rounded-full border border-border bg-surface-tint px-2 py-0.5 text-2xs font-bold text-text-muted">{name}</li>
          ))}
          {mainCats.length > 3 ? <li className="num rounded-full px-1.5 py-0.5 text-2xs font-bold text-text-faint">+{mainCats.length - 3}</li> : null}
        </ul>
      ) : null}

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-border px-3 py-2.5">
        <span className="num text-2xs font-bold text-text-muted">
          {t("store.vendor.productCount", { count: store.product_count })}
        </span>
        <Link
          to={href}
          className="flex items-center gap-1 text-2xs font-extrabold text-action hover:underline"
        >
          {t("store.vendor.visit")}
          <ChevronRightIcon aria-hidden="true" className="mirr size-3.5" />
        </Link>
      </div>
    </article>
  );
}

import { Link, useNavigate, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import { Drawer } from "~/components/ui/Overlay";
import { EmptyState } from "~/components/ui/EmptyState";
import { Breadcrumbs, type Crumb } from "~/components/ui/Breadcrumbs";
import { Pagination } from "~/components/ui/Pagination";
import { FilterIcon } from "~/components/ui/icons";
import type { SearchResult } from "~/features/storefront/api";
import type { FacetDef, FilterState } from "./FacetPanel";
import { FacetPanel } from "./FacetPanel";
import { ProductGrid, ProductGridSkeleton } from "./ProductGrid";
import { buildListingQuery, filterCount, isFiltered, SORT_OPTIONS } from "~/features/storefront/listing";
import { useState } from "react";

/**
 * The shared listing view (S-03): facets sidebar (drawer on mobile), sort,
 * count, pagination. Filters navigate client-side with the full state in
 * the URL — back restores the exact view (US-02/03).
 */
export function Listing({
  lang,
  result,
  defs,
  state,
  basePath,
  crumbs,
  title,
  hideCategoryFacet = false,
  loading = false,
  wishedIds = new Set<string>(),
  description,
  /** search "did you mean" chip shown above the zero-results state (US-04) */
  zeroSuggestion,
}: {
  lang: string;
  result: SearchResult | null;
  defs: FacetDef[];
  state: FilterState;
  basePath: string;
  crumbs: Crumb[];
  title: string;
  hideCategoryFacet?: boolean;
  loading?: boolean;
  wishedIds?: Set<string>;
  description?: string;
  zeroSuggestion?: string | null;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const navState = useNavigation().state;
  const [facetsOpen, setFacetsOpen] = useState(false);
  const busy = navState !== "idle";

  const apply = (patch: Partial<FilterState>) => {
    const next = { ...state, ...patch };
    void navigate(`${basePath}${buildListingQuery(next, defs)}`, { replace: false, preventScrollReset: false });
  };

  const clearAll = () => {
    void navigate(basePath);
    setFacetsOpen(false);
  };

  // zero-result edge (US-03): when filters are active, offer removing the last one
  const zeroWithFilters = result && result.total === 0 && isFiltered(state);
  const lastFilterKey = zeroWithFilters ? filterCount(state) : 0;

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs label={t("a11y.breadcrumbs")} items={crumbs} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-black text-text">{title}</h1>
          {description ? <p className="mt-0.5 max-w-2xl text-[13px] text-text-muted">{description}</p> : null}
          {result ? (
            <p className="num mt-0.5 text-[13px] font-bold text-text-muted">
              {t("store.listing.count", { count: result.total })}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setFacetsOpen(true)}
            aria-haspopup="dialog"
            className="flex min-h-10 cursor-pointer items-center gap-1.5 rounded-m border border-border bg-surface px-3 text-[13px] font-bold text-text transition-colors duration-150 hover:bg-surface-tint lg:hidden"
          >
            <FilterIcon aria-hidden="true" className="size-4" />
            {t("store.filters.title")}
          </button>
          <label className="flex items-center gap-2 text-[13px]">
            <span className="hidden font-bold text-text-muted sm:inline">{t("store.listing.sort")}</span>
            <select
              value={state.sort}
              onChange={(e) => apply({ sort: e.target.value, page: 1 })}
              aria-label={t("store.listing.sort")}
              className="min-h-10 cursor-pointer rounded-m border border-border bg-surface px-2.5 text-[13px] font-bold text-text outline-none focus:border-action"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {t(`store.listing.sort_${option}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[250px_minmax(0,1fr)]">
        <aside className="hidden self-start rounded-l border border-border bg-surface p-3 lg:block" aria-label={t("store.filters.title")}>
          <h2 className="mb-3 flex items-center gap-1.5 px-1 text-[13px] font-extrabold text-text">
            <FilterIcon aria-hidden="true" className="size-4" />
            {t("store.filters.title")}
          </h2>
          {result ? (
            <FacetPanel
              facets={result.facets}
              defs={defs}
              state={state}
              lang={lang === "en" ? "en" : "ar"}
              hideCategory={hideCategoryFacet}
              onChange={apply}
              onClearAll={clearAll}
            />
          ) : (
            <ProductGridSkeleton count={1} />
          )}
        </aside>

        <div className="min-w-0">
          {busy || loading || !result ? (
            <ProductGridSkeleton count={8} />
          ) : (
            <>
              {result.items.length === 0 && zeroSuggestion ? (
                <div className="mb-3 rounded-l border border-border bg-surface p-4 text-center">
                  <p className="text-[13px] text-text-muted">{t("store.search.didYouMean")}</p>
                  <button
                    type="button"
                    onClick={() => void navigate(`${basePath}?q=${encodeURIComponent(zeroSuggestion)}`)}
                    className="mt-2 cursor-pointer rounded-m border-2 border-action px-4 py-2 text-[13px] font-extrabold text-action transition-colors duration-150 hover:bg-surface-tint"
                  >
                    {zeroSuggestion}
                  </button>
                </div>
              ) : null}
              {result.items.length === 0 ? (
                zeroWithFilters ? (
              <EmptyState
                title={t("store.listing.zeroFiltered.title")}
                body={t("store.listing.zeroFiltered.body", { count: lastFilterKey })}
                action={
                  <button
                    type="button"
                    onClick={clearAll}
                    className="cursor-pointer rounded-m bg-action px-4 py-2 text-[13px] font-bold text-on-action transition-colors duration-150 hover:bg-action-hover"
                  >
                    {t("store.listing.zeroFiltered.cta")}
                  </button>
                }
              />
            ) : (
              <EmptyState
                title={t("store.listing.empty.title")}
                body={t("store.listing.empty.body")}
                action={
                  <Link
                    to={`/${lang}/products`}
                    className="inline-block rounded-m bg-action px-4 py-2 text-[13px] font-bold text-on-action transition-colors duration-150 hover:bg-action-hover"
                  >
                    {t("store.listing.empty.cta")}
                  </Link>
                }
              />
            )
          ) : (
            <>
              <ProductGrid cards={result.items} lang={lang} wishedIds={wishedIds} eagerFirst={4} />
              <Pagination
                page={result.page}
                perPage={result.per_page}
                total={result.total}
                hrefFor={(p) => `${basePath}${buildListingQuery({ ...state, page: p }, defs)}`}
              />
            </>
          )}
            </>
          )}
        </div>
      </div>

      <Drawer open={facetsOpen} onClose={() => setFacetsOpen(false)} title={t("store.filters.title")}>
        {result ? (
          <FacetPanel
            facets={result.facets}
            defs={defs}
            state={state}
            lang={lang === "en" ? "en" : "ar"}
            hideCategory={hideCategoryFacet}
            onChange={apply}
            onClearAll={clearAll}
          />
        ) : null}
        <button
          type="button"
          onClick={() => setFacetsOpen(false)}
          className="mt-4 w-full cursor-pointer rounded-m bg-action py-2.5 text-[13px] font-extrabold text-on-action transition-colors duration-150 hover:bg-action-hover"
        >
          {t("store.filters.showResults")}
        </button>
      </Drawer>
    </div>
  );
}


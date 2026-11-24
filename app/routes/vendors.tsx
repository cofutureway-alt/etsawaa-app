import type { Route } from "./+types/vendors";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getI18n } from "~/lib/i18n/config";
import { requireLang } from "~/lib/lang.server";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { publicMeta } from "~/lib/seo";
import { getCategories, getFeaturedStores, listStores, type CategoryNode, type StoreCard } from "~/features/storefront/api";
import { VendorCard } from "~/components/catalog/VendorCard";
import { getSpotlightStores } from "~/features/ads/ads.server";
import { useAdImpressions } from "~/features/ads/ad-tracking";
import { EmptyState } from "~/components/ui/EmptyState";
import { Breadcrumbs } from "~/components/ui/Breadcrumbs";
import { SkeletonPage } from "~/components/ui/Skeleton";


/**
 * Vendors page (S-07): featured section + full list with category/level
 * filters. Suspended or listing-hidden vendors are excluded (US-08 edge).
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return { lang, featured: [] as StoreCard[], stores: [] as StoreCard[], categories: [] as CategoryNode[], sponsored: {} as Record<string, string> };
  const [featuredRaw, stores, categories, spot] = await Promise.all([
    getFeaturedStores(client).catch(() => []),
    listStores(client).catch(() => []),
    getCategories(client, { maxDepth: 1 }).catch(() => []),
    getSpotlightStores(client, 4).catch(() => ({ stores: [] as StoreCard[], campaignOf: {} as Record<string, string> })),
  ]);
  // paid "Featured store" campaigns lead the featured row
  const featured = [...spot.stores, ...featuredRaw.filter((s) => !spot.campaignOf[s.id])];
  return { lang, featured, stores, categories, sponsored: spot.campaignOf };
}

export const meta = ({ data }: Route.MetaArgs) => {
  const lang = (data?.lang as "ar" | "en") ?? "ar";
  const t = getI18n(lang).t;
  return publicMeta({
    lang,
    path: "/vendors",
    title: `${t("vendors.metaTitle")} — ${t("app.name")}`,
    description: t("vendors.metaDescription"),
  });
};

export default function VendorsPage({ loaderData }: Route.ComponentProps) {
  useAdImpressions(Object.values(loaderData.sponsored ?? {}).filter((id) => loaderData.featured.slice(0, 4).some((st) => loaderData.sponsored?.[st.id] === id)));
  const { t } = useTranslation();
  const lang = loaderData.lang;
  const [category, setCategory] = useState<string>("");
  const [level, setLevel] = useState<string>("");

  const levels = useMemo(() => {
    const names = new Set<string>();
    for (const store of loaderData.stores) {
      const name = lang === "ar" ? store.level_name_ar : store.level_name_en;
      if (name) names.add(name);
    }
    return [...names];
  }, [loaderData.stores, lang]);

  const filtered = useMemo(() => {
    let rows = loaderData.stores;
    if (category) rows = rows.filter((s) => (s.category_ids ?? []).includes(category));
    if (level) rows = rows.filter((s) => (lang === "ar" ? s.level_name_ar : s.level_name_en) === level);
    return rows;
  }, [loaderData.stores, category, level, lang]);

  return (
    <div className="flex flex-col gap-5">
      <Breadcrumbs
        label={t("a11y.breadcrumbs")}
        items={[{ label: t("nav.home"), href: `/${lang}` }, { label: t("nav.vendors") }]}
      />

      <h1 className="text-xl font-black text-text">{t("nav.vendors")}</h1>

      {loaderData.featured.length > 0 ? (
        <section aria-label={t("store.vendor.featured")} className="flex flex-col gap-3">
          <h2 className="text-lg font-black text-text">{t("store.vendor.featured")}</h2>
          <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
            {loaderData.featured.slice(0, 4).map((store) => (
              <li key={store.id} className="relative min-w-0">
                <VendorCard store={store} lang={lang} />
                {loaderData.sponsored?.[store.id] ? <span className="pointer-events-none absolute end-2 top-2 rounded-full border border-border bg-surface/95 px-2 py-0.5 text-2xs font-bold text-text-muted">{t("ads.sponsored")}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-label={t("nav.vendors")} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-extrabold text-text">
            {loaderData.featured.length > 0 ? t("store.vendor.all") : t("nav.vendors")}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-sm">
              <span className="font-bold text-text-muted">{t("store.vendor.filterCategory")}</span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="min-h-9 cursor-pointer rounded-md border border-border bg-surface px-2 text-sm font-bold outline-none focus:border-action"
              >
                <option value="">{t("store.vendor.filterAll")}</option>
                {loaderData.categories.filter((c) => c.depth === 1).map((c) => (
                  <option key={c.id} value={c.id}>{lang === "ar" ? c.name_ar : c.name_en}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-sm">
              <span className="font-bold text-text-muted">{t("store.vendor.filterLevel")}</span>
              <select
                value={level}
                onChange={(e) => setLevel(e.target.value)}
                className="min-h-9 cursor-pointer rounded-md border border-border bg-surface px-2 text-sm font-bold outline-none focus:border-action"
              >
                <option value="">{t("store.vendor.filterAll")}</option>
                {levels.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState title={t("store.vendor.empty.title")} body={t("store.vendor.empty.body")} />
        ) : (
          <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
            {filtered.map((store) => (
              <li key={store.id} className="min-w-0">
                <VendorCard store={store} lang={lang} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonPage />;
}

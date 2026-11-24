import type { Route } from "./+types/brand";
import { useTranslation } from "react-i18next";
import { getI18n } from "~/lib/i18n/config";
import { requireLang } from "~/lib/lang.server";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { ogMedia, publicMeta } from "~/lib/seo";
import { loadListing } from "~/features/storefront/server-listing";
import { Listing } from "~/components/catalog/Listing";
import { MediaImg } from "~/components/catalog/MediaImg";
import { SkeletonPage } from "~/components/ui/Skeleton";
import { Link } from "react-router";
import { getCategoriesByIds } from "~/features/storefront/api";


/** /brand/:slug — one brand's products (S-08; empty brand → friendly state). */
export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw new Response("Not Found", { status: 404 });
  const data = await loadListing(request, client, { fixedBrandSlug: params.slug ?? "" });
  if (!data.scope.brand) throw new Response("Not Found", { status: 404 });
  const cats = await getCategoriesByIds(client, data.scope.brand.category_ids ?? []).catch(() => []);
  return { lang, data, cats };
}

export const meta = ({ data }: Route.MetaArgs) => {
  const lang = (data?.lang as "ar" | "en") ?? "ar";
  const t = getI18n(lang).t;
  const brand = data?.data?.scope.brand;
  const name = brand ? (lang === "ar" ? brand.name_ar : brand.name_en) : t("brand.metaFallbackTitle");
  return publicMeta({
    lang,
    path: `/brand/${encodeURIComponent(lang === "ar" ? brand?.slug_ar || brand?.slug_en || "" : brand?.slug_en || brand?.slug_ar || "")}`,
    altPath: `/brand/${encodeURIComponent(lang === "ar" ? brand?.slug_en || brand?.slug_ar || "" : brand?.slug_ar || brand?.slug_en || "")}`,
    title: lang === "ar" ? `منتجات ${name} الأصلية في مصر | ${t("app.name")}` : `${name} official products in Egypt | ${t("app.name")}`,
    ogImage: ogMedia(brand?.thumb_path),
    keywords: brand ? (lang === "ar" ? [name, `منتجات ${name}`, `اسعار ${name} في مصر`] : [name, `${name} products`, `${name} price Egypt`]) : [],
    // a brand with no live products is a thin page: keep it out of the index
    noindex: (data?.data?.result.total ?? 0) === 0,
    description: (lang === "ar" ? brand?.description_ar : brand?.description_en)?.slice(0, 160) || t("brand.metaDescription", { name }),
  });
};

export default function BrandPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { lang, data, cats } = loaderData;
  const en = lang === "en";
  const brand = data.scope.brand!;
  const name = lang === "ar" ? brand.name_ar : brand.name_en;
  const brandSlug = lang === "en" ? brand.slug_en || brand.slug_ar : brand.slug_ar || brand.slug_en;
  return (
    <Listing
      lang={lang}
      result={data.result}
      defs={data.scope.defs}
      state={data.state}
      basePath={`/${lang}/brand/${encodeURIComponent(brandSlug)}`}
      crumbs={[
        { label: t("nav.home"), href: `/${lang}` },
        { label: t("nav.brands"), href: `/${lang}/brands` },
        { label: name },
      ]}
      title={name}
      wishedIds={data.wishedIds}
      intro={
        <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-1">
          <div className="flex flex-col gap-5 p-4 sm:flex-row sm:items-center sm:p-6">
            <span className="relative flex aspect-[3/2] w-full max-w-[220px] shrink-0 items-center justify-center self-center overflow-hidden rounded-xl border border-border bg-white p-3 sm:self-auto">
              {brand.thumb_path ? (
                <MediaImg path={brand.thumb_path} alt={name} width={220} height={147} className="absolute inset-0 size-full p-3 object-contain" />
              ) : (
                <span className="text-center text-2xl font-black text-action">{name}</span>
              )}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <p className="text-sm leading-relaxed text-text">
                {(en ? brand.description_en : brand.description_ar) || t("store.brand.productsFrom", { brand: name })}
              </p>
              <dl className="flex flex-wrap gap-2 text-xs">
                {(en ? brand.country_en : brand.country_ar) ? (
                  <div className="flex items-center gap-1.5 rounded-full bg-surface-tint px-3 py-1.5">
                    <dt className="text-text-muted">{t("store.brand.country")}</dt>
                    <dd className="font-extrabold text-text">{en ? brand.country_en : brand.country_ar}</dd>
                  </div>
                ) : null}
                {brand.founded_year ? (
                  <div className="flex items-center gap-1.5 rounded-full bg-surface-tint px-3 py-1.5">
                    <dt className="text-text-muted">{t("store.brand.founded")}</dt>
                    <dd className="num font-extrabold text-text">{brand.founded_year}</dd>
                  </div>
                ) : null}
                <div className="flex items-center gap-1.5 rounded-full bg-surface-tint px-3 py-1.5">
                  <dt className="sr-only">{t("store.brand.products")}</dt>
                  <dd className="num font-extrabold text-text">{t("store.vendor.productCount", { count: brand.product_count })}</dd>
                </div>
              </dl>
            </div>
          </div>
          {cats.length ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-border bg-surface-tint/40 px-4 py-3 sm:px-6">
              <span className="text-xs font-bold text-text-muted">{t("store.brand.sellsIn")}</span>
              {cats.map((c) => (
                <Link key={c.id} to={`/${lang}/category/${encodeURIComponent(en ? c.slug_en || c.slug_ar : c.slug_ar || c.slug_en)}`}
                  className="rounded-full border border-border bg-surface px-3 py-1 text-xs font-bold text-text transition-colors hover:border-action hover:text-action">
                  {en ? c.name_en : c.name_ar}
                </Link>
              ))}
            </div>
          ) : null}
        </section>
      }
    />
  );
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonPage />;
}

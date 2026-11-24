import { FitBanner } from "~/components/catalog/FitBanner";
import { Link, redirect } from "react-router";
import type { Route } from "./+types/category";
import { useTranslation } from "react-i18next";
import { getI18n } from "~/lib/i18n/config";
import { requireLang } from "~/lib/lang.server";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { breadcrumbLd, jsonLd, ogMedia, publicMeta, siteUrl } from "~/lib/seo";
import { loadListing } from "~/features/storefront/server-listing";
import { Listing } from "~/components/catalog/Listing";
import { MediaImg } from "~/components/catalog/MediaImg";
import { CategoryIcon } from "~/components/catalog/CategoryIcon";
import { Carousel } from "~/components/ui/Carousel";
import { SkeletonPage } from "~/components/ui/Skeleton";
import { CATEGORY_COLUMNS, getCategoryBySlug } from "~/features/storefront/api";
import { getActiveAds, getAdProductCards, pinAds } from "~/features/ads/ads.server";
import { sendAdEvent, useAdImpressions } from "~/features/ads/ad-tracking";


/** Old slug → the product type it was merged into (catalog clean-ups). */
const MERGED_CATEGORIES: Record<string, string> = {
  "hand-mixers": "electric-whisks",
  "المضرب-الكهربائي": "electric-whisks",
  "sunscreen": "sunscreens",
  "واقي-شمس": "sunscreens",
};

/**
 * Category page (S-02 / US-02): header (image/description) + subcategory
 * cards + the product listing with facets. Only active nodes resolve —
 * anything else is a 404.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw new Response("Not Found", { status: 404 });
  const slug = params.slug ?? "";
  // product types merged into another keep their old links working
  const merged = MERGED_CATEGORIES[decodeURIComponent(slug)];
  if (merged) throw redirect(`/${lang}/category/${encodeURIComponent(merged)}${new URL(request.url).search}`, 301);
  // subcategories (direct children) load in parallel with the listing: the
  // category lookup is shared with loadListing in this request, so it costs
  // nothing extra and the children query no longer waits for the search
  const [data, all] = await Promise.all([
    loadListing(request, client, { fixedCategorySlug: slug }),
    getCategoryBySlug(client, slug).then(async (cat) => cat
      ? await client.from("v_storefront_categories").select(CATEGORY_COLUMNS).eq("parent_id", cat.id).order("sort")
      : { data: null }),
  ]);
  if (!data.scope.category) throw new Response("Not Found", { status: 404 });
  const children = (all.data ?? []) as Array<{ id: string; slug_ar: string; slug_en: string; name_ar: string; name_en: string; thumb_path: string | null; icon: string | null }>;

  // paid placements for this category or a parent of it: a banner on top and
  // products pinned first (first page of the default order only)
  const scopeIds = new Set([data.scope.category.id, ...data.scope.chain.map((c) => c.id)]);
  const ads = (await getActiveAds(client, ["category_featured", "category_banner"])).filter((a) => a.category_id && scopeIds.has(a.category_id));
  let adCampaigns: string[] = [];
  const banners = ads.filter((a) => a.placement === "category_banner" && a.image_path)
    .map((a) => ({ id: a.id, image_path: a.image_path as string, link_url: a.link_url ?? "" })).slice(0, 3);
  const featured = ads.filter((a) => a.placement === "category_featured");
  if (featured.length && data.result.page === 1 && !new URL(request.url).searchParams.get("sort")) {
    const cards = await getAdProductCards(client, featured.map((a) => a.product_id ?? ""));
    const pinned = pinAds(data.result.items, featured, cards, Math.max(data.result.items.length, data.result.per_page));
    data.result.items = pinned.list;
    adCampaigns = Object.values(pinned.campaignOf);
  }
  adCampaigns = [...adCampaigns, ...banners.map((b) => b.id)];
  return { lang, data, children, adBanners: banners, adCampaigns };
}

export const meta = ({ data }: Route.MetaArgs) => {
  const lang = (data?.lang as "ar" | "en") ?? "ar";
  const t = getI18n(lang).t;
  const cat = data?.data?.scope.category;
  const name = cat ? (lang === "ar" ? cat.name_ar : cat.name_en) : t("category.metaFallbackTitle");
  const desc = cat ? (lang === "ar" ? cat.description_ar : cat.description_en) : "";
  const slug = cat ? (lang === "ar" ? cat.slug_ar || cat.slug_en : cat.slug_en || cat.slug_ar) : "";
  const otherSlug = cat ? (lang === "ar" ? cat.slug_en || cat.slug_ar : cat.slug_ar || cat.slug_en) : "";
  return publicMeta({
    lang,
    path: `/category/${encodeURIComponent(slug)}`,
    altPath: `/category/${encodeURIComponent(otherSlug)}`,
    title: lang === "ar" ? `${name} — تسوق ${name} أونلاين بأفضل الأسعار | ${t("app.name")}` : `${name} — Shop ${name} online in Egypt | ${t("app.name")}`,
    ogImage: ogMedia(cat?.thumb_path),
    keywords: cat ? (lang === "ar" ? [name, `${name} اونلاين`, `اسعار ${name}`, `${name} في مصر`] : [name, `${name} online`, `${name} prices`, `${name} Egypt`]) : [],
    description: desc || t("category.metaDescription", { name }),
    // an empty category is a thin page: keep it out of the index until it has products
    noindex: (data?.data?.result.total ?? 0) === 0,
  });
};

export default function CategoryPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { lang, data, children } = loaderData;
  useAdImpressions(loaderData.adCampaigns ?? []);
  const adBanners = loaderData.adBanners ?? [];
  const cat = data.scope.category!;
  const name = lang === "ar" ? cat.name_ar : cat.name_en;
  const description = lang === "ar" ? cat.description_ar : cat.description_en;
  const catSlug = lang === "en" ? cat.slug_en || cat.slug_ar : cat.slug_ar || cat.slug_en;

  const crumbs = [
    { label: t("nav.home"), href: `/${lang}` },
    ...data.scope.chain.map((c) => ({
      label: lang === "ar" ? c.name_ar : c.name_en,
      href: `/${lang}/category/${encodeURIComponent(lang === "en" ? c.slug_en || c.slug_ar : c.slug_ar || c.slug_en)}`,
    })),
    { label: name },
  ];

  return (
    <div className="flex flex-col gap-4">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd([
          breadcrumbLd(lang === "en" ? "en" : "ar", crumbs.map((c) => ({ name: c.label, path: c.href }))),
          {
            "@context": "https://schema.org",
            "@type": "ItemList",
            name,
            numberOfItems: data.result.total,
            itemListElement: data.result.items.slice(0, 20).map((item, index) => ({
              "@type": "ListItem",
              position: index + 1,
              name: lang === "ar" ? item.name_ar : item.name_en,
              url: `${siteUrl()}/${lang}/product/${encodeURIComponent(lang === "ar" ? item.slug_ar : item.slug_en)}`,
            })),
          },
        ])}
      />
      <Listing
        lang={lang}
        result={data.result}
        defs={data.scope.defs}
        state={data.state}
        basePath={`/${lang}/category/${encodeURIComponent(catSlug)}`}
        crumbs={crumbs}
        title={name}
        hideCategoryFacet
        wishedIds={data.wishedIds}
        description={description || undefined}
        intro={children.length > 0 || adBanners.length > 0 ? (
          <div className="flex flex-col gap-3">
          {adBanners.map((b) => (
            <a key={b.id} href={b.link_url || undefined} onClick={() => sendAdEvent(b.id, "click")}
              className="block overflow-hidden rounded-lg border border-border bg-surface" aria-label={t("ads.sponsored")}>
              <FitBanner kind="category" src={`/api/media?path=${encodeURIComponent(b.image_path)}`} alt="" />
            </a>
          ))}
          {children.length > 0 ? (
          <nav aria-label={t("store.category.subcategories")}>
            <Carousel label={t("store.category.subcategories")} itemClassName="w-auto" gapClassName="gap-2">
              {children.map((child) => {
                const childName = lang === "ar" ? child.name_ar : child.name_en;
                return (
                  <Link
                    key={child.id}
                    to={`/${lang}/category/${encodeURIComponent(lang === "en" ? child.slug_en || child.slug_ar : child.slug_ar || child.slug_en)}`}
                    className="flex h-11 items-center gap-2 whitespace-nowrap rounded-full border border-border bg-surface ps-1.5 pe-4 text-sm font-bold text-text transition-colors duration-150 hover:border-action hover:text-action"
                  >
                    {child.thumb_path ? (
                      <MediaImg path={child.thumb_path} alt="" width={32} height={32} className="size-8 rounded-full object-cover" />
                    ) : (
                      <span className="flex size-8 items-center justify-center rounded-full bg-surface-tint text-action">
                        <CategoryIcon icon={child.icon} className="size-4" />
                      </span>
                    )}
                    {childName}
                  </Link>
                );
              })}
            </Carousel>
          </nav>
          ) : null}
          </div>
        ) : undefined}
      />
    </div>
  );
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonPage />;
}

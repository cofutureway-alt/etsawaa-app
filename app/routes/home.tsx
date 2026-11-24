import { FitBanner } from "~/components/catalog/FitBanner";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useRouteLoaderData } from "react-router";
import { getActiveAds, getAdProductCards, pinAds } from "~/features/ads/ads.server";
import { useAdImpressions } from "~/features/ads/ad-tracking";
import type { RootLoaderData } from "~/features/settings/api";
import { socialHref } from "~/components/layout/SocialLinks";
import type { Route } from "./+types/home";
import { useTranslation } from "react-i18next";
import { getI18n } from "~/lib/i18n/config";
import { requireLang } from "~/lib/lang.server";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { jsonLd, publicMeta, siteUrl } from "~/lib/seo";
import {
  getBanners, getBestProducts, getBestSellingProducts, getCategories, getDiscountedProducts, getRecentProducts, getTopRatedProducts,
  listBrands, listStores,
  type BannerRow, type BrandCard, type CategoryNode, type ProductCard as ProductCardRow,
  type StoreCard,
} from "~/features/storefront/api";
import { ProductCard } from "~/components/catalog/ProductCard";
import { featuredFirstShuffled, shuffled } from "~/features/storefront/shuffle";
import { placePicks } from "~/features/storefront/home-picks";
import { CategoryIcon } from "~/components/catalog/CategoryIcon";
import { HeroCategoryMenu, type MegaArt } from "~/components/catalog/HeroCategoryMenu";
import { Carousel } from "~/components/ui/Carousel";
import { VendorCard } from "~/components/catalog/VendorCard";
import { RecentStrip } from "~/components/catalog/RecentStrip";
import { MediaImg } from "~/components/catalog/MediaImg";
import { SkeletonPage } from "~/components/ui/Skeleton";
import { getViewer } from "~/lib/auth/guards";

import {
  ChevronLeftIcon, ChevronRightIcon, ReceiptIcon,
  RotateIcon, ShieldIcon, TagIcon, TruckIcon,
} from "~/components/ui/icons";

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  const empty = {
    lang,
    banners: [] as BannerRow[],
    categories: [] as CategoryNode[],
    best: [] as ProductCardRow[],
    brands: [] as BrandCard[],
    stores: [] as StoreCard[],
    recent: [] as ProductCardRow[],
    bestSelling: [] as ProductCardRow[],
    topRated: [] as ProductCardRow[],
    discounts: [] as ProductCardRow[],
    previewBannerId: null as string | null,
    viewerId: null as string | null,
    adCampaigns: [] as string[],
  };
  if (!client) return empty;
  // A DB failure must surface as an error page, not an empty-looking storefront
  // (the old .catch(() => []) made an outage indistinguishable from no products).
  // one parallel round for every section AND the session (the session check
  // used to run after all of them); the category tree is shared with the
  // public layout loader of this same request (getCategories is request-scoped)
  const [banners, categories, bestRaw, brands, storesRaw, recentRaw, bestSellingRaw, topRatedRaw, discountsRaw, viewerRes, homeAds, megaRes, picksRes] = await Promise.all([
    getBanners(client),
    getCategories(client, { maxDepth: 3 }),
    // A wider pool then a server-side shuffle: different order per visit,
    // featured products still first, and SSR/hydration agree (no client shuffle).
    getBestProducts(client, 40).then((rows) => featuredFirstShuffled(rows).slice(0, 20)),
    // 32, not 16: two rows per slide need about twice the logos to stay full
    listBrands(client, 48),
    // featured / ad-promoted stores first (listStores orders by is_featured)
    listStores(client).then((rows) => rows.slice(0, 20)),
    getRecentProducts(client, 40).then((rows) => shuffled(rows).slice(0, 20)),
    getBestSellingProducts(client, 40).then((rows) => shuffled(rows).slice(0, 16)),
    getTopRatedProducts(client, 40).then((rows) => shuffled(rows).slice(0, 16)),
    getDiscountedProducts(client, 40).then((rows) => shuffled(rows).slice(0, 20)),
    getViewer(client),
    // paid placements: products first in a home section, stores first among stores
    getActiveAds(client, ["home_section", "offer_campaign", "featured_store", "store_spotlight"]),
    // admin art drawn inside the hero mega menu panels
    client.from("mega_menu_art").select("category_id, image_path, mode, link_url").eq("is_active", true),
    // sections the admin placed products in while reviewing them (no ad package)
    client.from("v_active_home_picks").select("product_id, section").order("created_at", { ascending: false }),
  ]);
  const picks = (picksRes.data ?? []) as Array<{ product_id: string; section: string }>;
  const pickIds = (section: string) => picks.filter((x) => x.section === section).map((x) => x.product_id);
  const adCards = await getAdProductCards(client, [
    ...homeAds.filter((a) => a.placement === "home_section" || a.placement === "offer_campaign").map((a) => a.product_id ?? ""),
    ...picks.filter((x) => x.section !== "featured").map((x) => x.product_id),
  ]);
  const sectionAds = (code: string) => homeAds.filter((a) => a.placement === "home_section" && a.section === code);
  const pinned = {
    best: pinAds(bestRaw, sectionAds("best"), adCards, 20),
    recent: pinAds(recentRaw, sectionAds("recent"), adCards, 20),
    bestSelling: pinAds(bestSellingRaw, sectionAds("best_selling"), adCards, 16),
    topRated: pinAds(topRatedRaw, sectionAds("top_rated"), adCards, 16),
    // offer campaigns lead the Offers section — only while the product is still discounted
    discounts: pinAds(discountsRaw, [
      ...homeAds.filter((a) => a.placement === "offer_campaign" && a.product_id && (adCards.get(a.product_id)?.has_sale || (adCards.get(a.product_id)?.event_percent ?? 0) > 0)),
      ...sectionAds("discounts"),
    ], adCards, 20),
  };
  // admin picks follow the paid products and lead the rest of their section
  const withPicks = (x: { list: ProductCardRow[]; campaignOf: Record<string, string> }, section: string, max: number) =>
    placePicks(x.list, new Set(Object.keys(x.campaignOf)), pickIds(section), adCards, max);
  const best = withPicks(pinned.best, "best", 20), recent = withPicks(pinned.recent, "recent", 20),
    bestSelling = withPicks(pinned.bestSelling, "best_selling", 16), topRated = withPicks(pinned.topRated, "top_rated", 16),
    discounts = withPicks(pinned.discounts, "discounts", 20);
  // "Featured store" (spotlight) first, then "your store on the home page"
  const storeAds = [...homeAds.filter((a) => a.placement === "store_spotlight"), ...homeAds.filter((a) => a.placement === "featured_store")];
  const paidStores = new Set(storeAds.map((a) => a.vendor_id));
  const stores = [...storesRaw.filter((s) => paidStores.has(s.id)), ...storesRaw.filter((s) => !paidStores.has(s.id))];
  const adCampaigns = [...Object.values(pinned).flatMap((x) => Object.values(x.campaignOf)), ...storeAds.filter((a) => storesRaw.some((s) => s.id === a.vendor_id)).map((a) => a.id)];
  // warm the same-origin media cache with the LCP banner while the HTML
  // streams — the browser's image request lands on a hot cache
  const firstBanner = banners[0]?.image_path;
  if (firstBanner) {
    // server: warms the proxy cache; client (SPA nav): .server module is
    // stripped → warmMedia is optional-chained to a no-op
    void import("~/lib/media-cache.server").then((m) => m.warmMedia?.(firstBanner)).catch(() => undefined);
  }
  // RecentStrip needs the real viewer so signed-in users see the DB-backed
  // history, not the guest localStorage strip.
  const viewer = viewerRes?.viewer ?? null;
  // banner live preview (admin → "Preview on home"): an unpublished banner is
  // shown in place for whoever may manage banners
  const previewId = new URL(request.url).searchParams.get("bannerPreview")?.match(/^[0-9a-f-]{36}$/i)?.[0] ?? null;
  let previewBannerId: string | null = null;
  if (previewId && viewer) {
    const { data: allowed } = await client.rpc("has_permission", { p_permission: "banners.manage" });
    if (allowed === true) {
      const { data: row } = await client.from("banners")
        .select("id, title_ar, title_en, image_path, link_url, position, placement").eq("id", previewId).maybeSingle();
      if (row) {
        previewBannerId = row.id as string;
        if (!banners.some((b) => b.id === row.id)) banners.push(row as BannerRow);
      }
    }
  }
  return {
    lang, banners, categories, best, brands, stores, recent, bestSelling, topRated, discounts, previewBannerId,
    viewerId: viewer?.user.id ?? null,
    adCampaigns,
    megaArts: (megaRes.data ?? []) as MegaArt[],
  };
}

export const meta = ({ data }: Route.MetaArgs) => {
  const lang = (data?.lang as "ar" | "en") ?? "ar";
  const t = getI18n(lang).t;
  return publicMeta({
    lang,
    path: "/",
    title: t("home.metaTitle"),
    description: t("home.metaDescription"),
  });
};

const ASSURANCES = [
  { key: "clearCheckout", Icon: ShieldIcon },
  { key: "delivery", Icon: TruckIcon },
  { key: "seller", Icon: ReceiptIcon },
  { key: "returns", Icon: RotateIcon },
  { key: "offers", Icon: TagIcon },
];

/** Product carousels: exactly two cards per phone viewport with the default gap-3 (0.75rem). */
const PRODUCT_ITEM = "w-[calc((100%-0.75rem)/2)] sm:w-56";

/** Brand logos: fit an exact integer number of logos per viewport (3 on phones, 5 on sm, 7 on md, 8 on lg) with gap-2.5 (0.625rem) so the last logo is never clipped. */
const BRAND_ITEM = "w-[calc((100%-1.25rem)/3)] sm:w-[calc((100%-2.5rem)/5)] md:w-[calc((100%-3.75rem)/7)] lg:w-[calc((100%-4.375rem)/8)]";

/** Large-format fallback artwork used when the DB has no active banners yet;
 * DB banners take priority (owner artwork, not mock catalog data). */
const FALLBACK_BANNERS = [
  { src: "/promo-wide-1.webp", sm: "/promo-wide-1-sm.webp", xs: "/promo-wide-1-xs.webp", width: 1280, height: 720 },
  { src: "/promo-wide-3.webp", sm: "/promo-wide-3-sm.webp", width: 1280, height: 720 },
];

/**
 * Storefront home (S-01 / US-01): banners, categories strip, featured
 * vendors (border + mark), featured products, top-rated, active event,
 * "you viewed before". Every block hides when its data is empty.
 */
export default function Home({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const lang = loaderData.lang;
  // count one impression per paid placement shown
  useAdImpressions(loaderData.adCampaigns ?? []);
  // a hero banner opened in preview starts the carousel on itself; slides share
  // the tallest banner's height (h-full + object-cover) so a shorter one leaves no strip
  const initialSlide = Math.max(0, loaderData.banners.filter((b) => (b.placement ?? "hero") === "hero").findIndex((b) => b.id === loaderData.previewBannerId));
  const [slide, setSlide] = useState(initialSlide);
  const heroTrackRef = useRef<HTMLUListElement>(null);
  const heroBoxRef = useRef<HTMLElement>(null);
  const heroPausedRef = useRef(false);

  const dbBanners = loaderData.banners.filter((b) => (b.placement ?? "hero") === "hero");
  const placed = (spot: string) => loaderData.banners.filter((b) => b.placement === spot);
  const slot = (spot: string) => <PlacedBanners banners={placed(spot)} lang={lang} previewId={loaderData.previewBannerId} />;
  const slides = dbBanners.length > 0
    ? dbBanners.map((b) => ({ src: mediaPathUrl(b.image_path), sm: undefined as string | undefined, xs: undefined as string | undefined, width: 1280, height: 720, title: lang === "ar" ? b.title_ar || b.title_en : b.title_en || b.title_ar, link: b.link_url }))
    : FALLBACK_BANNERS.map((b) => ({ ...b, title: "", link: "" }));

  const goToSlide = useCallback((target: number, smooth = true) => {
    const el = heroTrackRef.current;
    const count = slides.length;
    if (count === 0) return;
    const nextIndex = ((target % count) + count) % count;
    setSlide(nextIndex);
    if (!el || el.clientWidth === 0) return;
    const rtl = getComputedStyle(el).direction === "rtl";
    const offset = nextIndex * el.clientWidth * (rtl ? -1 : 1);
    el.scrollTo({ left: offset, behavior: smooth ? "smooth" : "instant" }); // "auto" would follow the track's scroll-smooth class
  }, [slides.length]);

  const handleHeroScroll = useCallback(() => {
    const el = heroTrackRef.current;
    if (!el || el.clientWidth === 0) return;
    const idx = Math.round(Math.abs(el.scrollLeft) / el.clientWidth);
    setSlide(Math.max(0, Math.min(slides.length - 1, idx)));
  }, [slides.length]);

  useEffect(() => {
    if (initialSlide > 0) goToSlide(initialSlide, false);
  }, [initialSlide, goToSlide]);

  // rotate the hero every 6 s; pauses on hover, focus, or touch, and restarts on any move
  useEffect(() => {
    if (slides.length < 2) return;
    const box = heroBoxRef.current;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let timer = 0;

    const stop = () => {
      if (timer) window.clearTimeout(timer);
      timer = 0;
    };
    const schedule = () => {
      stop();
      if (heroPausedRef.current || reduced.matches || document.hidden) return;
      timer = window.setTimeout(() => {
        goToSlide(slide + 1);
      }, 6000);
    };

    // the pause lives in a ref: clicking an arrow/dot changes the slide and re-runs
    // this effect, and the carousel must stay paused while the pointer is still on it.
    // pointerenter/leave also cover touch (enter on touch start, leave on lift/cancel).
    const onPause = () => { heroPausedRef.current = true; stop(); };
    const onResume = () => { heroPausedRef.current = false; schedule(); };
    const onVis = () => { if (document.hidden) stop(); else schedule(); };

    schedule();
    box?.addEventListener("pointerenter", onPause);
    box?.addEventListener("pointerleave", onResume);
    document.addEventListener("visibilitychange", onVis);
    reduced.addEventListener("change", schedule);

    return () => {
      stop();
      box?.removeEventListener("pointerenter", onPause);
      box?.removeEventListener("pointerleave", onResume);
      document.removeEventListener("visibilitychange", onVis);
      reduced.removeEventListener("change", schedule);
    };
  }, [slide, slides.length, goToSlide]);

  const level1 = loaderData.categories.filter((c) => c.depth === 1);
  // two brand logos per slide (stacked) on every width
  const brandThumbs = loaderData.brands.filter((brand) => brand.thumb_path);
  const brandPairs: BrandCard[][] = [];
  for (let i = 0; i < brandThumbs.length; i += 2) brandPairs.push(brandThumbs.slice(i, i + 2));
  const root = useRouteLoaderData("root") as RootLoaderData | undefined;
  const contact = root?.contact;
  const socialUrls = Object.entries(root?.social ?? {})
    .filter(([k, v]) => Boolean(v) && k !== "whatsapp")
    .map(([k, v]) => socialHref(k, v as string));
  const viewAll = (to: string) => (
    <Link
      to={`/${lang}${to}`}
      className="inline-flex items-center gap-1 text-sm font-bold text-action hover:underline"
    >
      {t("home.sections.viewAll")}
      <ChevronRightIcon aria-hidden="true" className="mirr" />
    </Link>
  );

  // Preload the actual LCP element — the FIRST hero image only, so no
  // competing high-priority download steals the mobile pipe (two parallel
  // high-priority images cost ~+1s on the LCP at 1.6Mbps). DB banner when
  // present, fallback artwork otherwise. React 19 hoists this <link> into
  // <head> at head-parse time.
  const heroPreload = dbBanners.length > 0
    ? <link rel="preload" as="image" href={mediaPathUrl(dbBanners[0]!.image_path)} fetchPriority="high" />
    : <link rel="preload" as="image" href="/promo-wide-1.webp" imageSrcSet="/promo-wide-1-sm.webp 800w, /promo-wide-1.webp 1280w" imageSizes="(min-width: 1100px) 910px, 100vw" fetchPriority="high" />;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="sr-only">{t("home.metaTitle")}</h1>
      {heroPreload}
      {/* JSON-LD: Organization + WebSite search (AGENT §11) */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd([
          {
            "@context": "https://schema.org",
            "@type": "OnlineStore",
            "@id": `${siteUrl()}/#organization`,
            name: t("app.name"),
            // every way people type the brand (with / without the hamza, Latin, the domain)
            alternateName: ["اتسوء", "إتسوء", "Etsawaa", "etsawaa.com"],
            url: `${siteUrl()}/${lang}`,
            logo: { "@type": "ImageObject", url: `${siteUrl()}/logo-mark.png` },
            image: `${siteUrl()}/og-default.jpg`,
            description: t("home.metaDescription"),
            areaServed: { "@type": "Country", name: "Egypt" },
            currenciesAccepted: "EGP",
            paymentAccepted: lang === "ar" ? "الدفع عند الاستلام، بطاقات بنكية، محافظ إلكترونية" : "Cash on delivery, cards, mobile wallets",
            ...(socialUrls.length ? { sameAs: socialUrls } : {}),
            ...(contact?.email || contact?.phone
              ? { contactPoint: [{
                  "@type": "ContactPoint", contactType: "customer support", areaServed: "EG",
                  availableLanguage: ["Arabic", "English"],
                  ...(contact.email ? { email: contact.email } : {}),
                  ...(contact.phone ? { telephone: contact.phone } : {}),
                }] }
              : {}),
          },
          {
            "@context": "https://schema.org",
            "@type": "WebSite",
            "@id": `${siteUrl()}/#website`,
            name: t("app.name"),
            alternateName: ["اتسوء", "Etsawaa", "etsawaa.com"],
            inLanguage: lang === "ar" ? "ar-EG" : "en",
            publisher: { "@id": `${siteUrl()}/#organization` },
            url: `${siteUrl()}/${lang}`,
            potentialAction: {
              "@type": "SearchAction",
              target: `${siteUrl()}/${lang}/search?q={search_term_string}`,
              "query-input": "required name=search_term_string",
            },
          },
        ])}
      />

      {/* Reference hero band: categories panel beside the banner carousel */}
      <div className="relative grid gap-2 min-[1100px]:grid-cols-[250px_minmax(0,1fr)]">
        <HeroCategoryMenu lang={lang} categories={loaderData.categories} arts={"megaArts" in loaderData ? loaderData.megaArts : []} />

        <section ref={heroBoxRef} aria-label={t("home.sections.deals")} className="relative">
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            <ul
              ref={heroTrackRef}
              onScroll={handleHeroScroll}
              className="flex snap-x snap-mandatory overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {slides.map((item, idx) => (
                <li key={`${item.src}-${idx}`} className="w-full shrink-0 snap-start">
                  <HeroLink href={item.link} label={item.title} lang={lang}>
                    <FitBanner
                      kind="hero"
                      src={item.src}
                      srcSet={
                        "xs" in item && item.xs
                          ? `${item.xs} 480w, ${item.sm ?? ""} 800w, ${item.src} 1280w`
                          : "sm" in item && item.sm
                            ? `${item.sm} 800w, ${item.src} 1280w`
                            : undefined
                      }
                      sizes="(min-width: 1100px) 910px, 100vw"
                      alt={item.title || ""}
                      eager={idx === 0}
                    />
                  </HeroLink>
                </li>
              ))}
            </ul>
          </div>
          {slides.length > 1 ? (
            <>
              <button
                type="button"
                onClick={() => goToSlide(slide - 1)}
                aria-label={t("common.back")}
                className="absolute start-3 top-1/2 flex size-9.5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-surface/90 text-text shadow-1 transition-colors duration-150 hover:text-action"
              >
                <ChevronLeftIcon aria-hidden="true" className="mirr" />
              </button>
              <button
                type="button"
                onClick={() => goToSlide(slide + 1)}
                aria-label={t("common.next")}
                className="absolute end-3 top-1/2 flex size-9.5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-surface/90 text-text shadow-1 transition-colors duration-150 hover:text-action"
              >
                <ChevronRightIcon aria-hidden="true" className="mirr" />
              </button>
              <div className="absolute inset-x-0 bottom-3 flex justify-center gap-1.5">
                {slides.map((banner, index) => (
                  <button
                    key={`${banner.src}-${index}`}
                    type="button"
                    onClick={() => goToSlide(index)}
                    aria-label={`${index + 1}`}
                    aria-current={index === slide}
                    className="group flex size-6 cursor-pointer items-center justify-center"
                  >
                    <span className={`h-2 rounded-full border border-black/10 transition-all duration-200 ${
                      index === slide ? "w-6 bg-surface" : "w-2 bg-surface/60 group-hover:bg-surface"
                    }`} />
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </section>
      </div>

      {/* Assurance strip — first band under the hero, tablet/desktop only (hidden
          on phones at the owner's request). */}
      <ul className="hidden md:grid md:grid-cols-5 md:gap-2 md:overflow-visible md:pb-0">
        {ASSURANCES.map(({ key, Icon }) => (
          <li
            key={key}
            className="flex shrink-0 snap-start items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-2.5 md:shrink"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-tint text-action md:size-9">
              <Icon aria-hidden="true" className="text-lg" />
            </span>
            <span className="min-w-0">
              <b className="block whitespace-nowrap text-xs font-extrabold text-text md:whitespace-normal">{t(`home.assure.${key}`)}</b>
              <small className="hidden text-2xs leading-snug text-text-muted md:block">
                {t(`home.assure.${key}Note`)}
              </small>
            </span>
          </li>
        ))}
      </ul>

      {/* Brands: logos only, the first band under the hero */}
      {loaderData.brands.length > 0 ? (
        <section aria-label={t("nav.brands")} className="flex flex-col gap-3">
          <SectionHead title={t("home.sections.brands")} action={viewAll("/brands")} />
          {/* every width: two stacked rows, one pair per slide */}
          <Carousel label={t("nav.brands")} itemClassName={BRAND_ITEM} gapClassName="gap-2.5" autoplay={4500}>
            {brandPairs.map((pair) => (
              <div key={pair[0]!.id} className="flex flex-col gap-2.5">
                {pair.map((brand) => <BrandTile key={brand.id} brand={brand} lang={lang} />)}
              </div>
            ))}
          </Carousel>
        </section>
      ) : null}
      {slot("after_brands")}

      {/* All categories — image cards in a carousel (icons belong to the hero panel / menu) */}
      {level1.length > 0 ? (
        <section aria-label={t("home.cats.title")} className="flex flex-col gap-3">
          <SectionHead title={t("home.cats.title")} action={viewAll("/products")} />
          <Carousel label={t("home.cats.title")} itemClassName="w-36 sm:w-44 lg:w-48" autoplay={4500}>
            {level1.map((cat) => {
              const name = lang === "ar" ? cat.name_ar : cat.name_en;
              return (
                <Link
                  key={cat.id}
                  to={`/${lang}/category/${encodeURIComponent(lang === "en" ? cat.slug_en || cat.slug_ar : cat.slug_ar || cat.slug_en)}`}
                  className="group flex flex-col gap-2"
                >
                  <span className="relative block aspect-square overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-surface-tint to-surface shadow-1 transition-shadow duration-200 group-hover:shadow-2">
                    {cat.thumb_path ? (
                      <MediaImg path={cat.thumb_path} alt="" width={240} height={240}
                        className="size-full object-cover transition-transform duration-300 group-hover:scale-105" />
                    ) : (
                      <span className="flex size-full items-center justify-center text-action transition-transform duration-300 group-hover:scale-110">
                        <CategoryIcon icon={cat.icon} className="size-14" />
                      </span>
                    )}
                  </span>
                  <span className="line-clamp-2 text-center text-sm font-bold text-text transition-colors group-hover:text-action">{name}</span>
                </Link>
              );
            })}
          </Carousel>
        </section>
      ) : null}

      {slot("after_categories")}

      {/* Our best products: featured + promoted, topped up with regular ones */}
      {loaderData.best.length > 0 ? (
        <section aria-label={t("home.sections.best")} className="flex flex-col gap-3">
          <SectionHead title={t("home.sections.best")} action={viewAll("/products")} />
          <Carousel label={t("home.sections.best")} itemClassName={PRODUCT_ITEM} autoplay={4500}>
            {loaderData.best.map((card, index) => (
              <ProductCard key={card.id} card={card} lang={lang} eager={index < 2} />
            ))}
          </Carousel>
        </section>
      ) : null}

      {/* Deals: biggest sale discounts first */}
      {loaderData.discounts.length > 0 ? (
        <section aria-label={t("home.sections.discounts")} className="flex flex-col gap-3">
          <SectionHead title={t("home.sections.discounts")} action={viewAll("/products?sort=discount")} />
          <Carousel label={t("home.sections.discounts")} itemClassName={PRODUCT_ITEM} autoplay={4500}>
            {loaderData.discounts.map((card) => <ProductCard key={card.id} card={card} lang={lang} />)}
          </Carousel>
        </section>
      ) : null}

      {slot("after_best")}

      {/* Best selling (units sold) and top rated (real reviews) — hidden until there is data */}
      {loaderData.bestSelling.length > 0 ? (
        <section aria-label={t("home.sections.bestSellers")} className="flex flex-col gap-3">
          <SectionHead title={t("home.sections.bestSellers")} action={viewAll("/products?sort=best_selling")} />
          <Carousel label={t("home.sections.bestSellers")} itemClassName={PRODUCT_ITEM} autoplay={4500}>
            {loaderData.bestSelling.map((card) => <ProductCard key={card.id} card={card} lang={lang} />)}
          </Carousel>
        </section>
      ) : null}
      {slot("after_best_selling")}

      {loaderData.topRated.length > 0 ? (
        <section aria-label={t("home.sections.topRated")} className="flex flex-col gap-3">
          <SectionHead title={t("home.sections.topRated")} action={viewAll("/products?sort=rating")} />
          <Carousel label={t("home.sections.topRated")} itemClassName={PRODUCT_ITEM} autoplay={4500}>
            {loaderData.topRated.map((card) => <ProductCard key={card.id} card={card} lang={lang} />)}
          </Carousel>
        </section>
      ) : null}
      {slot("after_top_rated")}

      {/* Stores: featured/promoted first, then the rest */}
      {loaderData.stores.length > 0 ? (
        <section aria-label={t("home.sections.vendors")} className="flex flex-col gap-3">
          <SectionHead title={t("home.sections.vendors")} action={viewAll("/vendors")} />
          <Carousel label={t("home.sections.vendors")} itemClassName="w-64 sm:w-72" autoplay={4500}>
            {loaderData.stores.map((store) => <VendorCard key={store.id} store={store} lang={lang} />)}
          </Carousel>
        </section>
      ) : null}

      {slot("after_vendors")}

      {/* Recently added: newest 20, same product carousel as the rest */}
      {loaderData.recent.length > 0 ? (
        <section aria-label={t("home.sections.recent")} className="flex flex-col gap-3">
          <SectionHead title={t("home.sections.recent")} action={viewAll("/products")} />
          <Carousel label={t("home.sections.recent")} itemClassName={PRODUCT_ITEM} autoplay={4500}>
            {loaderData.recent.map((card) => <ProductCard key={card.id} card={card} lang={lang} />)}
          </Carousel>
        </section>
      ) : null}

      {slot("after_recent")}

      {/* You viewed before (guest localStorage / account DB) */}
      <RecentStrip lang={lang} viewerId={loaderData.viewerId} />

      {/* Bottom: admin banners placed at the end (managed in admin → banners) */}
      {slot("bottom")}
    </div>
  );
}

/** One brand logo tile — shared by the two-row phone strip and the md+ single row. */
function BrandTile({ brand, lang }: { brand: BrandCard; lang: string }) {
  const name = lang === "ar" ? brand.name_ar : brand.name_en;
  return (
    <Link to={`/${lang}/brand/${encodeURIComponent(lang === "en" ? brand.slug_en || brand.slug_ar : brand.slug_ar || brand.slug_en)}`}
      aria-label={name} title={name}
      className="relative block aspect-[3/2] overflow-hidden">
      {/* the logo fills the tile box and is contained in it, whatever the file's own size (a square logo used to spill out on iOS) */}
      <MediaImg path={brand.thumb_path!} alt={name} width={160} height={106} className="absolute inset-0 size-full p-1 !bg-transparent !object-contain mix-blend-multiply transition-transform duration-200 hover:scale-105" />
    </Link>
  );
}

function SectionHead({ title, action }: { title: string; action: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <h2 className="relative ps-3 text-lg font-extrabold text-text before:absolute before:inset-y-1 before:start-0 before:w-1 before:rounded-full before:bg-action sm:text-xl">{title}</h2>
      {action}
    </div>
  );
}

/** A banner's link: internal paths route client-side, absolute URLs open as plain links. */
function HeroLink({ href, label, lang, children }: { href: string; label: string; lang?: string; children: ReactNode }) {
  let target = href.trim();
  // an internal link saved with a language prefix follows the page language
  if (lang && /^\/(ar|en)(\/|$|\?|#)/.test(target)) target = `/${lang}${target.slice(3)}`;
  if (target.startsWith("/")) return <Link to={target} aria-label={label || undefined} className="block h-full">{children}</Link>;
  if (/^https?:\/\//i.test(target)) return <a href={target} aria-label={label || undefined} className="block h-full">{children}</a>;
  return <>{children}</>;
}

/** Admin banners placed between two home sections (stacked when several share a spot). */
function PlacedBanners({ banners, lang, previewId }: { banners: BannerRow[]; lang: string; previewId: string | null }) {
  if (banners.length === 0) return null;
  return (
    <>
      {banners.map((b) => {
        const title = lang === "ar" ? b.title_ar || b.title_en : b.title_en || b.title_ar;
        return (
          <section key={b.id} id={`banner-${b.id}`} aria-label={title || undefined}
            className={`relative overflow-hidden rounded-lg border bg-surface ${b.id === previewId ? "border-action ring-4 ring-action/30" : "border-border"}`}>
            {b.id === previewId ? (
              <span className="absolute start-2 top-2 z-10 rounded-full bg-action px-2.5 py-1 text-2xs font-black text-on-action">PREVIEW</span>
            ) : null}
            <HeroLink href={b.link_url} label={title} lang={lang}>
              <FitBanner kind="section" src={mediaPathUrl(b.image_path)} alt={title || ""} />
            </HeroLink>
          </section>
        );
      })}
    </>
  );
}

function mediaPathUrl(path: string): string {
  return `/api/media?path=${encodeURIComponent(path)}`;
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonPage />;
}

import { useState } from "react";
import { Link } from "react-router";
import type { Route } from "./+types/home";
import { useTranslation } from "react-i18next";
import { requireLang } from "~/lib/lang.server";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { jsonLd, publicMeta, siteUrl } from "~/lib/seo";
import {
  getActiveEvent, getBanners, getCategories, getFeaturedProducts, getFeaturedStores,
  getTopRatedProducts, type ActiveEvent, type BannerRow, type CategoryNode, type ProductCard,
  type StoreCard,
} from "~/features/storefront/api";
import { ProductGrid } from "~/components/catalog/ProductGrid";
import { VendorCard } from "~/components/catalog/VendorCard";
import { RecentStrip } from "~/components/catalog/RecentStrip";
import { MediaImg } from "~/components/catalog/MediaImg";
import { SkeletonPage } from "~/components/ui/Skeleton";
import { getViewer } from "~/lib/auth/guards";

import {
  ChevronLeftIcon, ChevronRightIcon, GridIcon, ReceiptIcon,
  RotateIcon, ShieldIcon, TagIcon, TruckIcon,
} from "~/components/ui/icons";

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  const empty = {
    lang,
    banners: [] as BannerRow[],
    categories: [] as CategoryNode[],
    featured: [] as ProductCard[],
    topRated: [] as ProductCard[],
    stores: [] as StoreCard[],
    event: null as ActiveEvent | null,
    viewerId: null as string | null,
  };
  if (!client) return empty;
  // A DB failure must surface as an error page, not an empty-looking storefront
  // (the old .catch(() => []) made an outage indistinguishable from no products).
  const [banners, categories, featured, topRated, stores, event] = await Promise.all([
    getBanners(client),
    getCategories(client),
    getFeaturedProducts(client),
    getTopRatedProducts(client),
    getFeaturedStores(client),
    getActiveEvent(client),
  ]);
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
  const { viewer } = (await getViewer(client)) ?? { viewer: null };
  return {
    lang, banners, categories, featured, topRated, stores, event,
    viewerId: viewer?.user.id ?? null,
  };
}

export const meta = ({ data }: Route.MetaArgs) => {
  const lang = (data?.lang as "ar" | "en") ?? "ar";
  return publicMeta({
    lang,
    path: "/",
    title: lang === "ar" ? "اتسوء — سوقك المصري متعدد البائعين" : "Etsawaa — Egypt's multi-vendor marketplace",
    description:
      lang === "ar"
        ? "تسوق من متاجر مصرية موثوقة: منتجات حقيقية، أسعار واضحة، توصيل لكل المحافظات، دفع عند الاستلام أو إلكتروني."
        : "Shop from vetted Egyptian stores: real products, clear prices, delivery to every governorate, COD or online payment.",
  });
};

const ASSURANCES = [
  { key: "clearCheckout", Icon: ShieldIcon },
  { key: "delivery", Icon: TruckIcon },
  { key: "seller", Icon: ReceiptIcon },
  { key: "returns", Icon: RotateIcon },
  { key: "offers", Icon: TagIcon },
];

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
  const [slide, setSlide] = useState(0);

  const dbBanners = loaderData.banners;
  const slides = dbBanners.length > 0
    ? dbBanners.map((b) => ({ src: mediaPathUrl(b.image_path), sm: undefined as string | undefined, xs: undefined as string | undefined, width: 1280, height: 720, title: lang === "ar" ? b.title_ar || b.title_en : b.title_en || b.title_ar, link: b.link_url }))
    : FALLBACK_BANNERS.map((b) => ({ ...b, title: "", link: "" }));
  const current = slides[slide] ?? slides[0]!;

  const level1 = loaderData.categories.filter((c) => c.depth === 1);
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
      {heroPreload}
      {/* JSON-LD: Organization + WebSite search (AGENT §11) */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd([
          {
            "@context": "https://schema.org",
            "@type": "Organization",
            name: lang === "ar" ? "اتسوء" : "Etsawaa",
            url: `${siteUrl()}/${lang}`,
            logo: `${siteUrl()}/logo-mark.webp`,
          },
          {
            "@context": "https://schema.org",
            "@type": "WebSite",
            name: lang === "ar" ? "اتسوء" : "Etsawaa",
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
      <div className="grid gap-2 min-[1100px]:grid-cols-[250px_minmax(0,1fr)]">
        <aside
          aria-label={t("home.cats.title")}
          className="hidden self-stretch rounded-lg border border-border bg-surface min-[1100px]:flex min-[1100px]:flex-col"
        >
          <div className="flex items-center gap-2 bg-action px-3.5 py-2.5 text-sm font-extrabold text-on-action">
            <GridIcon aria-hidden="true" className="size-4" />
            <span>{t("home.cats.title")}</span>
          </div>
          {level1.length > 0 ? (
            <ul className="flex-1 overflow-y-auto py-1">
              {level1.slice(0, 12).map((cat) => (
                <li key={cat.id}>
                  <Link
                    to={`/${lang}/category/${encodeURIComponent(lang === "en" ? cat.slug_en || cat.slug_ar : cat.slug_ar || cat.slug_en)}`}
                    className="flex min-h-9 items-center px-3.5 text-sm font-semibold text-text transition-colors duration-150 hover:bg-surface-tint hover:text-action"
                  >
                    {lang === "ar" ? cat.name_ar : cat.name_en}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3.5 py-3 text-xs text-text-muted">{t("home.cats.empty")}</p>
          )}
        </aside>

        <section aria-label={t("home.sections.deals")} className="relative">
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            <img
              key={current.src}
              src={current.src}
              srcSet={
                "xs" in current && current.xs
                  ? `${current.xs} 480w, ${current.sm ?? ""} 800w, ${current.src} 1280w`
                  : "sm" in current && current.sm
                    ? `${current.sm} 800w, ${current.src} 1280w`
                    : undefined
              }
              sizes="(min-width: 1100px) 910px, 100vw"
              width={current.width}
              height={current.height}
              alt={current.title || ""}
              className="block h-auto w-full"
              loading={slide === 0 ? "eager" : "lazy"}
              fetchPriority={slide === 0 ? "high" : "auto"}
            />
          </div>
          {slides.length > 1 ? (
            <>
              <button
                type="button"
                onClick={() => setSlide((index) => (index - 1 + slides.length) % slides.length)}
                aria-label={t("common.back")}
                className="absolute start-3 top-1/2 flex size-9.5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-surface/90 text-text shadow-1 transition-colors duration-150 hover:text-action"
              >
                <ChevronLeftIcon aria-hidden="true" className="mirr" />
              </button>
              <button
                type="button"
                onClick={() => setSlide((index) => (index + 1) % slides.length)}
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
                    onClick={() => setSlide(index)}
                    aria-label={`${index + 1}`}
                    aria-current={index === slide}
                    className={`h-2 cursor-pointer rounded-full border border-black/10 transition-all duration-200 ${
                      index === slide ? "w-6 bg-surface" : "w-2 bg-surface/60 hover:bg-surface"
                    }`}
                  />
                ))}
              </div>
            </>
          ) : null}
        </section>
      </div>

      {/* Assurance strip */}
      <ul className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        {ASSURANCES.map(({ key, Icon }, index) => (
          <li
            key={key}
            className={`flex items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-2.5 ${
              index === ASSURANCES.length - 1 ? "col-span-2 lg:col-span-1" : ""
            }`}
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-tint text-action">
              <Icon aria-hidden="true" className="text-lg" />
            </span>
            <span className="min-w-0">
              <b className="block text-[12.5px] font-extrabold text-text">{t(`home.assure.${key}`)}</b>
              <small className="block text-2xs leading-snug text-text-muted">
                {t(`home.assure.${key}Note`)}
              </small>
            </span>
          </li>
        ))}
      </ul>

      {/* Active event block (US-01: only when an event is live) */}
      {loaderData.event ? (
        <section
          aria-label={lang === "ar" ? loaderData.event.name_ar : loaderData.event.name_en}
          className="rounded-lg border-2 border-action bg-surface p-5"
        >
          <p className="text-2xs font-extrabold uppercase tracking-wide text-action">{t("home.event.badge")}</p>
          <h2 className="mt-1 text-lg font-black text-text">
            {lang === "ar" ? loaderData.event.name_ar : loaderData.event.name_en}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-text-muted">
            {lang === "ar" ? loaderData.event.desc_ar : loaderData.event.desc_en}
          </p>
          <Link
            to={`/${lang}/products`}
            className="mt-3 inline-flex min-h-10 items-center rounded-md bg-action px-4 text-sm font-extrabold text-on-action transition-colors duration-150 hover:bg-action-hover"
          >
            {t("home.event.cta")}
          </Link>
        </section>
      ) : null}

      {/* Categories strip */}
      {level1.length > 0 ? (
        <section aria-label={t("home.cats.title")} className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-extrabold text-text">{t("home.cats.title")}</h2>
            {viewAll("/products")}
          </div>
          <ul className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 lg:grid-cols-6">
            {level1.slice(0, 12).map((cat) => (
              <li key={cat.id}>
                <Link
                  to={`/${lang}/category/${encodeURIComponent(lang === "en" ? cat.slug_en || cat.slug_ar : cat.slug_ar || cat.slug_en)}`}
                  className="flex flex-col items-center gap-2 rounded-lg border border-border bg-surface p-3 text-center transition-colors duration-150 hover:bg-surface-tint"
                >
                  {cat.thumb_path ? (
                    <MediaImg path={cat.thumb_path} alt={lang === "ar" ? cat.name_ar : cat.name_en} width={64} height={64} className="size-14 rounded-md" />
                  ) : (
                    <span className="flex size-14 items-center justify-center rounded-md bg-surface-tint text-lg font-black text-action">
                      {(lang === "ar" ? cat.name_ar : cat.name_en).slice(0, 1)}
                    </span>
                  )}
                  <span className="line-clamp-2 text-xs font-bold text-text">
                    {lang === "ar" ? cat.name_ar : cat.name_en}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Featured vendors (border + mark) */}
      {loaderData.stores.length > 0 ? (
        <section aria-label={t("home.sections.vendors")} className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-extrabold text-text">{t("home.sections.vendors")}</h2>
            {viewAll("/vendors")}
          </div>
          <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
            {loaderData.stores.slice(0, 4).map((store) => (
              <li key={store.id} className="min-w-0">
                <VendorCard store={store} lang={lang} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Featured products */}
      {loaderData.featured.length > 0 ? (
        <section aria-label={t("home.sections.featured")} className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-extrabold text-text">{t("home.sections.featured")}</h2>
            {viewAll("/products")}
          </div>
          <ProductGrid cards={loaderData.featured.slice(0, 8)} lang={lang} eagerFirst={4} />
        </section>
      ) : null}

      {/* Top-rated */}
      {loaderData.topRated.length > 0 ? (
        <section aria-label={t("home.sections.bestSellers")} className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-extrabold text-text">{t("home.sections.topRated")}</h2>
            {viewAll("/products")}
          </div>
          <ProductGrid cards={loaderData.topRated.slice(0, 8)} lang={lang} />
        </section>
      ) : null}

      {/* You viewed before (guest localStorage / account DB) */}
      <RecentStrip lang={lang} viewerId={loaderData.viewerId} />

      {/* The odd-sized banner sits alone as the final section above the footer */}
      <section
        aria-label={t("home.promo.title")}
        className="overflow-hidden rounded-lg border border-border bg-surface"
      >
        <img
          src="/promo-wide-2.webp"
          width={1600}
          height={686}
          alt=""
          loading="lazy"
          className="block h-auto w-full"
        />
      </section>
    </div>
  );
}

function mediaPathUrl(path: string): string {
  return `/api/media?path=${encodeURIComponent(path)}`;
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonPage />;
}

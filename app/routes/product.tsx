import { useCallback, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import type { Route } from "./+types/product";
import { useTranslation } from "react-i18next";
import { getI18n } from "~/lib/i18n/config";
import { requireLang } from "~/lib/lang.server";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { absoluteMediaUrl, breadcrumbLd, jsonLd, publicMeta, siteUrl } from "~/lib/seo";
import { htmlToText } from "~/lib/sanitize";
import { formatPiastres } from "~/lib/money";
import { getProductPage, getStoreProducts } from "~/features/storefront/api";
import { getRelatedProductsWide } from "~/features/storefront/related";
import { getActiveAds, getAdProductCards, pickRandom } from "~/features/ads/ads.server";
import { sendAdEvent, useAdImpressions } from "~/features/ads/ad-tracking";
import { ProductAdCarousel, type ProductPageBanner } from "~/components/catalog/ProductAdCarousel";
import { toggleCompare } from "~/features/discovery/compare";
import { getViewer } from "~/lib/auth/guards";
import { Tabs } from "~/components/ui/Tabs";
import { Rating } from "~/components/ui/Rating";
import { EmptyState } from "~/components/ui/EmptyState";
import { Breadcrumbs } from "~/components/ui/Breadcrumbs";
import { useToast } from "~/components/ui/Toast";
import { CartIcon, CompareArrowsIcon, ShieldIcon, StarIcon, StoreIcon, TruckIcon } from "~/components/ui/icons";
import { Gallery, type GalleryItem } from "~/components/catalog/Gallery";
import { BuyBox } from "~/components/catalog/BuyBox";
import { ProductDetails } from "~/components/catalog/ProductDetails";
import { ProductCard } from "~/components/catalog/ProductCard";
import { MediaImg, mediaUrl } from "~/components/catalog/MediaImg";
import { RecentStrip, useRecordView } from "~/components/catalog/RecentStrip";
import { WishlistHeart } from "~/components/catalog/WishlistHeart";
import { SkeletonPage } from "~/components/ui/Skeleton";
import { Carousel } from "~/components/ui/Carousel";
import { ReviewPrompt } from "~/components/catalog/ReviewPrompt";
import { ReviewMediaThumbs } from "~/components/catalog/ReviewMediaPicker";
import { SizeGuideButton } from "~/components/catalog/SizeGuide";
import { data } from "react-router";
import { parseReviewMedia } from "~/lib/review-media";


/**
 * Product page (S-05 / US-05): gallery per variant, variant selector that
 * disables impossible combos, price/sale/schedule, specs table, reviews
 * tab, vendor card, related products, sticky mobile buy bar, wishlist,
 * compare, recently-viewed recording. URL ?v= keeps the selection
 * shareable. Unpublished/hidden products 404 (view guarantees it).
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw new Response("Not Found", { status: 404 });
  const slug = decodeURIComponent(params.slug ?? "");
  // round A: the product and the session in parallel (the session used to be
  // checked only after the whole product had loaded)
  const [page, viewerRes] = await Promise.all([getProductPage(client, slug), getViewer(client)]);
  if (!page) throw new Response("Not Found", { status: 404 });
  const viewer = viewerRes?.viewer ?? null;

  const url = new URL(request.url);
  const requestedKey = url.searchParams.get("v");
  // round B: carousels, the viewer's hearts and the review prompt — one batch
  // (the review check used to be its own round after the carousels)
  const noRows = Promise.resolve({ data: null, error: null });
  const [relatedRaw, moreFromStore, wishedRows, deliveredLines, myReviews] = await Promise.all([
    // 40, not 16: the strip drops the cards already shown in "more from this store"
    getRelatedProductsWide(client, page.card.id, 40).catch(() => []),
    getStoreProducts(client, page.card.vendor_id)
      .then((rows) => rows.filter((r) => r.id !== page.card.id && r.is_listable).slice(0, 16))
      .catch(() => []),
    viewer
      ? client.from("wishlist_items").select("product_id").eq("user_id", viewer.user.id).limit(500)
      : noRows,
    // post-purchase review prompt: a delivered line of this product, never reviewed
    viewer
      ? client.from("order_items").select("id, orders!inner(user_id, delivered_at)")
          .eq("product_id", page.card.id).eq("orders.user_id", viewer.user.id).not("orders.delivered_at", "is", null).limit(1)
      : noRows,
    viewer
      ? client.from("reviews").select("id").eq("product_id", page.card.id).eq("customer_id", viewer.user.id).limit(1)
      : noRows,
  ]);
  const wishedIds = new Set(((wishedRows.data ?? []) as Array<{ product_id: string }>).map((r) => r.product_id));
  // "similar" must not repeat the cards already shown in "more from this store"
  const storeIds = new Set(moreFromStore.map((r) => r.id));
  const related = relatedRaw.filter((r) => !storeIds.has(r.id)).slice(0, 16);
  // warm the same-origin media cache with the LCP image while the page renders
  const firstImage = page.media.find((m) => m.kind === "image")?.path;
  if (firstImage) void import("~/lib/media-cache.server").then((m) => m.warmMedia(firstImage)).catch(() => undefined);
  const lines = (deliveredLines.data ?? []) as Array<{ id: string }>;
  const reviewItemId = lines.length > 0 && ((myReviews.data ?? []) as unknown[]).length === 0 ? lines[0]!.id : null;
  // in-product-page ads: other stores' products of the same main category,
  // shown as "Sponsored" (up to 2, random; paid per impression)
  const sponsored: Array<{ campaign: string; card: (typeof related)[number] }> = [];
  const pageAds = (await getActiveAds(client, ["product_page"])).filter((a) => a.product_id && a.product_id !== page.card.id && a.vendor_id !== page.card.vendor_id);
  if (pageAds.length) {
    const cards = await getAdProductCards(client, pageAds.map((a) => a.product_id ?? ""));
    const leafIds = [...new Set([page.card.leaf_category_id, ...[...cards.values()].map((c) => c.leaf_category_id)].filter((x): x is string => Boolean(x)))];
    const { data: paths } = await client.from("categories").select("id, path").in("id", leafIds);
    const rootOf = new Map(((paths ?? []) as Array<{ id: string; path: string }>).map((c) => [c.id, c.path.split("/")[0]]));
    const myRoot = page.card.leaf_category_id ? rootOf.get(page.card.leaf_category_id) : undefined;
    const fits = pageAds.filter((a) => { const c = cards.get(a.product_id ?? ""); return c && c.leaf_category_id && rootOf.get(c.leaf_category_id) === myRoot; });
    for (const a of pickRandom(fits, 2)) sponsored.push({ campaign: a.id, card: cards.get(a.product_id ?? "")! });
  }
  // ad box under "Shipping details": banners placed on the product page; a paid
  // one (made when an ad order is approved) carries its campaign for counting
  const now = new Date().toISOString();
  const [{ data: bannerRows }, bannerAds] = await Promise.all([
    client.from("banners").select("id, title_ar, title_en, image_path, link_url, vendor_id")
      .eq("placement", "product_page").eq("is_active", true)
      .or(`starts_at.is.null,starts_at.lte.${now}`).or(`ends_at.is.null,ends_at.gte.${now}`).order("position").limit(8),
    getActiveAds(client, ["product_page"]).then((ads) => ads.filter((a) => !a.product_id)),
  ]);
  const pageBanners: ProductPageBanner[] = ((bannerRows ?? []) as Array<Omit<ProductPageBanner, "campaign"> & { vendor_id: string | null }>)
    .filter((b) => b.image_path)
    .map(({ vendor_id, ...b }) => ({ ...b, campaign: vendor_id ? bannerAds.find((a) => a.vendor_id === vendor_id)?.id ?? null : null }));
  return { lang, page, related, moreFromStore, wishedIds, requestedKey, viewerId: viewer?.user.id ?? null, slug, reviewItemId, sponsored, pageBanners };
}

/** The review prompt posts here (fn_submit_review checks ownership + delivery). */
export async function action({ request, params }: Route.ActionArgs) {
  requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  const form = await request.formData();
  if (String(form.get("intent")) !== "review") return data({ ok: false, reason: "bad_intent" }, { status: 400 });
  const { data: res, error } = await client.rpc("fn_submit_review", {
    p_order_item_id: String(form.get("order_item_id") ?? ""),
    p_rating: Number(form.get("rating") ?? 0),
    p_title: "",
    p_body: String(form.get("body") ?? ""),
    p_media: parseReviewMedia(form.get("media")),
  });
  if (error) return data({ ok: false, reason: "server_error" }, { status: 500 });
  const r = res as { ok: boolean; reason?: string };
  return r.ok ? { ok: true } : data({ ok: false, reason: r.reason }, { status: 400 });
}

export const meta = ({ data }: Route.MetaArgs) => {
  const lang = (data?.lang as "ar" | "en") ?? "ar";
  const t = getI18n(lang).t;
  const page = data?.page;
  if (!page) {
    return publicMeta({
      lang, path: "/product", title: `${t("product.metaNotFoundTitle")} — ${t("app.name")}`,
      description: t("product.metaNotFoundDescription"), noindex: true,
    });
  }
  const name = lang === "ar" ? page.card.name_ar || page.card.name_en : page.card.name_en || page.card.name_ar;
  const short = lang === "ar" ? page.card.short_ar || page.desc_ar : page.card.short_en || page.desc_en;
  const description = (htmlToText(short).replace(/\s+/g, " ") || name).slice(0, 160);
  const slug = lang === "ar" ? page.card.slug_ar || page.card.slug_en : page.card.slug_en || page.card.slug_ar;
  const otherSlug = lang === "ar" ? page.card.slug_en || page.card.slug_ar : page.card.slug_ar || page.card.slug_en;
  const img = page.card.main_image_path ?? page.media.find((m) => m.kind === "image")?.path ?? null;
  const price = ((page.card.event_price_piastres ?? page.card.min_price_piastres ?? 0) / 100).toFixed(2);
  const brand = lang === "ar" ? page.card.brand_name_ar || page.card.brand_name_en : page.card.brand_name_en || page.card.brand_name_ar;
  const category = lang === "ar" ? page.card.category_name_ar : page.card.category_name_en;
  const inStock = page.card.stock_total > 0;
  return publicMeta({
    lang,
    path: `/product/${encodeURIComponent(slug)}`,
    altPath: `/product/${encodeURIComponent(otherSlug)}`,
    title: `${name}${brand ? ` | ${brand}` : ""} — ${t("app.name")}`,
    description,
    ogType: "product",
    ogImage: img ? absoluteMediaUrl(img) : undefined,
    ogImageAlt: name,
    keywords: [name, brand ?? "", category ?? "", lang === "ar" ? `سعر ${name}` : `${name} price`, lang === "ar" ? `شراء ${name}` : `buy ${name}`],
    extra: [
      { property: "product:price:amount", content: price },
      { property: "product:price:currency", content: "EGP" },
      { property: "product:availability", content: inStock ? "in stock" : "out of stock" },
      ...(brand ? [{ property: "product:brand", content: brand }] : []),
    ],
    noindex: false,
  });
};

export default function ProductPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const lang = loaderData.lang;
  useAdImpressions([...(loaderData.sponsored ?? []).map((s) => s.campaign),
    ...(loaderData.pageBanners ?? []).map((b) => b.campaign).filter((c): c is string => Boolean(c))]);
  const page = loaderData.page;
  const card = page.card;
  const name = lang === "ar" ? card.name_ar || card.name_en : card.name_en || card.name_ar;
  const storeName = lang === "ar" ? card.store_name_ar || card.store_name_en : card.store_name_en || card.store_name_ar;
  const brandName = lang === "ar" ? page.brand_name_ar || page.brand_name_en : page.brand_name_en || page.brand_name_ar;
  const brandSlug = lang === "ar" ? page.brand_slug_ar || page.brand_slug_en : page.brand_slug_en || page.brand_slug_ar;

  /* ---- gallery: the picked colour's own photos, else the product's ------ */
  // one thumbnail per picture: the same file can be both the main photo and a colour's photo
  const videoItems: GalleryItem[] = page.media
    .filter((m, i, all) => m.kind === "video" && all.findIndex((x) => x.path === m.path) === i)
    .map((m) => ({ id: m.id, path: m.path, kind: "video" }));
  const baseImages: GalleryItem[] = [
    ...page.media
      .filter((m, i, all) => m.kind === "image" && all.findIndex((x) => x.path === m.path) === i)
      .map((m) => ({ id: m.id, path: m.path, kind: "image" as const })),
    ...videoItems,
  ];
  const [colorImages, setColorImages] = useState<string[] | null>(null);
  const [pickedImage, setPickedImage] = useState<string | null>(null);
  const onColorImages = useCallback((paths: string[] | null) => {
    setColorImages(paths);
    setPickedImage(null); // a colour change wins over an earlier thumbnail pick
  }, []);
  const colorItems: GalleryItem[] = [...new Set(colorImages ?? [])].map((path, i) => ({ id: `color-${i}`, path, kind: "image" }));
  const images: GalleryItem[] = colorImages ? [...colorItems, ...videoItems] : baseImages;
  const selectedImage = pickedImage ?? images[0]?.path ?? null;
  const onPickImage = (path: string) => setPickedImage(path);
  const outOfStock = card.stock_total <= 0;

  /* ---- recently viewed (S-22) -------------------------------------------- */
  useRecordView(card.id, loaderData.viewerId);

  /* ---- compare (S-21) ---------------------------------------------------- */
  const onCompare = () => {
    const res = toggleCompare(card.id);
    window.dispatchEvent(new CustomEvent("etsawaa:compare"));
    if (res.blocked) {
      toast.showToast("info", t("store.compare.limit"));
      return;
    }
    toast.showToast("success", t(res.added ? "store.compare.added" : "store.compare.removed"));
    if (res.ids.length >= 2) {
      void navigate(`/${lang}/compare?ids=${res.ids.join(",")}`);
    }
  };

  const crumbs = [
    { label: t("nav.home"), href: `/${lang}` },
    ...(card.category_slug_ar || card.category_slug_en
      ? [{
          label: lang === "ar" ? card.category_name_ar || "" : card.category_name_en || "",
          href: `/${lang}/category/${encodeURIComponent(lang === "en" ? card.category_slug_en || "" : card.category_slug_ar || "")}`,
        }]
      : []),
    { label: name },
  ];


  const ratingDist = useMemo(() => {
    const buckets = [5, 4, 3, 2, 1].map((star) => ({ star, count: page.reviews.filter((r) => Math.floor(r.rating) === star).length }));
    return buckets;
  }, [page.reviews]);

  const mainImage = page.media.find((m) => m.kind === "image");
  const lcpPreload = mainImage ? (
    <link rel="preload" as="image" href={mediaUrl(mainImage.path)} fetchPriority="high" />
  ) : null;

  return (
    <div className="flex flex-col gap-5 pb-28 md:pb-0">
      {lcpPreload}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd([
          breadcrumbLd(lang === "en" ? "en" : "ar", crumbs.map((c) => ({ name: c.label, path: c.href }))),
          {
            "@context": "https://schema.org",
            "@type": "Product",
            name,
            description: htmlToText(lang === "ar" ? page.desc_ar : page.desc_en).slice(0, 500) || undefined,
            image: page.media.filter((m) => m.kind === "image").slice(0, 6).map((m) => absoluteMediaUrl(m.path)),
            sku: page.variants[0]?.sku || card.id,
            url: `${siteUrl()}/${lang}/product/${encodeURIComponent(lang === "ar" ? card.slug_ar : card.slug_en)}`,
            category: (lang === "ar" ? card.category_name_ar : card.category_name_en) || undefined,
            brand: card.brand_name_ar || card.brand_name_en
              ? { "@type": "Brand", name: (lang === "ar" ? card.brand_name_ar || card.brand_name_en : card.brand_name_en || card.brand_name_ar) }
              : storeName
                ? { "@type": "Brand", name: storeName }
                : undefined,
            offers: {
              "@type": "Offer",
              priceCurrency: "EGP",
              price: ((card.event_price_piastres ?? card.min_price_piastres ?? 0) / 100).toFixed(2),
              availability: outOfStock ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
              url: `${siteUrl()}/${lang}/product/${encodeURIComponent(lang === "ar" ? card.slug_ar : card.slug_en)}`,
              itemCondition: "https://schema.org/NewCondition",
              priceValidUntil: (page.sale_ends_at ?? new Date(Date.now() + 30 * 86_400_000).toISOString()).slice(0, 10),
              seller: { "@type": "Organization", name: storeName },
              shippingDetails: {
                "@type": "OfferShippingDetails",
                shippingDestination: { "@type": "DefinedRegion", addressCountry: "EG" },
              },
              hasMerchantReturnPolicy: {
                "@type": "MerchantReturnPolicy",
                applicableCountry: "EG",
                returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
                merchantReturnDays: 14,
              },
            },
            ...(page.reviews.length > 0
              ? { review: page.reviews.slice(0, 5).map((r) => ({
                  "@type": "Review",
                  reviewRating: { "@type": "Rating", ratingValue: r.rating, bestRating: 5 },
                  author: { "@type": "Person", name: r.author_name || (lang === "ar" ? "عميل" : "Customer") },
                  ...(r.body ? { reviewBody: r.body.slice(0, 500) } : {}),
                })) }
              : {}),
            ...(card.rating_count > 0 && card.rating_avg != null
              ? { aggregateRating: { "@type": "AggregateRating", ratingValue: card.rating_avg, reviewCount: card.rating_count } }
              : {}),
          },
        ])}
      />

      <Breadcrumbs label={t("a11y.breadcrumbs")} items={crumbs} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,560px)_minmax(0,1fr)]">
        {/* gallery */}
        <div className="min-w-0">
          <Gallery images={images} selectedPath={selectedImage} alt={name} eager onSelect={onPickImage} />
        </div>

        {/* buy box */}
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
              <h1 className="min-w-0 text-xl font-black leading-snug text-text">{name}</h1>
              {card.rating_count > 0 && card.rating_avg != null ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-featured/60 bg-featured/15 px-2 py-0.5 text-xs font-black text-ink"
                  aria-label={t("store.product.ratingBadge", { value: card.rating_avg.toFixed(1), count: card.rating_count })}>
                  <Rating value={card.rating_avg} size="sm" />
                  <span className="num">{card.rating_avg.toFixed(1)}</span>
                  <span className="num font-bold text-text-muted">({card.rating_count})</span>
                </span>
              ) : (
                <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-2xs font-bold text-text-faint">{t("store.noReviews")}</span>
              )}
            </div>
            <WishlistHeart productId={card.id} initial={loaderData.wishedIds.has(card.id)} className="shrink-0" />
          </div>

          {brandName && brandSlug ? (
            <Link
              to={`/${lang}/brand/${encodeURIComponent(brandSlug)}`}
              className="flex w-fit items-center gap-2 text-sm font-extrabold text-action hover:underline"
            >
              {page.brand_thumb_path ? (
                <span className="relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-white p-1">
                  <MediaImg path={page.brand_thumb_path} alt="" width={32} height={32} className="absolute inset-0 size-full p-1 !bg-transparent !object-contain" />
                </span>
              ) : null}
              {t("store.product.brandLabel", { brand: brandName })}
            </Link>
          ) : null}

          {page.size_chart ? <SizeGuideButton chart={page.size_chart} lang={lang === "en" ? "en" : "ar"} /> : null}

          <div id="buy-box" className="scroll-mt-24">
          <BuyBox page={page} lang={lang === "en" ? "en" : "ar"} requestedKey={loaderData.requestedKey} onColorImages={onColorImages} />
          </div>

          <button
            type="button"
            onClick={onCompare}
            className="flex w-fit cursor-pointer items-center gap-2 rounded-md px-1 text-xs font-bold text-text-muted transition-colors hover:text-action"
          >
            <CompareArrowsIcon className="size-4" />
            {t("store.compare.add")}
          </button>

          {/* assurances */}
          <ul className="grid grid-cols-2 gap-2 text-xs font-bold text-text-muted">
            <li className="flex items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-2.5">
              <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-tint text-action">
                <TruckIcon />
              </span>
              <span className="min-w-0">{t("store.product.assureShipping")}</span>
            </li>
            <li className="flex items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-2.5">
              <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-tint text-action">
                <ShieldIcon />
              </span>
              <span className="min-w-0">{t("store.product.assureReturns")}</span>
            </li>
          </ul>

          {/* vendor card */}
          <Link
            to={`/${lang}/store/${encodeURIComponent(card.vendor_slug)}`}
            className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3 transition-colors duration-150 hover:bg-surface-tint"
          >
            {card.vendor_logo_path ? (
              <MediaImg path={card.vendor_logo_path} alt={storeName} width={56} height={56} className="size-12 rounded-full border border-border" />
            ) : (
              <span className="flex size-12 items-center justify-center rounded-full bg-surface-tint text-action">
                <StoreIcon className="size-5" />
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-extrabold text-text">{storeName}</span>
              <span className="flex items-center gap-2 text-2xs text-text-muted">
                {card.level_name_ar || card.level_name_en ? (
                  <span className="rounded-full border border-featured px-1.5 py-px font-extrabold text-ink">
                    {lang === "ar" ? card.level_name_ar : card.level_name_en}
                  </span>
                ) : null}
                {t("store.product.visitStore")}
              </span>
            </span>
          </Link>
        </div>
      </div>

      {/* tabs: description+specs / reviews */}
      <Tabs
        items={[
          {
            id: "specs",
            label: t("store.product.tabSpecs"),
            content: (
              <ProductDetails
                description={lang === "ar" ? page.desc_ar : page.desc_en}
                attributes={page.attributes}
                isFragile={page.is_fragile}
                weightG={page.weight_g}
                shippingMode={page.shipping_mode}
                aside={<ProductAdCarousel banners={loaderData.pageBanners ?? []} lang={lang} />}
                brand={(lang === "ar" ? card.brand_name_ar : card.brand_name_en) ?? null}
                category={(lang === "ar" ? card.category_name_ar : card.category_name_en) ?? null}
                lang={lang === "en" ? "en" : "ar"}
                skus={page.variants.map((v) => v.sku ?? "")}
                axes={page.axes.map((a) => ({
                  id: a.attribute_id,
                  label: lang === "ar" ? a.label_ar || a.label_en : a.label_en || a.label_ar,
                  // only options a live stock row actually carries
                  values: a.options.filter((o) => page.variants.some((v) => v.option_ids.includes(o.id)))
                    .map((o) => (lang === "ar" ? o.label_ar || o.label_en : o.label_en || o.label_ar)),
                }))}
              />
            ),
          },
          {
            id: "reviews",
            label: `${t("store.product.tabReviews")} (${page.reviews.length})`,
            content: page.reviews.length === 0 ? (
              <EmptyState title={t("store.reviews.emptyTitle")} body={t("store.reviews.emptyBody")} />
            ) : (
              <div className="flex flex-col gap-5">
                <div className="flex flex-wrap items-center gap-6 rounded-lg border border-border bg-surface p-4">
                  <div className="text-center">
                    <p className="num text-3xl font-black text-text">{card.rating_avg?.toFixed(1) ?? "—"}</p>
                    <Rating value={card.rating_avg ?? 0} size="sm" />
                    <p className="num mt-1 text-2xs text-text-muted">{t("store.reviews.count", { count: card.rating_count })}</p>
                  </div>
                  <ul className="min-w-0 flex-1">
                    {ratingDist.map((bucket) => (
                      <li key={bucket.star} className="flex items-center gap-2 text-xs">
                        <span className="num flex w-8 items-center gap-0.5 text-text-muted">{bucket.star}<StarIcon aria-hidden="true" className="size-3 text-featured" /></span>
                        <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-tint">
                          <span
                            className="block h-full bg-featured"
                            style={{ width: `${page.reviews.length > 0 ? (bucket.count / page.reviews.length) * 100 : 0}%` }}
                          />
                        </span>
                        <span className="num w-6 text-end text-text-muted">{bucket.count}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <ul className="flex flex-col gap-3">
                  {page.reviews.map((review) => (
                    <li key={review.id} className="rounded-lg border border-border bg-surface p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-extrabold text-text">{review.author_name}</span>
                        <Rating value={review.rating} size="sm" />
                      </div>
                      {review.title ? <p className="mt-1 text-sm font-bold text-text">{review.title}</p> : null}
                      {review.body ? <p className="mt-1 text-sm leading-relaxed text-text-muted">{review.body}</p> : null}
                      <ReviewMediaThumbs media={review.media ?? []} alt={review.author_name} />
                      <time dateTime={review.created_at} className="num mt-1.5 block text-2xs text-text-faint">
                        {new Date(review.created_at).toLocaleDateString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-EG")}
                      </time>
                    </li>
                  ))}
                </ul>
              </div>
            ),
          },
        ]}
      />

      {/* in-product-page ads */}
      {(loaderData.sponsored ?? []).length > 0 ? (
        <section aria-labelledby="sponsored-title" className="flex flex-col gap-3">
          <h2 id="sponsored-title" className="flex items-center gap-2 text-lg font-extrabold text-text">
            {t("ads.sponsoredTitle")}
            <span className="rounded-full border border-border px-2 py-0.5 text-2xs font-bold text-text-muted">{t("ads.sponsored")}</span>
          </h2>
          <ul className="grid grid-cols-2 gap-3 sm:max-w-xl">
            {(loaderData.sponsored ?? []).map((s) => (
              <li key={s.campaign} onClickCapture={() => sendAdEvent(s.campaign, "click")}>
                <ProductCard card={s.card} lang={lang} wished={loaderData.wishedIds.has(s.card.id)} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* related + more from store */}
      {loaderData.related.length > 0 ? (
        <section aria-labelledby="related-title" className="flex flex-col gap-3">
          <h2 id="related-title" className="relative ps-3 text-lg font-extrabold text-text before:absolute before:inset-y-1 before:start-0 before:w-1 before:rounded-full before:bg-action">
            {t("store.product.related")}
          </h2>
          <Carousel label={t("store.product.related")} itemClassName="w-44 sm:w-56">
            {loaderData.related.map((item) => (
              <ProductCard key={item.id} card={item} lang={lang} wished={loaderData.wishedIds.has(item.id)} />
            ))}
          </Carousel>
        </section>
      ) : null}
      {loaderData.moreFromStore.length > 0 ? (
        <section aria-labelledby="store-more-title" className="flex flex-col gap-3">
          <div className="flex items-end justify-between gap-3">
            <h2 id="store-more-title" className="relative ps-3 text-lg font-extrabold text-text before:absolute before:inset-y-1 before:start-0 before:w-1 before:rounded-full before:bg-action">
              {t("store.product.moreFromStoreNamed", { store: storeName })}
            </h2>
            <Link to={`/${lang}/store/${encodeURIComponent(card.vendor_slug)}`} className="shrink-0 text-sm font-bold text-action hover:underline">
              {t("store.product.visitStore")}
            </Link>
          </div>
          <Carousel label={t("store.product.moreFromStore")} itemClassName="w-44 sm:w-56">
            {loaderData.moreFromStore.map((item) => (
              <ProductCard key={item.id} card={item} lang={lang} wished={loaderData.wishedIds.has(item.id)} />
            ))}
          </Carousel>
        </section>
      ) : null}

      {loaderData.reviewItemId ? <ReviewPrompt orderItemId={loaderData.reviewItemId} productName={name} /> : null}

      {/* you viewed before */}
      <RecentStrip lang={lang} viewerId={loaderData.viewerId} excludeId={card.id} wishedIds={loaderData.wishedIds} />

      {/* sticky buy bar (mobile) */}
      <div data-buy-bar className="fixed inset-x-3 bottom-[calc(var(--bottom-nav-h,0px)+var(--bottom-nav-clear,0px)+12px)] z-40 rounded-xl border border-border bg-surface shadow-[0_8px_28px_rgb(0_0_0/0.16)] md:hidden">
        <div className="flex items-center gap-3 p-2.5 ps-4">
          <div className="min-w-0 flex-1">
            {card.min_price_piastres != null ? (
              <span className="num block text-base font-black text-text">
                {formatPiastres(card.event_price_piastres ?? card.min_price_piastres, lang === "en" ? "en" : "ar")}
              </span>
            ) : null}
            <span className="block truncate text-2xs text-text-muted">{name}</span>
          </div>
          {outOfStock ? (
            <span className="rounded-md bg-surface-tint px-4 py-2.5 text-sm font-extrabold text-text-muted">
              {t("store.product.outOfStock")}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => document.getElementById("buy-box")?.scrollIntoView({ behavior: "smooth", block: "center" })}
              className="flex min-h-10 cursor-pointer items-center gap-1.5 rounded-md bg-action px-4 text-sm font-extrabold text-on-action transition-colors duration-150 hover:bg-action-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              <CartIcon aria-hidden="true" />
              {t("store.card.chooseOptions")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonPage />;
}

import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import type { Route } from "./+types/product";
import { useTranslation } from "react-i18next";
import { requireLang } from "~/lib/lang.server";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { breadcrumbLd, jsonLd, publicMeta, siteUrl } from "~/lib/seo";
import { formatPiastres } from "~/lib/money";
import { getProductPage, getRelatedProducts, getStoreProducts } from "~/features/storefront/api";
import { toggleCompare } from "~/features/discovery/compare";
import { useCart } from "~/features/cart/store";
import { getViewer } from "~/lib/auth/guards";
import { Tabs } from "~/components/ui/Tabs";
import { Rating } from "~/components/ui/Rating";
import { PriceTag } from "~/components/ui/PriceTag";
import { EmptyState } from "~/components/ui/EmptyState";
import { Breadcrumbs } from "~/components/ui/Breadcrumbs";
import { useToast } from "~/components/ui/Toast";
import { CartIcon, MinusIcon, PlusIcon, ScaleIcon, ShieldIcon, StarIcon, StoreIcon, TruckIcon } from "~/components/ui/icons";
import { Gallery } from "~/components/catalog/Gallery";
import { VariantSelector } from "~/components/catalog/VariantSelector";
import { ProductCard } from "~/components/catalog/ProductCard";
import { MediaImg, mediaUrl } from "~/components/catalog/MediaImg";
import { RecentStrip, useRecordView } from "~/components/catalog/RecentStrip";
import { WishlistHeart } from "~/components/catalog/WishlistHeart";
import { SkeletonPage } from "~/components/ui/Skeleton";


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
  const page = await getProductPage(client, slug);
  if (!page) throw new Response("Not Found", { status: 404 });

  const url = new URL(request.url);
  const requestedKey = url.searchParams.get("v");
  const { viewer } = (await getViewer(client)) ?? { viewer: null };
  const [related, moreFromStore, wishedRows] = await Promise.all([
    getRelatedProducts(client, page.card.leaf_category_id, page.card.id, 8).catch(() => []),
    getStoreProducts(client, page.card.vendor_id)
      .then((rows) => rows.filter((r) => r.id !== page.card.id && r.is_listable).slice(0, 4))
      .catch(() => []),
    viewer
      ? client.from("wishlist_items").select("product_id").eq("user_id", viewer.user.id)
      : Promise.resolve({ data: null, error: null }),
  ]);
  const wishedIds = new Set(((wishedRows.data ?? []) as Array<{ product_id: string }>).map((r) => r.product_id));
  // warm the same-origin media cache with the LCP image while the page renders
  const firstImage = page.media.find((m) => m.kind === "image")?.path;
  if (firstImage) void import("~/lib/media-cache.server").then((m) => m.warmMedia(firstImage)).catch(() => undefined);
  return { lang, page, related, moreFromStore, wishedIds, requestedKey, viewerId: viewer?.user.id ?? null, slug };
}

export const meta = ({ data }: Route.MetaArgs) => {
  const lang = (data?.lang as "ar" | "en") ?? "ar";
  const page = data?.page;
  if (!page) {
    return publicMeta({
      lang, path: "/product", title: lang === "ar" ? "المنتج غير موجود — اتسوء" : "Product not found — Etsawaa",
      description: lang === "ar" ? "هذا المنتج غير متاح." : "This product is not available.", noindex: true,
    });
  }
  const name = lang === "ar" ? page.card.name_ar || page.card.name_en : page.card.name_en || page.card.name_ar;
  const short = lang === "ar" ? page.card.short_ar || page.desc_ar : page.card.short_en || page.desc_en;
  const description = (short || name).slice(0, 160);
  const slug = lang === "ar" ? page.card.slug_ar || page.card.slug_en : page.card.slug_en || page.card.slug_ar;
  return publicMeta({
    lang,
    path: `/product/${encodeURIComponent(slug)}`,
    title: `${name} — ${lang === "ar" ? "اتسوء" : "Etsawaa"}`,
    description,
    noindex: false,
  });
};

export default function ProductPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const lang = loaderData.lang;
  const page = loaderData.page;
  const card = page.card;
  const name = lang === "ar" ? card.name_ar || card.name_en : card.name_en || card.name_ar;
  const storeName = lang === "ar" ? card.store_name_ar || card.store_name_en : card.store_name_en || card.store_name_ar;

  /* ---- variant selection state ------------------------------------------ */
  const initialVariant = useMemo(() => {
    if (loaderData.requestedKey) {
      const byKey = page.variants.find((v) => v.option_key === loaderData.requestedKey);
      if (byKey) return byKey;
    }
    return page.variants.find((v) => v.stock > 0) ?? page.variants[0] ?? null;
  }, [page.variants, loaderData.requestedKey]);

  const [selectedId, setSelectedId] = useState<string | null>(initialVariant?.id ?? null);
  const selected = useMemo(
    () => page.variants.find((v) => v.id === selectedId) ?? initialVariant,
    [page.variants, selectedId, initialVariant],
  );

  const selectedMap = useMemo(() => {
    const map = new Map<string, string>();
    if (selected) for (const oid of selected.option_ids ?? []) {
      const axis = page.axes.find((a) => a.options.some((o) => o.id === oid));
      if (axis) map.set(axis.attribute_id, oid);
    }
    return map;
  }, [selected, page.axes]);

  // qty lives per variant; onSelectOption resets it when the variant changes.
  const [qty, setQty] = useState(1);

  const onSelectOption = (attributeId: string, optionId: string) => {
    const next = new Map(selectedMap);
    next.set(attributeId, optionId);
    // resolve to the exact variant with this combination
    const match = page.variants.find((v) => {
      const ids = v.option_ids ?? [];
      for (const axis of page.axes) {
        const want = next.get(axis.attribute_id);
        if (want && !ids.includes(want)) return false;
      }
      return true;
    });
    if (match) {
      setSelectedId(match.id);
      setPickedImage(null); // variant change wins over an earlier thumbnail pick
      setQty(1);            // qty is per-variant; keep it inside the new stock
      const url = new URL(window.location.href);
      url.searchParams.set("v", match.option_key);
      void navigate(`${url.pathname}${url.search}`, { replace: true, preventScrollReset: true });
    }
  };

  /* ---- price / stock / sale window -------------------------------------- */
  // A sale price with no scheduled window is a permanent sale — previously it
  // was ignored entirely until an admin set sale_starts_at.
  const inSaleWindow = (() => {
    if (!page.sale_starts_at && !page.sale_ends_at) return true;
    const start = page.sale_starts_at ? new Date(page.sale_starts_at).getTime() : -Infinity;
    const end = page.sale_ends_at ? new Date(page.sale_ends_at).getTime() : Infinity;
    const now = Date.now();
    return now >= start && now <= end;
  })();
  const variantPrice = selected?.price_piastres ?? null;
  const variantSale = inSaleWindow ? selected?.sale_price_piastres ?? null : null;
  const effective = variantSale ?? variantPrice;
  const regular = variantPrice;
  const eventDiscount = card.event_percent > 0 && effective != null;
  const eventPrice = eventDiscount && effective != null
    ? (() => {
        const discounted = effective - Math.trunc((effective * card.event_percent) / 100);
        return card.event_max_piastres != null && discounted > card.event_max_piastres ? card.event_max_piastres : discounted;
      })()
    : null;

  const stock = selected?.stock ?? 0;
  const outOfStock = stock <= 0;

  /* ---- gallery images ---------------------------------------------------- */
  const images = page.media.filter((m) => m.kind === "image").map((m) => ({ id: m.id, path: m.path }));
  // A thumbnail click sets `pickedImage`; switching variant drops it so the
  // variant's own image wins again. Previously onSelect was a no-op and only
  // variant changes ever moved the main image.
  const [pickedImage, setPickedImage] = useState<string | null>(null);
  const variantImage = selected?.image_path ?? null;
  const selectedImage = pickedImage ?? variantImage ?? images[0]?.path ?? null;
  const onPickImage = (path: string) => setPickedImage(path);

  /* ---- cart -------------------------------------------------------------- */
  const cart = useCart();
  const [adding, setAdding] = useState(false);

  const addToCart = async () => {
    if (!selected || outOfStock || adding) return;
    setAdding(true);
    const res = await cart.add(selected.id, card.id, qty);
    setAdding(false);
    if (!res.ok) {
      toast.showToast("error", t(res.reason === "out_of_stock" ? "store.product.outOfStock" : "errors.generic"));
      return;
    }
    if (res.capped) toast.showToast("info", t("cart.cappedNotice"));
    cart.openDrawer();
  };

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

  /* ---- specs table: attributes + shipping facts -------------------------- */
  const specRows = page.attributes.filter((a) => !a.is_axis || a.option_label_ar || a.option_label_en || a.value_text || a.value_number != null || a.value_bool != null);

  const ratingDist = useMemo(() => {
    const buckets = [5, 4, 3, 2, 1].map((star) => ({ star, count: page.reviews.filter((r) => Math.floor(r.rating) === star).length }));
    return buckets;
  }, [page.reviews]);

  const mainImage = page.media.find((m) => m.kind === "image");
  const lcpPreload = mainImage ? (
    <link rel="preload" as="image" href={mediaUrl(mainImage.path)} fetchPriority="high" />
  ) : null;

  return (
    <div className="flex flex-col gap-5 pb-16 md:pb-0">
      {lcpPreload}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd([
          breadcrumbLd(lang === "en" ? "en" : "ar", crumbs.map((c) => ({ name: c.label, path: c.href ?? `/${lang}` }))),
          {
            "@context": "https://schema.org",
            "@type": "Product",
            name,
            description: (lang === "ar" ? page.desc_ar : page.desc_en).slice(0, 500) || undefined,
            image: page.media.filter((m) => m.kind === "image").slice(0, 4).map((m) => mediaUrl(m.path)),
            brand: card.brand_name_ar || card.brand_name_en
              ? { "@type": "Brand", name: lang === "ar" ? card.brand_name_ar : card.brand_name_en }
              : undefined,
            sku: selected?.sku ?? undefined,
            offers: {
              "@type": "Offer",
              priceCurrency: "EGP",
              price: ((eventPrice ?? effective ?? 0) / 100).toFixed(2),
              availability: outOfStock ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
              url: `${siteUrl()}/${lang}/product/${encodeURIComponent(lang === "ar" ? card.slug_ar : card.slug_en)}`,
              seller: { "@type": "Organization", name: storeName },
            },
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
            <h1 className="min-w-0 text-xl font-black leading-snug text-text">{name}</h1>
            <WishlistHeart productId={card.id} initial={loaderData.wishedIds.has(card.id)} className="shrink-0" />
          </div>

          {card.rating_count > 0 && card.rating_avg != null ? (
            <Rating value={card.rating_avg} count={card.rating_count} />
          ) : (
            <span className="text-[12px] text-text-faint">{t("store.noReviews")}</span>
          )}

          {/* price block */}
          <div className="flex flex-wrap items-center gap-3 rounded-l border border-border bg-surface p-3.5">
            {effective != null ? (
              <PriceTag
                pricePiastres={eventPrice ?? effective}
                comparePricePiastres={eventPrice != null ? effective : variantSale != null && regular != null && regular > variantSale ? regular : undefined}
                locale={lang === "en" ? "en" : "ar"}
                size="lg"
              />
            ) : (
              <span className="text-[13px] text-text-muted">{t("store.product.noPrice")}</span>
            )}
            {eventPrice != null ? (
              <span className="rounded-full bg-surface-tint px-2.5 py-1 text-[12px] font-extrabold text-action">
                {t("store.eventDiscount", { percent: card.event_percent })}
              </span>
            ) : null}
            {variantSale != null && regular != null && regular > variantSale ? (
              <span className="num text-[12px] font-bold text-text-muted">
                {t("store.product.saleUntil", {
                  date: page.sale_ends_at ? new Date(page.sale_ends_at).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-EG") : "",
                })}
              </span>
            ) : null}
          </div>

          {/* stock state */}
          <p className={`text-[13px] font-extrabold ${outOfStock ? "text-danger" : "text-success-strong"}`}>
            {outOfStock ? t("store.product.outOfStock") : t("store.product.inStock", { count: stock })}
          </p>

          {/* variant selector (axes) */}
          <VariantSelector
            axes={page.axes}
            variants={page.variants}
            selected={selectedMap}
            lang={lang === "en" ? "en" : "ar"}
            onSelect={onSelectOption}
          />

          {/* qty + add */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center rounded-m border border-border">
              <button
                type="button"
                aria-label={t("cart.decrease")}
                disabled={outOfStock || qty <= 1}
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                className="flex size-11 cursor-pointer items-center justify-center text-text transition-colors duration-150 hover:bg-surface-tint disabled:cursor-not-allowed disabled:opacity-40"
              >
                <MinusIcon className="size-4" />
              </button>
              <span className="num w-10 text-center text-sm font-extrabold">{qty}</span>
              <button
                type="button"
                aria-label={t("cart.increase")}
                disabled={outOfStock || qty >= stock}
                onClick={() => setQty((q) => Math.min(stock, q + 1))}
                className="flex size-11 cursor-pointer items-center justify-center text-text transition-colors duration-150 hover:bg-surface-tint disabled:cursor-not-allowed disabled:opacity-40"
              >
                <PlusIcon className="size-4" />
              </button>
            </div>
            {outOfStock ? (
              <button
                type="button"
                disabled
                title={t("store.product.outOfStock")}
                className="flex min-h-11 flex-1 cursor-not-allowed items-center justify-center gap-2 rounded-m bg-surface-tint px-6 text-sm font-extrabold text-text-muted opacity-60"
              >
                <CartIcon aria-hidden="true" />
                {t("store.product.outOfStockCta")}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void addToCart()}
                disabled={adding || !selected}
                className="flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-m bg-action px-6 text-sm font-extrabold text-on-action transition-colors duration-150 hover:bg-action-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                <CartIcon aria-hidden="true" />
                {adding ? t("common.loading") : t("store.product.addToCart")}
              </button>
            )}
            <button
              type="button"
              onClick={onCompare}
              aria-label={t("store.compare.add")}
              className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-m border border-border text-text-muted transition-colors duration-150 hover:bg-surface-tint hover:text-action"
            >
              <ScaleIcon className="size-4.5" />
            </button>
          </div>

          {/* assurances */}
          <ul className="grid grid-cols-2 gap-2 text-[12px] font-bold text-text-muted">
            <li className="flex items-center gap-2 rounded-m border border-border px-3 py-2">
              <TruckIcon aria-hidden="true" className="text-action" />
              {t("store.product.assureShipping")}
            </li>
            <li className="flex items-center gap-2 rounded-m border border-border px-3 py-2">
              <ShieldIcon aria-hidden="true" className="text-action" />
              {t("store.product.assureReturns")}
            </li>
          </ul>

          {/* vendor card */}
          <Link
            to={`/${lang}/store/${encodeURIComponent(card.vendor_slug)}`}
            className="flex items-center gap-3 rounded-l border border-border bg-surface p-3 transition-colors duration-150 hover:bg-surface-tint"
          >
            {card.vendor_logo_path ? (
              <MediaImg path={card.vendor_logo_path} alt={storeName} width={56} height={56} className="size-12 rounded-full border border-border" />
            ) : (
              <span className="flex size-12 items-center justify-center rounded-full bg-surface-tint text-action">
                <StoreIcon className="size-5" />
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-extrabold text-text">{storeName}</span>
              <span className="flex items-center gap-2 text-[11px] text-text-muted">
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
              <div className="flex flex-col gap-5">
                {(lang === "ar" ? page.desc_ar : page.desc_en) ? (
                  <p className="whitespace-pre-line text-[13.5px] leading-relaxed text-text">
                    {lang === "ar" ? page.desc_ar : page.desc_en}
                  </p>
                ) : null}
                {specRows.length > 0 ? (
                  <table className="w-full border-collapse text-[13px]">
                    <caption className="sr-only">{t("store.product.tabSpecs")}</caption>
                    <tbody>
                      {specRows.map((attr) => {
                        const label = lang === "ar" ? attr.label_ar : attr.label_en;
                        const value = attr.option_label_ar != null || attr.option_label_en != null
                          ? (lang === "ar" ? attr.option_label_ar : attr.option_label_en)
                          : attr.value_text != null
                            ? attr.value_text
                            : attr.value_number != null
                              ? `${attr.value_number}${attr.unit ? ` ${attr.unit}` : ""}`
                              : attr.value_bool != null
                                ? t(attr.value_bool ? "common.yes" : "common.no")
                                : null;
                        if (value == null) return null;
                        return (
                          <tr key={attr.attribute_id} className="border-b border-border">
                            <th scope="row" className="w-1/3 py-2.5 text-start font-bold text-text-muted">{label}</th>
                            <td className="py-2.5 text-text">
                              {attr.color_hex ? (
                                <span className="inline-flex items-center gap-2">
                                  <span aria-hidden="true" className="size-3.5 rounded-full border border-border" style={{ backgroundColor: attr.color_hex }} />
                                  {value}
                                </span>
                              ) : value}
                            </td>
                          </tr>
                        );
                      })}
                      {page.is_fragile ? (
                        <tr className="border-b border-border">
                          <th scope="row" className="py-2.5 text-start font-bold text-text-muted">{t("store.product.fragile")}</th>
                          <td className="py-2.5 text-text">{t("common.yes")}</td>
                        </tr>
                      ) : null}
                      {page.weight_g ? (
                        <tr className="border-b border-border">
                          <th scope="row" className="py-2.5 text-start font-bold text-text-muted">{t("store.product.weight")}</th>
                          <td className="num py-2.5 text-text">{t("store.product.grams", { count: page.weight_g })}</td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                ) : null}
              </div>
            ),
          },
          {
            id: "reviews",
            label: `${t("store.product.tabReviews")} (${page.reviews.length})`,
            content: page.reviews.length === 0 ? (
              <EmptyState title={t("store.reviews.emptyTitle")} body={t("store.reviews.emptyBody")} />
            ) : (
              <div className="flex flex-col gap-5">
                <div className="flex flex-wrap items-center gap-6 rounded-l border border-border bg-surface p-4">
                  <div className="text-center">
                    <p className="num text-3xl font-black text-text">{card.rating_avg?.toFixed(1) ?? "—"}</p>
                    <Rating value={card.rating_avg ?? 0} size="sm" />
                    <p className="num mt-1 text-[11px] text-text-muted">{t("store.reviews.count", { count: card.rating_count })}</p>
                  </div>
                  <ul className="min-w-0 flex-1">
                    {ratingDist.map((bucket) => (
                      <li key={bucket.star} className="flex items-center gap-2 text-[12px]">
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
                    <li key={review.id} className="rounded-l border border-border bg-surface p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[13px] font-extrabold text-text">{review.author_name}</span>
                        <Rating value={review.rating} size="sm" />
                      </div>
                      {review.title ? <p className="mt-1 text-[13px] font-bold text-text">{review.title}</p> : null}
                      {review.body ? <p className="mt-1 text-[13px] leading-relaxed text-text-muted">{review.body}</p> : null}
                      <time dateTime={review.created_at} className="num mt-1.5 block text-[11px] text-text-faint">
                        {new Date(review.created_at).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-EG")}
                      </time>
                    </li>
                  ))}
                </ul>
              </div>
            ),
          },
        ]}
      />

      {/* related + more from store */}
      {loaderData.related.length > 0 ? (
        <section aria-label={t("store.product.related")} className="flex flex-col gap-3">
          <h2 className="text-base font-extrabold text-text">{t("store.product.related")}</h2>
          <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
            {loaderData.related.slice(0, 4).map((item) => (
              <li key={item.id} className="min-w-0">
                <ProductCard card={item} lang={lang} wished={loaderData.wishedIds.has(item.id)} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {loaderData.moreFromStore.length > 0 ? (
        <section aria-label={t("store.product.moreFromStore")} className="flex flex-col gap-3">
          <h2 className="text-base font-extrabold text-text">{t("store.product.moreFromStore")}</h2>
          <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
            {loaderData.moreFromStore.slice(0, 4).map((item) => (
              <li key={item.id} className="min-w-0">
                <ProductCard card={item} lang={lang} wished={loaderData.wishedIds.has(item.id)} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* you viewed before */}
      <RecentStrip lang={lang} viewerId={loaderData.viewerId} excludeId={card.id} wishedIds={loaderData.wishedIds} />

      {/* sticky buy bar (mobile) */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 shadow-2 backdrop-blur-sm md:hidden">
        <div className="mx-auto flex max-w-page items-center gap-3 px-4 py-2.5">
          <div className="min-w-0 flex-1">
            {effective != null ? (
              <span className="num block text-base font-black text-text">
                {formatPiastres(eventPrice ?? effective, lang === "en" ? "en" : "ar")}
              </span>
            ) : null}
            <span className="block truncate text-[11px] text-text-muted">{name}</span>
          </div>
          {outOfStock ? (
            <span className="rounded-m bg-surface-tint px-4 py-2.5 text-[13px] font-extrabold text-text-muted">
              {t("store.product.outOfStock")}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => void addToCart()}
              disabled={adding}
              className="flex min-h-10 cursor-pointer items-center gap-1.5 rounded-m bg-action px-4 text-[13px] font-extrabold text-on-action transition-colors duration-150 hover:bg-action-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              <CartIcon aria-hidden="true" />
              {t("store.product.addToCart")}
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

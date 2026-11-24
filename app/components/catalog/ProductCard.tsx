import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Rating } from "~/components/ui/Rating";
import { PriceTag } from "~/components/ui/PriceTag";
import { CompareArrowsIcon } from "~/components/ui/icons";
import { useToast } from "~/components/ui/Toast";
// Layering exception: effectivePrice (pricing) and toggleCompare (compare
// staging) are feature-owned logic; the card calls them in place rather than
// duplicating them in components.
import { cardPricing, type ProductCard as ProductCardRow } from "~/features/storefront/api";
import { toggleCompare } from "~/features/discovery/compare";
import { useCart } from "~/features/cart/store";
import { MediaImg } from "./MediaImg";
import { QuickBuyDialog } from "./QuickBuyDialog";
import { WishlistHeart } from "./WishlistHeart";

export function productSlug(card: { slug_ar: string; slug_en: string }, lang: string): string {
  const slug = lang === "en" ? card.slug_en || card.slug_ar : card.slug_ar || card.slug_en;
  return slug;
}

/**
 * The storefront product card (US-01/03/13): image + name + rating + vendor
 * + price, up to 4 colour swatches (picking one shows that colour's photo),
 * wishlist heart, compare action and "Choose options" (quick-buy popup) — or
 * "Add to cart" straight away when the product has nothing to choose.
 * Featured products carry the unified border + mark (AGENT.md §19).
 */
export function ProductCard({
  card,
  lang,
  wished = false,
  eager = false,
}: {
  card: ProductCardRow;
  lang: string;
  wished?: boolean;
  eager?: boolean;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const params = useParams();
  const locale = params.lang === "en" ? "en" : "ar";
  const slug = productSlug(card, lang);
  const href = `/${lang}/product/${encodeURIComponent(slug)}`;
  const name = lang === "ar" ? card.name_ar || card.name_en : card.name_en || card.name_ar;
  const storeName = lang === "ar" ? card.store_name_ar || card.store_name_en : card.store_name_en || card.store_name_ar;
  const level = lang === "ar" ? card.level_name_ar : card.level_name_en;
  const pricing = cardPricing(card);
  const price = pricing.now;
  const colors = (card.colors ?? []).slice(0, 4);
  const extraColors = Math.max(0, (card.colors?.length ?? 0) - colors.length);
  const [colorPick, setColorPick] = useState<string | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const cart = useCart();
  const [adding, setAdding] = useState(false);
  // nothing to choose (one plain variant) → "Add to cart" straight from the card
  const directVariant = card.single_variant_id ?? null;
  const soldOut = card.stock_total <= 0;
  const onAddToCart = async () => {
    if (!directVariant || adding) return;
    setAdding(true);
    const res = await cart.add(directVariant, card.id, 1);
    setAdding(false);
    if (!res.ok) {
      toast.showToast("error", t(res.reason === "out_of_stock" ? "store.product.outOfStock" : "errors.generic"));
      return;
    }
    toast.showToast(res.capped ? "info" : "success", t(res.capped ? "cart.cappedNotice" : "cart.added"));
  };
  const shownImage = colors.find((c) => c.id === colorPick)?.image ?? card.main_image_path;

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

  return (
    <article
      // h-full: every card in a row / carousel is as tall as the tallest one
      className={`group relative flex h-full flex-col overflow-hidden rounded-lg border bg-surface transition-shadow duration-200 hover:shadow-1 ${
        card.is_featured ? "border-featured border-2" : "border-border"
      }`}
    >
      {pricing.before != null || card.is_featured ? (
        <div className="pointer-events-none absolute start-2 top-2 z-10 flex flex-col items-start gap-1">
          {pricing.before != null ? (
            <span className="num inline-flex items-center whitespace-nowrap rounded-md bg-action px-2 py-0.5 text-2xs font-extrabold leading-tight text-on-action shadow-1">
              {t("store.card.discountBadge", { percent: pricing.percent })}
            </span>
          ) : null}
          {card.is_featured ? (
            <span className="rounded-md bg-featured px-2 py-0.5 text-2xs font-extrabold leading-tight text-ink shadow-1">
              {t("store.featuredMark")}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="relative">
        <Link to={href} className="block" tabIndex={-1} aria-hidden="true">
          {shownImage ? (
            <MediaImg
              key={shownImage}
              path={shownImage}
              alt={name}
              width={400}
              height={400}
              eager={eager}
              priority={eager}
              sizes="(min-width: 1100px) 280px, (min-width: 768px) 33vw, 50vw"
              className="aspect-square w-full"
            />
          ) : (
            <div className="flex aspect-square w-full items-center justify-center bg-surface-tint text-text-faint">
              <span className="text-xs font-bold">{t("store.noImage")}</span>
            </div>
          )}
        </Link>
        <WishlistHeart productId={card.id} initial={wished} className="absolute end-2 top-2 z-10" />
        {/* compare sits on the image, bottom corner on the reading side (right in Arabic, left in English) */}
        <button
          type="button"
          onClick={onCompare}
          aria-label={t("store.compare.add")}
          title={t("store.compare.add")}
          className="absolute bottom-2 start-2 z-10 flex size-9 cursor-pointer items-center justify-center rounded-full bg-surface/95 text-text-muted shadow-1 transition-colors duration-150 hover:text-action"
        >
          <CompareArrowsIcon className="size-4.5" />
        </button>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-2.5">
        {/* the swatch row keeps its height even without colours, so names and prices line up across cards */}
        {colors.length > 0 ? (
          <div className="flex h-6 items-center gap-1.5" role="group" aria-label={t("store.card.colors")}>
            {colors.map((c) => {
              const label = lang === "ar" ? c.label_ar || c.label_en : c.label_en || c.label_ar;
              const active = colorPick === c.id;
              return (
                <button key={c.id} type="button" onClick={() => setColorPick(active ? null : c.id)} onMouseEnter={() => setColorPick(c.id)}
                  aria-pressed={active} aria-label={label} title={label}
                  className={`flex size-6 cursor-pointer items-center justify-center rounded-full transition-shadow ${
                    active ? "shadow-[0_0_0_1.5px_var(--color-surface),0_0_0_3px_var(--color-action)]" : "hover:shadow-[0_0_0_1.5px_var(--color-surface),0_0_0_3px_var(--color-border-strong)]"}`}>
                  <span aria-hidden="true" className="size-5 rounded-full border border-black/10"
                    style={c.hex ? { backgroundColor: c.hex } : { background: "conic-gradient(#e53935,#fdd835,#43a047,#1e88e5,#8e24aa,#e53935)" }} />
                </button>
              );
            })}
            {extraColors > 0 ? <span className="num text-2xs font-bold text-text-muted">+{extraColors}</span> : null}
          </div>
        ) : (
          <div className="h-6" aria-hidden="true" />
        )}

        <h3 className="line-clamp-2 min-h-[2.75em] text-sm font-bold leading-snug text-text">
          <Link to={href} className="transition-colors duration-150 hover:text-action">
            {name}
          </Link>
        </h3>

        {card.rating_count > 0 && card.rating_avg != null ? (
          <Rating value={card.rating_avg} count={card.rating_count} size="sm" />
        ) : (
          <span className="text-2xs text-text-faint">{t("store.noReviews")}</span>
        )}

        <Link
          to={`/${lang}/store/${encodeURIComponent(card.vendor_slug)}`}
          className="flex min-w-0 items-center gap-1.5 text-2xs text-text-muted transition-colors duration-150 hover:text-action"
        >
          <span className="truncate font-bold">{storeName}</span>
          {level ? (
            <span className="shrink-0 rounded-full border border-border px-1.5 py-px text-2xs font-extrabold text-text-muted">
              {level}
            </span>
          ) : null}
        </Link>

        <div className="mt-auto flex items-end justify-between gap-2 pt-1">
          <div className="flex min-w-0 flex-col">
            <PriceTag pricePiastres={price} comparePricePiastres={pricing.before} locale={locale} size="sm" badge={false} />
            {card.event_percent > 0 ? (
              <span className="mt-0.5 w-fit rounded-full bg-surface-tint px-1.5 py-px text-2xs font-extrabold text-action">
                {t("store.eventDiscount", { percent: card.event_percent })}
              </span>
            ) : null}
          </div>
        </div>
        {directVariant ? (
          <button
            type="button"
            onClick={() => void onAddToCart()}
            disabled={soldOut || adding}
            aria-busy={adding}
            className="mt-1 flex min-h-9 w-full cursor-pointer items-center justify-center rounded-md border border-action bg-action text-xs font-extrabold text-on-action transition-colors duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-tint disabled:text-text-muted"
          >
            {soldOut ? t("store.product.outOfStock") : adding ? t("store.card.adding") : t("store.product.addToCart")}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setQuickOpen(true)}
            className="mt-1 flex min-h-9 w-full cursor-pointer items-center justify-center rounded-md border border-action text-xs font-extrabold text-action transition-colors duration-150 hover:bg-action hover:text-on-action"
          >
            {t("store.card.chooseOptions")}
          </button>
        )}
      </div>
      {quickOpen ? <QuickBuyDialog slug={slug} lang={locale} open={quickOpen} onClose={() => setQuickOpen(false)} /> : null}
    </article>
  );
}

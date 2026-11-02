import { Link, useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Rating } from "~/components/ui/Rating";
import { PriceTag } from "~/components/ui/PriceTag";
import { ScaleIcon } from "~/components/ui/icons";
import { useToast } from "~/components/ui/Toast";
import { effectivePrice, type ProductCard as ProductCardRow } from "~/features/storefront/api";
import { toggleCompare } from "~/features/discovery/compare";
import { MediaImg } from "./MediaImg";
import { WishlistHeart } from "./WishlistHeart";

export function productSlug(card: { slug_ar: string; slug_en: string }, lang: string): string {
  const slug = lang === "en" ? card.slug_en || card.slug_ar : card.slug_ar || card.slug_en;
  return slug;
}

/**
 * The storefront product card (US-01/03/13): image + name + rating + vendor
 * + price, wishlist heart, compare action. Featured products carry the
 * unified border + mark (AGENT.md §19) until their window ends.
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
  const price = card.event_price_piastres ?? effectivePrice(card);

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
      className={`group relative flex flex-col overflow-hidden rounded-lg border bg-surface transition-shadow duration-200 hover:shadow-1 ${
        card.is_featured ? "border-featured border-2" : "border-border"
      }`}
    >
      {card.is_featured ? (
        <span className="absolute start-2 top-2 z-10 rounded-full bg-featured px-2 py-0.5 text-[11px] font-extrabold text-ink">
          {t("store.featuredMark")}
        </span>
      ) : null}

      <div className="relative">
        <Link to={href} className="block" tabIndex={-1} aria-hidden="true">
          {card.main_image_path ? (
            <MediaImg
              path={card.main_image_path}
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
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-2.5">
        <h3 className="line-clamp-2 text-[13px] font-bold leading-snug text-text">
          <Link to={href} className="transition-colors duration-150 hover:text-action">
            {name}
          </Link>
        </h3>

        {card.rating_count > 0 && card.rating_avg != null ? (
          <Rating value={card.rating_avg} count={card.rating_count} size="sm" />
        ) : (
          <span className="text-[11px] text-text-faint">{t("store.noReviews")}</span>
        )}

        <Link
          to={`/${lang}/store/${encodeURIComponent(card.vendor_slug)}`}
          className="flex min-w-0 items-center gap-1.5 text-[11px] text-text-muted transition-colors duration-150 hover:text-action"
        >
          <span className="truncate font-bold">{storeName}</span>
          {level ? (
            <span className="shrink-0 rounded-full border border-border px-1.5 py-px text-[10px] font-extrabold text-text-muted">
              {level}
            </span>
          ) : null}
        </Link>

        <div className="mt-auto flex items-end justify-between gap-2 pt-1">
          <div className="flex min-w-0 flex-col">
            {card.has_sale && card.min_regular_piastres != null && card.min_regular_piastres > price ? (
              <PriceTag pricePiastres={price} comparePricePiastres={card.min_regular_piastres} locale={locale} size="sm" />
            ) : (
              <PriceTag pricePiastres={price} locale={locale} size="sm" />
            )}
            {card.event_percent > 0 ? (
              <span className="mt-0.5 w-fit rounded-full bg-surface-tint px-1.5 py-px text-[10px] font-extrabold text-action">
                {t("store.eventDiscount", { percent: card.event_percent })}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onCompare}
            aria-label={t("store.compare.add")}
            title={t("store.compare.add")}
            className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border text-text-muted transition-colors duration-150 hover:bg-surface-tint hover:text-action"
          >
            <ScaleIcon className="size-4" />
          </button>
        </div>
      </div>
    </article>
  );
}

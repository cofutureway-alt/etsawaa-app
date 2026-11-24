import { useTranslation } from "react-i18next";
import { formatPiastres } from "~/lib/money";
import type { Locale } from "~/lib/i18n/config";

export interface PriceTagProps {
  /** Price in piastres (integer) */
  pricePiastres: number;
  comparePricePiastres?: number | null;
  locale: Locale;
  size?: "sm" | "md" | "lg";
  /** the % saving pill (cards show their own badge instead) */
  badge?: boolean;
}

const sizeClasses = { sm: "text-sm", md: "text-base", lg: "text-xl" } as const;
const compareSizeClasses = { sm: "text-sm", md: "text-sm", lg: "text-base" } as const;

/**
 * PriceTag: EGP from integer piastres. On sale the price to pay is red and the
 * old price stays dark with the strike through the middle of the digits.
 * Numbers stay LTR inside RTL; items-center keeps both baselines one line.
 */
export function PriceTag({ pricePiastres, comparePricePiastres, locale, size = "md", badge = true }: PriceTagProps) {
  const { t } = useTranslation();
  const onSale = typeof comparePricePiastres === "number" && comparePricePiastres > pricePiastres;
  return (
    <span className={`inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 ${sizeClasses[size]}`}>
      <span className={`num leading-none ${onSale ? "font-black text-danger" : `font-extrabold ${size === "lg" ? "text-action" : "text-text"}`}`}>
        {formatPiastres(pricePiastres, locale)}
      </span>
      {onSale ? (
        <>
          {/* Cairo's own strikeout offset sits near the ascenders, so draw the
              line on the leading-none digit box instead. */}
          <span className={`num relative inline-block font-bold leading-none text-text before:pointer-events-none before:absolute before:inset-x-[-2px] before:top-1/2 before:-translate-y-1/2 before:rounded-full before:bg-current before:content-[''] ${size === "lg" ? "before:h-[2px]" : "before:h-[1.5px]"} ${compareSizeClasses[size]}`}>
            <span className="sr-only">{t("ui.price.before")} </span>
            {formatPiastres(comparePricePiastres, locale)}
          </span>
          {badge ? (
            <span className="num self-center whitespace-nowrap rounded-md bg-action px-2 py-0.5 text-2xs font-extrabold leading-tight text-on-action">
              {t("store.card.discountBadge", { percent: Math.max(1, Math.round(((comparePricePiastres - pricePiastres) / comparePricePiastres) * 100)) })}
            </span>
          ) : null}
        </>
      ) : null}
    </span>
  );
}

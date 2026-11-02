import { useTranslation } from "react-i18next";
import { formatPiastres } from "~/lib/money";
import type { Locale } from "~/lib/i18n/config";

export interface PriceTagProps {
  /** Price in piastres (integer) */
  pricePiastres: number;
  comparePricePiastres?: number | null;
  locale: Locale;
  size?: "sm" | "md" | "lg";
}

const sizeClasses = { sm: "text-sm", md: "text-base", lg: "text-xl" } as const;

/**
 * PriceTag: EGP from integer piastres. Sale badge appears only when a
 * compare price exists and is higher. Numbers stay LTR inside RTL.
 */
export function PriceTag({ pricePiastres, comparePricePiastres, locale, size = "md" }: PriceTagProps) {
  const { t } = useTranslation();
  const onSale = typeof comparePricePiastres === "number" && comparePricePiastres > pricePiastres;
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`num font-extrabold text-text ${sizeClasses[size]}`}>
        {formatPiastres(pricePiastres, locale)}
      </span>
      {onSale ? (
        <>
          <span className="num text-xs text-text-faint line-through">
            {formatPiastres(comparePricePiastres, locale)}
          </span>
          <span className="rounded-full bg-action px-2 py-0.5 text-2xs font-bold text-on-action">
            {t("ui.price.sale")}
          </span>
        </>
      ) : null}
    </span>
  );
}

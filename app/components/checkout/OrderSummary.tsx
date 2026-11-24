import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/Button";
import { MediaImg } from "~/components/catalog/MediaImg";
import { formatMoney } from "~/components/checkout/money";
import type { CheckoutLine, QuoteTotals } from "~/features/checkout/pricing.server";

/**
 * Sticky order summary (JOURNEYS §6): cart lines grouped by vendor, the
 * coupon input, and the totals list — all display-only, since
 * fn_create_order re-prices server-side on placement.
 */

/** One vendor group: vendor id + its sellable quote lines. */
export type VendorGroup = [vendorId: string, lines: CheckoutLine[]];

export function OrderSummary({
  lang,
  groups,
  totals,
  couponInput,
  onCouponInput,
  onApplyCoupon,
  quotePending,
}: {
  lang: string;
  groups: VendorGroup[];
  totals: QuoteTotals | null;
  couponInput: string;
  onCouponInput: (value: string) => void;
  /** Apply button: stamps the trimmed input as the active coupon code */
  onApplyCoupon: () => void;
  /** true while a live re-quote is in flight (Apply disabled) */
  quotePending: boolean;
}) {
  const { t, i18n } = useTranslation();
  const money = (p: number) => formatMoney(i18n.language, p);
  return (
    <aside className="lg:sticky lg:top-24">
      <div className="rounded-md border border-border bg-surface p-4">
        <h2 className="text-sm font-extrabold text-text">{t("checkout.summaryTitle")}</h2>
        {groups.length === 0 ? (
          <p className="mt-3 text-sm text-text-muted">{t("cart.empty")}</p>
        ) : (
          groups.map(([vendorId, lines]) => (
            <div key={vendorId} className="mt-3">
              <p className="text-xs font-bold text-text-muted">
                {i18n.language?.startsWith("en") ? lines[0]?.store_name_en : lines[0]?.store_name_ar}
              </p>
              <ul className="mt-1.5 flex flex-col gap-2">
                {lines.map((l) => (
                  <li key={l.variant_id} className="flex items-center gap-2.5">
                    <MediaImg
                      path={l.image_path ?? ""}
                      alt={i18n.language?.startsWith("en") ? l.name_en : l.name_ar}
                      className="size-11 shrink-0 rounded-md border border-border object-cover"
                    />
                    <span className="min-w-0 flex-1">
                      <Link to={`/${lang}/product/${encodeURIComponent(i18n.language?.startsWith("en") ? l.slug_en : l.slug_ar)}`} className="block truncate text-sm font-bold text-text hover:text-action">
                        {i18n.language?.startsWith("en") ? l.name_en : l.name_ar}
                      </Link>
                      <span className="text-xs text-text-muted">
                        {(i18n.language?.startsWith("en") ? l.option_label_en : l.option_label_ar) ? `${i18n.language?.startsWith("en") ? l.option_label_en : l.option_label_ar} · ` : ""}{t("cart.qty")} {l.qty}
                      </span>
                    </span>
                    <span className="text-sm font-extrabold text-text">{money(l.unit_piastres * l.qty)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}

        {/* coupon */}
        <div className="mt-4 border-t border-border pt-3">
          <label htmlFor="ck-coupon" className="text-sm font-bold text-text">{t("cart.coupon.label")}</label>
          <div className="mt-1.5 flex gap-2">
            <input
              id="ck-coupon"
              value={couponInput}
              onChange={(e) => onCouponInput(e.target.value)}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none transition-colors duration-150 focus:border-primary focus:shadow-focus"
              placeholder={t("cart.coupon.placeholder")}
            />
            <Button
              variant="outline" size="sm"
              disabled={!couponInput.trim() || quotePending}
              onClick={onApplyCoupon}
            >
              {t("cart.coupon.apply")}
            </Button>
          </div>
          {totals && !totals.coupon.ok && totals.coupon.code ? (
            <p className="mt-1.5 text-xs text-danger">
              {totals.coupon.reason === "expired" ? t("cart.coupon.error.expired")
                : totals.coupon.reason === "limit" ? t("cart.coupon.error.limit")
                : totals.coupon.reason === "min_subtotal" ? t("cart.coupon.error.min_subtotal")
                : t("cart.coupon.error.not_eligible")}
            </p>
          ) : null}
          {totals && totals.coupon.ok && totals.coupon.code ? (
            <p className="mt-1.5 text-xs text-primary">{t("cart.coupon.appliedCode", { code: totals.coupon.code })}</p>
          ) : null}
        </div>

        {/* totals */}
        <dl className="mt-3 flex flex-col gap-1.5 border-t border-border pt-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-text-muted">{t("cart.subtotal")}</dt>
            <dd className="font-bold text-text">{money(totals?.subtotal_piastres ?? 0)}</dd>
          </div>
          {(totals?.discount_piastres ?? 0) > 0 ? (
            <div className="flex justify-between">
              <dt className="text-text-muted">{t("cart.discount")}</dt>
              <dd className="font-bold text-primary">−{money(totals!.discount_piastres)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between">
            <dt className="text-text-muted">{t("cart.shipping")}</dt>
            <dd className="font-bold text-text">
              {totals?.free_shipping ? t("checkout.freeShipping") : money(totals?.shipping_piastres ?? 0)}
            </dd>
          </div>
          <div className="mt-1 flex justify-between border-t border-border pt-2">
            <dt className="text-sm font-extrabold text-text">{t("cart.total")}</dt>
            <dd className="text-base font-extrabold text-text">{money(totals?.total_piastres ?? 0)}</dd>
          </div>
        </dl>
        <p className="mt-2 text-2xs text-text-faint">{t("checkout.totalServerSide")}</p>
      </div>
    </aside>
  );
}

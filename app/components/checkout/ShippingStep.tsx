import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/Button";
import type { StepViewState } from "~/components/checkout/StepHeader";
import { StepHeader } from "~/components/checkout/StepHeader";
import { formatMoney } from "~/components/checkout/money";
import type { QuoteTotals } from "~/features/checkout/pricing.server";
import type { CheckoutGovernorateRow } from "~/features/checkout/types";

/**
 * Step 2 — shipping accordion section (JOURNEYS §6): the single per-order
 * shipping fee for the effective governorate (or a free-shipping coupon
 * note), plus the back/continue controls.
 */

export function ShippingStep({
  open,
  index,
  total,
  stepState,
  onOpen,
  onBack,
  onContinue,
  activeGov,
  totals,
  couponCode,
}: {
  open: boolean;
  index: number;
  total: number;
  stepState: StepViewState;
  onOpen: () => void;
  onBack: () => void;
  onContinue: () => void;
  /** governorate the fee is quoted for (null = none chosen yet) */
  activeGov: CheckoutGovernorateRow | null;
  totals: QuoteTotals | null;
  /** applied coupon code (only shown when it grants free shipping) */
  couponCode: string;
}) {
  const { t, i18n } = useTranslation();
  const money = (p: number) => formatMoney(i18n.language, p);
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-1">
      <StepHeader index={index} total={total} state={stepState} open={open} onOpen={onOpen} />
      {open ? (
        <div className="border-t border-border p-4">
          {activeGov ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between rounded-md bg-surface-tint p-3">
                <span className="text-sm font-bold text-text">{t("checkout.shippingFee")}</span>
                <span className="text-sm font-extrabold text-text">
                  {totals?.free_shipping ? t("checkout.freeShipping") : money(totals?.shipping_piastres ?? activeGov.shipping_fee_piastres)}
                </span>
              </div>
              {totals?.free_shipping ? (
                <p className="text-sm text-text-muted">{t("checkout.freeShippingCoupon", { code: couponCode })}</p>
              ) : null}
              <p className="text-sm text-text-muted">{t("checkout.shippingNotice")}</p>
            </div>
          ) : (
            <p className="text-sm text-text-muted">{t("checkout.chooseGovernorateFirst")}</p>
          )}
          <div className="mt-4 flex justify-between">
            <Button variant="ghost" onClick={onBack}>{t("checkout.back")}</Button>
            <Button onClick={onContinue}>{t("checkout.continue")}</Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

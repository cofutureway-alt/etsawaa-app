import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/Button";
import type { StepViewState } from "~/components/checkout/StepHeader";
import { StepHeader } from "~/components/checkout/StepHeader";
import type { CheckoutAddressRow } from "~/features/checkout/types";

/**
 * Step 4 — confirm accordion section (JOURNEYS §6): a one-line summary of the
 * chosen address and payment method, the terms checkbox gating placement, and
 * the Place Order button (disabled until `canPlace`, spinner while the
 * placement request is in flight).
 */

export function ConfirmStep({
  open,
  index,
  total,
  stepState,
  onOpen,
  onBack,
  defaultAddress,
  addressMode,
  fullName,
  addr1,
  paymentMethod,
  terms,
  onTermsChange,
  canPlace,
  placing,
  onPlace,
  lang,
}: {
  open: boolean;
  index: number;
  total: number;
  stepState: StepViewState;
  onOpen: () => void;
  onBack: () => void;
  /** locale prefix for the terms/returns links */
  lang: string;
  /** first saved address — summary source in "saved" mode */
  defaultAddress: CheckoutAddressRow | undefined;
  addressMode: "saved" | "new";
  fullName: string;
  addr1: string;
  paymentMethod: "kashier" | "cod" | "wallet" | null;
  terms: boolean;
  onTermsChange: (checked: boolean) => void;
  /** every gate passed — Place Order is enabled */
  canPlace: boolean;
  /** placement request in flight → button spinner */
  placing: boolean;
  onPlace: () => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-1">
      <StepHeader index={index} total={total} state={stepState} open={open} onOpen={onOpen} />
      {open ? (
        <div className="border-t border-border p-4">
          <p className="text-sm text-text-muted">
            {t("checkout.confirmSummary", {
              address: addressMode === "saved" ? `${defaultAddress?.full_name ?? ""} — ${defaultAddress?.address1 ?? ""}` : `${fullName} — ${addr1}`,
              payment: paymentMethod ? t(`checkout.pay_${paymentMethod}`) : "—",
            })}
          </p>
          <label className="mt-3 flex items-start gap-2 text-sm text-text">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-[var(--color-action)]"
              checked={terms}
              onChange={(e) => onTermsChange(e.target.checked)}
            />
            <span>
              {t("checkout.termsPrefix")}{" "}
              <Link to={`/${lang}/legal/terms`} className="font-bold text-action hover:underline">{t("checkout.termsLink")}</Link>
              {" · "}
              <Link to={`/${lang}/p/returns`} className="font-bold text-action hover:underline">{t("checkout.returnsLink")}</Link>
            </span>
          </label>
          <div className="mt-4 flex justify-between">
            <Button variant="ghost" onClick={onBack}>{t("checkout.back")}</Button>
            <Button size="lg" disabled={!canPlace} loading={placing} onClick={onPlace}>
              {t("checkout.placeOrder")}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

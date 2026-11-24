import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/Button";
import type { StepViewState } from "~/components/checkout/StepHeader";
import { StepHeader } from "~/components/checkout/StepHeader";
import { formatMoney } from "~/components/checkout/money";
import type { CodState } from "~/features/checkout/pricing.server";
import { PayMethodsNote } from "~/components/checkout/PayMethodsNote";

/**
 * Step 3 — payment accordion section (JOURNEYS §6): Kashier card payment
 * (disabled with a note when the provider is not configured) and COD, whose
 * availability/cap mirror what fn_create_order will re-decide on placement.
 */

export function PaymentStep({
  open,
  index,
  total,
  stepState,
  onOpen,
  onBack,
  onContinue,
  kashierAvailable,
  kashierTest = false,
  codState,
  paymentMethod,
  onPaymentMethod,
}: {
  open: boolean;
  index: number;
  total: number;
  stepState: StepViewState;
  onOpen: () => void;
  onBack: () => void;
  onContinue: () => void;
  /** false → Kashier radio disabled + "unavailable" note */
  kashierAvailable: boolean;
  /** this payment runs in Kashier test mode (sandbox, no real money) */
  kashierTest?: boolean;
  codState: CodState;
  paymentMethod: "kashier" | "cod" | null;
  onPaymentMethod: (method: "kashier" | "cod" | null) => void;
}) {
  const { t, i18n } = useTranslation();
  const money = (p: number) => formatMoney(i18n.language, p);
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-1">
      <StepHeader index={index} total={total} state={stepState} open={open} onOpen={onOpen} />
      {open ? (
        <div className="border-t border-border p-4">
          <div role="radiogroup" aria-label={t("checkout.stepPayment")} className="flex flex-col gap-2">
            <label className={`flex cursor-pointer items-start gap-3 rounded-md border p-3.5 transition-colors duration-150 ${
              paymentMethod === "kashier" ? "border-action bg-surface-tint" : "border-border hover:border-primary"
            } ${kashierAvailable ? "" : "opacity-60"}`}>
              <input
                type="radio"
                name="payment"
                className="mt-1 size-4 accent-[var(--color-action)]"
                disabled={!kashierAvailable}
                checked={paymentMethod === "kashier"}
                onChange={() => onPaymentMethod("kashier")}
              />
              <span className="text-sm">
                <span className="block font-bold text-text">{t("checkout.pay_kashier")}</span>
                <span className="block text-sm text-text-muted">{t("checkout.payKashierDesc")}</span>
                {kashierAvailable ? <span className="mt-2 block"><PayMethodsNote test={kashierTest} /></span> : null}
                {!kashierAvailable ? <span className="mt-1 block text-xs text-danger">{t("checkout.payUnavailable")}</span> : null}
              </span>
            </label>

            <label className={`flex items-start gap-3 rounded-md border p-3.5 transition-colors duration-150 ${
              paymentMethod === "cod" ? "border-action bg-surface-tint" : "border-border"
            } ${codState.allowed ? "cursor-pointer hover:border-primary" : "opacity-60"}`}>
              <input
                type="radio"
                name="payment"
                className="mt-1 size-4 accent-[var(--color-action)]"
                disabled={!codState.allowed}
                checked={paymentMethod === "cod"}
                onChange={() => onPaymentMethod("cod")}
              />
              <span className="text-sm">
                <span className="block font-bold text-text">{t("checkout.pay_cod")}</span>
                <span className="block text-sm text-text-muted">{t("checkout.payCodDesc")}</span>
                {!codState.allowed ? (
                  <span className="mt-1 block text-xs text-danger">
                    {codState.reason === "cap"
                      ? t("checkout.codCapReason", { cap: money(codState.cap_piastres) })
                      : codState.reason === "disabled"
                        ? t("checkout.codDisabledReason")
                        : t("checkout.codVendorShipReason")}
                  </span>
                ) : null}
              </span>
            </label>
          </div>
          <div className="mt-4 flex justify-between">
            <Button variant="ghost" onClick={onBack}>{t("checkout.back")}</Button>
            <Button onClick={onContinue}>{t("checkout.continue")}</Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

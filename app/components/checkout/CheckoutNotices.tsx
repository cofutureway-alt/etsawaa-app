import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { formatMoney } from "~/components/checkout/money";

/**
 * Status blocks rendered above the checkout accordion: the order-placement
 * failure summary (focused on failure — design skill: focusable error summary)
 * and the blocked-items notice for lines the server refused to list.
 * Both extracted verbatim from `app/routes/checkout.tsx`.
 */

/**
 * Why a placement failed. The known reasons get their specific i18n message;
 * anything else (server_error, address_not_found, …) falls back to the
 * generic error line.
 */
export interface CheckoutPlaceError {
  ok: false;
  reason: string;
  cap_piastres?: number;
  names?: string;
}

const KNOWN_PLACE_ERRORS = [
  "cod_cap", "cod_vendor_ship", "cod_disabled", "items_unavailable", "insufficient_stock",
  "phones_equal", "phone_invalid", "address_incomplete", "area_unavailable",
  "coupon_expired", "coupon_limit", "coupon_min_subtotal", "coupon_invalid",
  "payment_unavailable", "duplicate", "wallet_test_mode"] as const;

export function PlaceErrorSummary({
  lang, reason, capPiastres, names, fallbackCap,
}: {
  lang: string;
  reason: string;
  capPiastres?: number;
  names?: string;
  /** settings cap used when the response carries no cap (cod_cap reason) */
  fallbackCap: number;
}) {
  const { t, i18n } = useTranslation();
  const money = (p: number) => formatMoney(i18n.language, p);
  return (
    <div
      id="checkout-error-summary"
      role="alert"
      tabIndex={-1}
      className="mb-4 rounded-md border border-danger bg-surface p-4 outline-none"
    >
      <p className="text-sm font-bold text-danger">{t("checkout.placeFailed")}</p>
      <p className="mt-1 text-sm text-text-muted">
        {reason === "cod_cap" && t("checkout.codCapReason", { cap: money(capPiastres ?? fallbackCap) })}
        {reason === "cod_vendor_ship" && t("checkout.codVendorShipReason")}
        {reason === "cod_disabled" && t("checkout.codDisabledReason")}
        {reason === "items_unavailable" && t("checkout.itemsUnavailable", { names: names ?? "" })}
        {reason === "insufficient_stock" && t("checkout.stockChanged")}
        {reason === "phones_equal" && t("checkout.errPhonesEqual")}
        {reason === "phone_invalid" && t("checkout.errPhone")}
        {reason === "address_incomplete" && t("checkout.errAddress1")}
        {reason === "area_unavailable" && t("checkout.errArea")}
        {reason === "coupon_expired" && t("cart.coupon.error.expired")}
        {reason === "coupon_limit" && t("cart.coupon.error.limit")}
        {reason === "coupon_min_subtotal" && t("cart.coupon.error.min_subtotal")}
        {reason === "coupon_invalid" && t("cart.coupon.error.not_eligible")}
        {reason === "payment_unavailable" && t("checkout.payUnavailable")}
        {reason === "duplicate" && t("checkout.duplicateAttempt")}
        {reason === "wallet_test_mode" && t("checkout.walletTestMode")}
        {!KNOWN_PLACE_ERRORS.includes(reason as (typeof KNOWN_PLACE_ERRORS)[number]) && t("checkout.genericError")}
      </p>
      <p className="mt-2 text-sm">
        <Link to={`/${lang}/cart`} className="font-bold text-action hover:underline">{t("checkout.backToCart")}</Link>
      </p>
    </div>
  );
}

/** Cart lines the pricing mirror refused to list, with a way back to the cart. */
export function BlockedItemsNotice({ lang, blockedNames }: { lang: string; blockedNames: string[] }) {
  const { t } = useTranslation();
  return (
    <div role="status" className="mb-4 rounded-md border border-border bg-surface p-4">
      <p className="text-sm font-bold text-text">{t("checkout.unavailableTitle")}</p>
      <p className="mt-1 text-sm text-text-muted">{t("checkout.unavailableBody", { names: blockedNames.join("، ") })}</p>
      <Link to={`/${lang}/cart`} className="mt-2 inline-block text-sm font-bold text-action hover:underline">
        {t("checkout.reviewCart")}
      </Link>
    </div>
  );
}

import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import type { OrderRow } from "~/features/orders/api";
import { Badge } from "~/components/ui/Badge";
import { CashIcon, CreditCardIcon, ReceiptIcon } from "~/components/ui/icons";
import { makeMoneyFormatter, type OrderActionData } from "./shared";

/** Admin order detail — financial summary, payment method/status and the COD collect action (US-13). */
export function FinancialSummaryCard({
  order,
  en,
}: {
  order: OrderRow;
  en: boolean | undefined;
}) {
  const { t } = useTranslation();
  const money = makeMoneyFormatter(en);
  const codFetcher = useFetcher<OrderActionData>();

  return (
    <section className="rounded-lg border border-border bg-surface p-4 sm:p-6 shadow-1 space-y-4">
      {/* Financial Summary */}
      <h2 className="text-sm font-extrabold text-text flex items-center gap-2 border-b border-border/60 pb-3">
        <ReceiptIcon className="size-4 text-action" />
        {t("order.summary")}
      </h2>

      <dl className="space-y-2 text-xs">
        <div className="flex justify-between">
          <dt className="text-text-muted">{t("cart.subtotal")}</dt>
          <dd className="font-bold font-mono text-text">{money(order.subtotal_piastres)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-text-muted">{t("cart.discount")}</dt>
          <dd className="font-bold font-mono text-success">−{money(order.discount_piastres)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-text-muted">{t("cart.shipping")}</dt>
          <dd className="font-bold font-mono text-text">{money(order.shipping_fee_piastres)}</dd>
        </div>
        <div className="flex justify-between border-t border-border pt-3 text-sm">
          <dt className="font-black text-text">{t("cart.total")}</dt>
          <dd className="font-black font-mono text-action text-base">{money(order.total_piastres)}</dd>
        </div>
        {(order.wallet_paid_piastres ?? 0) > 0 ? (
          <>
            <div className="flex justify-between">
              <dt className="text-text-muted">{t("checkout.pay_wallet")}</dt>
              <dd className="font-bold font-mono text-success">−{money(order.wallet_paid_piastres ?? 0)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="font-bold text-text">{t("order.dueNow")}</dt>
              <dd className="font-bold font-mono text-text">
                {money(Math.max(0, order.total_piastres - (order.wallet_paid_piastres ?? 0)))}
              </dd>
            </div>
          </>
        ) : null}
      </dl>

      <div className="rounded-lg border border-border/60 bg-surface-tint/30 p-3 space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-text-muted flex items-center gap-1.5">
            {order.payment_method === "cod" ? (
              <CashIcon className="size-4 text-action" />
            ) : (
              <CreditCardIcon className="size-4 text-action" />
            )}
            {t("order.paymentMethod")}:
          </span>
          <span className="font-bold text-text">
            {order.payment_method === "cod" ? t("checkout.pay_cod") : order.payment_method === "wallet" ? t("checkout.pay_wallet") : t("checkout.pay_kashier")}
          </span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-text-muted">الحالة:</span>
          <Badge
            tone={
              order.payment_status === "paid"
                ? "success"
                : order.payment_status === "cod_pending"
                ? "warning"
                : "neutral"
            }
            dot
          >
            {t(`order.pay_${order.payment_status}`)}
          </Badge>
        </div>
      </div>

      {order.payment_method === "cod" && order.payment_status === "cod_pending" ? (
        <codFetcher.Form method="post" preventScrollReset>
          <input type="hidden" name="intent" value="cod_collect" />
          <button
            type="submit"
            className="w-full cursor-pointer rounded-lg bg-action px-4 py-2.5 text-xs font-extrabold text-on-action hover:bg-action-hover transition-colors shadow-1"
          >
            {t("order.codCollect")}
          </button>
        </codFetcher.Form>
      ) : null}

      {codFetcher.data && !codFetcher.data.ok ? (
        <p role="alert" className="text-xs font-semibold text-danger">
          {codFetcher.data.reason === "already_collected"
            ? t("order.codAlreadyCollected")
            : t("order.updateFailed")}
        </p>
      ) : null}
    </section>
  );
}

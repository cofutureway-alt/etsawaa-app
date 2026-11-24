import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import type { OrderRow } from "~/features/orders/api";
import { Badge } from "~/components/ui/Badge";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, CopyIcon, ReceiptIcon, TruckIcon } from "~/components/ui/icons";
import { getOrderStatusTone } from "./shared";

/**
 * Admin order detail — header bar: breadcrumb back to the orders list, order
 * number with copy-to-clipboard, overall status badge, creation date, and the
 * quick print actions (invoice A4 + carrier label A5). Print links receive the
 * copies/pieces query from the route so they always match the print center.
 */
export function OrderDetailHeader({
  lang,
  order,
  en,
  print,
}: {
  lang: string;
  order: OrderRow;
  en: boolean | undefined;
  print: (doc: string, vendor?: string) => string;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopyOrderNumber = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(order.number);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const orderDateStr = order.created_at
    ? new Date(order.created_at).toLocaleString(en ? "en-EG" : "ar-EG-u-nu-latn", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 sm:p-6 shadow-1 md:flex-row md:items-center md:justify-between">
      <div className="space-y-2">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-text-muted">
          <Link
            to={`/${lang}/admin/orders`}
            className="inline-flex items-center gap-1 font-semibold text-action hover:underline"
          >
            {en ? <ChevronLeftIcon className="size-3" /> : <ChevronRightIcon className="size-3" />}
            {t("adminNav.orders")}
          </Link>
          <span className="text-border">/</span>
          <span className="font-mono font-medium text-text">#{order.number}</span>
        </nav>

        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl sm:text-2xl font-black tracking-tight text-text">
            {t("order.title")}{" "}
            <span dir="ltr" className="font-mono text-action">
              {order.number}
            </span>
          </h1>
          {order.payment_mode === "test" ? <Badge tone="warning">{t("pay.testBadge")}</Badge> : null}

          <button
            type="button"
            onClick={handleCopyOrderNumber}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-tint/50 px-2 py-1 text-xs font-semibold text-text-muted hover:border-action hover:text-action transition-colors cursor-pointer"
            title="Copy Order Number"
          >
            {copied ? (
              <>
                <CheckIcon className="size-3.5 text-success" />
                <span className="text-success font-bold text-2xs">Copied</span>
              </>
            ) : (
              <>
                <CopyIcon className="size-3.5" />
                <span className="text-2xs">Copy</span>
              </>
            )}
          </button>

          <Badge tone={getOrderStatusTone(order.status)} dot>
            {t(`order.status_${order.status}`)}
          </Badge>
        </div>

        {orderDateStr ? (
          <p className="text-xs text-text-muted">
            {orderDateStr}
          </p>
        ) : null}
      </div>

      {/* Quick Actions */}
      <div className="flex flex-wrap items-center gap-2 pt-2 md:pt-0 border-t border-border/40 md:border-t-0">
        <a
          href={print("invoice_admin")}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-bold text-text hover:bg-surface-tint transition-colors shadow-1"
        >
          <ReceiptIcon className="size-4 text-action" />
          {t("order.printInvoiceA4")}
        </a>
        <a
          href={print("label_carrier")}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg bg-action px-3 py-2 text-xs font-bold text-on-action hover:bg-action-hover transition-colors shadow-1"
        >
          <TruckIcon className="size-4" />
          {t("order.printCarrierA5")}
        </a>
      </div>
    </div>
  );
}

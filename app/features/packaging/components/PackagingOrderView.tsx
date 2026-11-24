import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Card, CardBody, CardHeader } from "~/components/ui";
import type { BadgeTone } from "~/components/ui/Badge";
import { formatPiastres } from "~/lib/money";
import type { PackagingOrderFull, PackagingReturnRow } from "../api.server";

/**
 * One packaging order as both the seller and the admin see it: items with
 * their unit, money (plan, paid, open balance, refunds), every payment
 * attempt (failures included), returns and the full event history. The
 * page supplies the actions (pay / cancel / return for the seller; process /
 * ship / deliver / record payment / returns for the admin).
 */

export const ORDER_TONE: Record<string, BadgeTone> = {
  pending_payment: "warning", confirmed: "info", processing: "info", shipped: "info", delivered: "success", cancelled: "danger",
};
export const PAY_TONE: Record<string, BadgeTone> = {
  unpaid: "warning", deposit_paid: "info", paid: "success", cod_pending: "warning", refunded: "neutral", partially_refunded: "neutral",
};
export const RET_TONE: Record<string, BadgeTone> = {
  requested: "warning", approved: "info", received: "info", refunded: "success", rejected: "danger",
};

export function PackagingStatusBadges({ status, payment, mode }: { status: string; payment: string; mode?: string }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      {mode === "test" ? <Badge tone="warning">{t("pay.testBadge")}</Badge> : null}
      <Badge tone={ORDER_TONE[status] ?? "neutral"} dot>{t(`pkg.status_${status}`)}</Badge>
      <Badge tone={PAY_TONE[payment] ?? "neutral"}>{t(`pkg.pay_${payment}`)}</Badge>
    </span>
  );
}

export function PackagingOrderView({ order, lang, actions, returnActions, documents }: {
  order: PackagingOrderFull;
  lang: "ar" | "en";
  actions?: ReactNode;
  returnActions?: (r: PackagingReturnRow) => ReactNode;
  documents?: ReactNode;
}) {
  const { t } = useTranslation();
  const en = lang === "en";
  const money = (p: number) => formatPiastres(p, lang);
  const when = (v: string) => new Date(v).toLocaleString(en ? "en-GB" : "ar-EG-u-nu-latn", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const nameOf = (id: string) => {
    const i = order.items.find((x) => x.id === id);
    return i ? (en ? i.name_en : i.name_ar) : "—";
  };
  const due = order.status === "pending_payment" ? (order.payment_plan === "split" ? order.deposit_piastres : order.total_piastres) : 0;

  return (
    <div className="grid items-start gap-4 lg:grid-cols-12">
      <div className="flex flex-col gap-4 lg:col-span-8">
        <Card>
          <CardHeader title={t("pkg.items")} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="bg-surface-tint text-xs text-text-muted">
                <tr>
                  <th className="p-2.5 text-start font-bold">{t("pkg.item")}</th>
                  <th className="p-2.5 text-start font-bold">{t("pkg.unit")}</th>
                  <th className="p-2.5 text-end font-bold">{t("pkg.qty")}</th>
                  <th className="p-2.5 text-end font-bold">{t("pkg.unitPrice")}</th>
                  <th className="p-2.5 text-end font-bold">{t("pkg.lineTotal")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {order.items.map((i) => (
                  <tr key={i.id}>
                    <td className="p-2.5"><span className="font-bold text-text">{en ? i.name_en : i.name_ar}</span><span className="num block text-2xs text-text-muted" dir="ltr">{i.sku}</span></td>
                    <td className="p-2.5 text-text-muted">{t(`pkg.unit_${i.unit}`)}</td>
                    <td className="num p-2.5 text-end">{i.qty}</td>
                    <td className="num p-2.5 text-end">{money(i.unit_price_piastres)}</td>
                    <td className="num p-2.5 text-end font-bold">{money(i.line_total_piastres)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {order.returns.length > 0 ? (
          <Card>
            <CardHeader title={t("pkg.returns")} />
            <CardBody className="flex flex-col gap-3">
              {order.returns.map((r) => (
                <article key={r.id} className="rounded-lg border border-border p-3">
                  <header className="flex flex-wrap items-center gap-2">
                    <b className="num text-sm" dir="ltr">{r.number}</b>
                    <Badge tone={RET_TONE[r.status] ?? "neutral"}>{t(`pkg.ret_${r.status}`)}</Badge>
                    {r.source === "admin" ? <Badge tone="neutral">{t("ret.source_admin")}</Badge> : null}
                    <span className="num ms-auto text-xs text-text-muted">{when(r.created_at)}</span>
                  </header>
                  <ul className="mt-1.5 text-sm text-text">
                    {r.items.map((it) => <li key={it.order_item_id}><b className="num">{it.qty}×</b> {nameOf(it.order_item_id)}</li>)}
                  </ul>
                  {r.reason ? <p className="mt-1 text-xs text-text-muted">{r.reason}</p> : null}
                  {r.admin_note ? <p className="mt-1 text-xs text-text-muted">{t("pkg.adminNote")}: {r.admin_note}</p> : null}
                  {r.status !== "requested" && r.status !== "rejected" ? (
                    <p className="mt-1 text-xs text-text">
                      {t("pkg.retRefund", { amount: money(r.refund_piastres) })}
                      {r.balance_offset_piastres > 0 ? ` · ${t("pkg.retOffset", { amount: money(r.balance_offset_piastres) })}` : ""}
                      {r.refund_method ? ` · ${t(`pkg.refund_${r.refund_method}`)}` : ""}
                    </p>
                  ) : null}
                  {returnActions ? <div className="mt-2 flex flex-wrap gap-2">{returnActions(r)}</div> : null}
                </article>
              ))}
            </CardBody>
          </Card>
        ) : null}

        <Card>
          <CardHeader title={t("pkg.history")} />
          <CardBody>
            <ol className="flex flex-col gap-1.5 text-sm">
              {order.events.map((e) => (
                <li key={e.id} className="flex gap-3">
                  <span className="num w-28 shrink-0 text-xs text-text-muted">{when(e.created_at)}</span>
                  <span className="text-text">{t(`pkg.ev_${e.event}`, { defaultValue: e.event })}{e.note ? <span className="text-text-muted"> — {e.note}</span> : null}</span>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      </div>

      <aside className="flex flex-col gap-4 lg:col-span-4">
        <Card>
          <CardHeader title={t("pkg.payment")} />
          <CardBody className="flex flex-col gap-2 text-sm">
            <p className="flex flex-wrap gap-1.5">
              <Badge tone="neutral">{t(`pkg.plan_${order.payment_plan}`)}</Badge>
              <Badge tone="neutral">{t(`pkg.method_${order.payment_method}`)}</Badge>
            </p>
            <dl className="grid grid-cols-2 gap-y-1">
              <dt className="text-text-muted">{t("pkg.subtotal")}</dt><dd className="num text-end">{money(order.subtotal_piastres)}</dd>
              <dt className="text-text-muted">{t("pkg.shipping")}</dt><dd className="num text-end">{money(order.shipping_fee_piastres)}</dd>
              <dt className="font-extrabold text-text">{t("pkg.total")}</dt><dd className="num text-end font-black">{money(order.total_piastres)}</dd>
              <dt className="text-text-muted">{t("pkg.paid")}</dt><dd className="num text-end font-bold text-success-strong">{money(order.paid_piastres)}</dd>
              {order.refunded_piastres > 0 ? (<><dt className="text-text-muted">{t("pkg.refunded")}</dt><dd className="num text-end">−{money(order.refunded_piastres)}</dd></>) : null}
              {due > 0 ? (<><dt className="font-bold text-warning-strong">{t("pkg.dueNow")}</dt><dd className="num text-end font-black text-warning-strong">{money(due)}</dd></>) : null}
            </dl>
            {order.balance ? (
              <div className={`rounded-md border p-2.5 text-xs ${order.balance.status === "open" ? "border-warning/40 bg-warning-soft" : "border-border bg-surface-tint"}`}>
                <p className="font-bold text-text">{t(`pkg.bal_${order.balance.status}`, { amount: money(order.balance.amount_piastres) })}</p>
                <p className="mt-0.5 text-text-muted">{t("pkg.balHint", { amount: money(order.balance.original_piastres) })}</p>
              </div>
            ) : null}
            {order.payments.length > 0 ? (
              <ul className="mt-1 flex flex-col gap-1 border-t border-border pt-2 text-xs">
                {order.payments.map((p) => (
                  <li key={p.provider_ref + p.kind} className="flex flex-wrap items-baseline justify-between gap-x-2">
                    <span className={p.status === "failed" ? "text-danger" : "text-text"}>
                      {t(`pkg.k_${p.kind}`)} · {t(`pkg.m_${p.method}`)}{p.status === "failed" ? ` · ${t("pkg.failed")}` : ""}
                    </span>
                    <span className="num font-bold">{p.kind === "refund" ? "−" : ""}{money(p.amount_piastres)}</span>
                    <span className="num w-full text-2xs text-text-faint" dir="ltr">{when(p.created_at)} · {p.provider_ref}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t("pkg.delivery")} />
          <CardBody className="flex flex-col gap-1 text-sm">
            <p className="font-bold text-text">{order.ship_name}</p>
            {order.ship_phone ? <p className="num text-text-muted" dir="ltr">{order.ship_phone}</p> : null}
            <p className="text-text-muted">{order.ship_address}</p>
            {order.tracking_number ? <p className="text-xs text-text">{order.carrier} · <span className="num" dir="ltr">{order.tracking_number}</span></p> : null}
            {order.cancel_reason ? <p className="text-xs text-danger">{t("pkg.cancelReason")}: {order.cancel_reason}</p> : null}
          </CardBody>
        </Card>

        {actions ? <Card><CardBody className="flex flex-col gap-2">{actions}</CardBody></Card> : null}
        {documents ? <Card><CardHeader title={t("pkg.documents")} /><CardBody className="flex flex-col gap-1.5">{documents}</CardBody></Card> : null}
      </aside>
    </div>
  );
}

export function DocLinks({ number, lang, returns }: { number: string; lang: "ar" | "en"; returns: PackagingReturnRow[] }) {
  const { t } = useTranslation();
  const href = (doc: string, extra = "") => `/packaging/${encodeURIComponent(number)}/print/${doc}?lang=${lang}${extra}`;
  const cls = "rounded-md border border-border px-3 py-2 text-sm font-bold text-text hover:bg-surface-tint";
  return (
    <>
      <a href={href("invoice")} target="_blank" rel="noreferrer" className={cls}>{t("pkg.docInvoice")}</a>
      <a href={href("label")} target="_blank" rel="noreferrer" className={cls}>{t("pkg.docLabel")}</a>
      {returns.filter((r) => r.status !== "rejected").map((r) => (
        <a key={r.id} href={href("return_label", `&return=${r.id}`)} target="_blank" rel="noreferrer" className={cls}>
          {t("pkg.docReturnLabel")} <span className="num" dir="ltr">{r.number}</span>
        </a>
      ))}
    </>
  );
}

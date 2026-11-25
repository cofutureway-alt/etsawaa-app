import { useEffect, useMemo, useState } from "react";
import { Link, useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { Badge, Button, Card, CardBody, CardHeader, Dialog } from "~/components/ui";
import { RotateIcon } from "~/components/ui/icons";
import { egpToPiastres, formatPiastres, piastresToEgp } from "~/lib/money";
import { useActionToast } from "~/components/layout/ActionFeedback";
import type { GroupRow, ItemRow } from "~/features/orders/api";
import { lineRefund, refundTotals, type LineState } from "~/features/orders/refund-math";

/**
 * Admin → order → Returns & refunds.
 *
 * "Start a return" picks exactly which lines (and how many units of each)
 * come back. The amount per line is what the buyer paid for those units
 * (coupon share included) and can only be lowered; shipping refund and a
 * return-shipping deduction are order-level. The server recomputes and caps
 * everything (fn_admin_create_return) — the numbers here are a preview.
 * Below: every return on this order with its status, money and history,
 * and the next action (mark received → issue refund).
 */

export interface ReturnRow {
  id: string;
  source: string;
  kind: string;
  status: string;
  logistics_status: string;
  items_refund_piastres: number;
  shipping_refund_piastres: number;
  deduction_piastres: number;
  refund_total_piastres: number;
  refund_method: string | null;
  refund_reference: string | null;
  description: string;
  created_at: string;
  items: Array<{ order_item_id: string; qty: number; reason: string; decision: string | null; fault: string | null;
    refund_amount_piastres: number | null; vendor_debit_piastres: number; restock: boolean; restocked_qty: number }>;
  events: Array<{ id: string; event: string; note: string | null; created_at: string }>;
}

export interface Refundables {
  items: Array<LineState & { order_item_id: string; group_status: string }>;
  shipping_fee: number;
  shipping_refunded: number;
}

const REASONS = ["change_of_mind", "defect", "damaged", "wrong_item", "not_received"] as const;
const FAULTS = ["customer", "defect", "vendor", "shipping"] as const;
const defaultFault = (reason: string) =>
  reason === "change_of_mind" ? "customer" : reason === "defect" ? "defect" : reason === "not_received" ? "shipping" : "vendor";

interface Pick { on: boolean; qty: number; reason: string; fault: string; restock: boolean; amount: string }

export function ReturnsPanel({ items, groups, refundables, returns, en }: {
  items: ItemRow[]; groups: GroupRow[]; refundables: Refundables | null; returns: ReturnRow[]; en: boolean;
}) {
  const { t } = useTranslation();
  const lang = en ? "en" : "ar";
  const money = (p: number) => formatPiastres(p, lang);
  const [open, setOpen] = useState(false);
  const [refundFor, setRefundFor] = useState<ReturnRow | null>(null);
  const fetcher = useFetcher<{ ok: boolean; reason?: string }>();
  useActionToast(fetcher, { success: t("ret.saved") });
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) { setOpen(false); setRefundFor(null); }
  }, [fetcher.state, fetcher.data]);

  const state = useMemo(() => new Map((refundables?.items ?? []).map((s) => [s.order_item_id, s])), [refundables]);
  const vendorName = (groupId: string) => {
    const g = groups.find((x) => x.id === groupId);
    return g ? (en ? g.vendor.store_name_en : g.vendor.store_name_ar) : "";
  };
  const nameOf = (id: string) => {
    const it = items.find((i) => i.id === id);
    return it ? (en ? it.product_name_en || it.product_name_ar : it.product_name_ar || it.product_name_en) : "—";
  };
  const returnable = items.filter((i) => (state.get(i.id)?.qty_left ?? 0) > 0);

  return (
    <Card>
      <CardHeader
        title={t("ret.title")}
        action={
          <Button size="sm" onClick={() => setOpen(true)} disabled={!refundables || returnable.length === 0}>
            <RotateIcon className="size-4" /> {t("ret.start")}
          </Button>
        }
      />
      <CardBody className="flex flex-col gap-3">
        {returns.length === 0 ? (
          <p className="text-sm text-text-muted">{t("ret.none")}</p>
        ) : (
          returns.map((r) => (
            <ReturnCard key={r.id} r={r} en={en} nameOf={nameOf} money={money}
              onRefund={() => setRefundFor(r)} fetcher={fetcher} />
          ))
        )}
        {returnable.length === 0 && items.length > 0 ? (
          <p className="text-xs text-text-muted">{t("ret.nothingLeft")}</p>
        ) : null}
      </CardBody>

      {open && refundables ? (
        <StartReturnDialog items={items} refundables={refundables} state={state} vendorName={vendorName}
          en={en} money={money} fetcher={fetcher} onClose={() => setOpen(false)} />
      ) : null}

      <Dialog open={refundFor !== null} onClose={() => setRefundFor(null)} title={t("ret.issueTitle")}>
        {refundFor ? (
          <fetcher.Form method="post" className="flex flex-col gap-3 p-4">
            <input type="hidden" name="intent" value="execute_refund" />
            <input type="hidden" name="request_id" value={refundFor.id} />
            <p className="text-sm text-text">{t("ret.issueBody", { amount: money(refundFor.refund_total_piastres) })}</p>
            <label className="flex flex-col gap-1 text-sm font-bold text-text">
              {t("ret.method")}
              <select name="method" defaultValue="store_wallet" className="rounded-md border border-border bg-surface p-2.5 text-sm">
                {["store_wallet", "original", "bank_transfer", "wallet", "cash", "other"].map((m) => <option key={m} value={m}>{t(`ret.method_${m}`)}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-bold text-text">
              {t("ret.reference")}
              <input name="reference" dir="ltr" className="rounded-md border border-border bg-surface p-2.5 text-sm" placeholder="TX-…" />
            </label>
            <label className="flex flex-col gap-1 text-sm font-bold text-text">
              {t("ret.note")}
              <textarea name="note" rows={2} className="rounded-md border border-border bg-surface p-2.5 text-sm" />
            </label>
            <Button type="submit" loading={fetcher.state !== "idle"}>{t("ret.issueConfirm")}</Button>
          </fetcher.Form>
        ) : null}
      </Dialog>
    </Card>
  );
}

function ReturnCard({ r, en, nameOf, money, onRefund, fetcher }: {
  r: ReturnRow; en: boolean; nameOf: (id: string) => string; money: (p: number) => string;
  onRefund: () => void; fetcher: ReturnType<typeof useFetcher<{ ok: boolean; reason?: string }>>;
}) {
  const { t } = useTranslation();
  const tone = r.status === "refunded" ? "success" : r.status === "approved" ? "info" : r.status === "rejected" ? "danger" : "warning";
  const day = (v: string) => new Date(v).toLocaleString(en ? "en-GB" : "ar-EG-u-nu-latn", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <article className="rounded-lg border border-border bg-surface-alt/40 p-3">
      <header className="flex flex-wrap items-center gap-2">
        <Badge tone={tone}>{t(`ret.status_${r.status}`)}</Badge>
        {r.status !== "rejected" ? <Badge tone={r.logistics_status === "awaiting_return" ? "warning" : "neutral"}>{t(`ret.log_${r.logistics_status}`)}</Badge> : null}
        <Badge tone="neutral">{t(`ret.source_${r.source}`)}</Badge>
        <span className="num ms-auto text-xs text-text-muted">{day(r.created_at)}</span>
      </header>
      <ul className="mt-2 flex flex-col gap-1 text-sm">
        {r.items.map((it) => (
          <li key={it.order_item_id} className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="min-w-0 text-text">
              <b className="num">{it.qty}×</b> {nameOf(it.order_item_id)}
              <span className="text-xs text-text-muted"> · {t(`returns.reason_${it.reason}`)}{it.fault ? ` · ${t(`ret.fault_${it.fault}`)}` : ""}</span>
            </span>
            <span className={`num text-xs font-bold ${it.decision === "reject" ? "text-text-muted line-through" : "text-text"}`}>
              {it.decision ? money(it.refund_amount_piastres ?? 0) : t("ret.undecided")}
            </span>
          </li>
        ))}
      </ul>
      {r.status !== "pending_admin" && r.status !== "rejected" ? (
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 border-t border-border pt-2 text-xs sm:grid-cols-4">
          <div><dt className="text-text-muted">{t("ret.itemsAmount")}</dt><dd className="num font-bold">{money(r.items_refund_piastres)}</dd></div>
          <div><dt className="text-text-muted">{t("ret.shippingRefund")}</dt><dd className="num font-bold">{money(r.shipping_refund_piastres)}</dd></div>
          <div><dt className="text-text-muted">{t("ret.deduction")}</dt><dd className="num font-bold">−{money(r.deduction_piastres)}</dd></div>
          <div><dt className="text-text-muted">{t("ret.toBuyer")}</dt><dd className="num font-black text-action">{money(r.refund_total_piastres)}</dd></div>
        </dl>
      ) : null}
      {r.events.length > 0 ? (
        <ol className="mt-2 flex flex-col gap-0.5 border-t border-border pt-2 text-2xs text-text-muted">
          {r.events.map((e) => (
            <li key={e.id}><span className="num">{day(e.created_at)}</span> — {t(`ret.ev_${e.event}`, { defaultValue: e.event })}{e.note ? `: ${e.note}` : ""}</li>
          ))}
        </ol>
      ) : null}
      {r.refund_method ? (
        <p className="mt-1 text-2xs text-text-muted">{t(`ret.method_${r.refund_method}`)}{r.refund_reference ? ` · ${r.refund_reference}` : ""}</p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {r.status === "pending_admin" ? (
          <Link to={`/${en ? "en" : "ar"}/admin/refunds?status=pending_admin`} className="text-sm font-bold text-action hover:underline">{t("ret.decideInQueue")}</Link>
        ) : null}
        {r.status === "approved" && r.logistics_status === "awaiting_return" ? (
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="return_received" />
            <input type="hidden" name="request_id" value={r.id} />
            <Button type="submit" size="sm" variant="outline" loading={fetcher.state !== "idle"}>{t("ret.markReceived")}</Button>
          </fetcher.Form>
        ) : null}
        {r.status === "approved" && r.logistics_status !== "awaiting_return" && r.refund_total_piastres > 0 ? (
          <Button size="sm" onClick={onRefund}>{t("ret.issue")}</Button>
        ) : null}
      </div>
    </article>
  );
}

function StartReturnDialog({ items, refundables, state, vendorName, en, money, fetcher, onClose }: {
  items: ItemRow[]; refundables: Refundables; state: Map<string, Refundables["items"][number]>;
  vendorName: (groupId: string) => string; en: boolean; money: (p: number) => string;
  fetcher: ReturnType<typeof useFetcher<{ ok: boolean; reason?: string }>>; onClose: () => void;
}) {
  const { t } = useTranslation();
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [shipping, setShipping] = useState("");
  const [deduction, setDeduction] = useState("");
  const [logistics, setLogistics] = useState("awaiting_return");
  const [note, setNote] = useState("");
  const set = (id: string, patch: Partial<Pick>) => setPicks((p) => {
    const base: Pick = p[id] ?? { on: false, qty: 1, reason: "change_of_mind", fault: "customer", restock: true, amount: "" };
    return { ...p, [id]: { ...base, ...patch } };
  });
  const shippingLeft = Math.max(refundables.shipping_fee - refundables.shipping_refunded, 0);

  const lines = items.map((it) => {
    const st = state.get(it.id);
    const pick = picks[it.id];
    const full = st && pick?.on ? lineRefund(st, pick.qty) : 0;
    const typed = pick?.amount ? egpToPiastres(pick.amount) : null;
    const amount = typed !== null && typed > 0 ? Math.min(typed, full) : full;
    return { it, st, pick, full, amount };
  });
  const chosen = lines.filter((l) => l.pick?.on && l.st);
  const totals = refundTotals(chosen.map((l) => l.amount), egpToPiastres(shipping) ?? 0, shippingLeft, egpToPiastres(deduction) ?? 0);

  const payload = JSON.stringify({
    note, logistics_status: logistics,
    shipping_refund_piastres: totals.shipping, deduction_piastres: totals.deduction,
    items: chosen.map((l) => ({
      order_item_id: l.it.id, qty: l.pick!.qty, reason: l.pick!.reason, fault: l.pick!.fault, restock: l.pick!.restock,
      ...(l.amount < l.full ? { amount: l.amount } : {}),
    })),
  });
  const INPUT = "w-full rounded-md border border-border bg-surface p-2 text-sm text-text";

  return (
    <Dialog open onClose={onClose} title={t("ret.startTitle")} size="lg">
      <fetcher.Form method="post" className="flex min-h-0 flex-1 flex-col">
        <input type="hidden" name="intent" value="create_return" />
        <input type="hidden" name="payload" value={payload} />
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          <p className="text-xs text-text-muted">{t("ret.startHint")}</p>
          <ul className="flex flex-col gap-2">
            {lines.map(({ it, st, pick, full }) => {
              const left = st?.qty_left ?? 0;
              const delivered = st?.group_status === "delivered";
              const disabled = !delivered || left === 0;
              return (
                <li key={it.id} className={`rounded-lg border p-3 ${pick?.on ? "border-action/60 bg-action/5" : "border-border"}`}>
                  <label className={`flex items-start gap-3 ${disabled ? "opacity-60" : "cursor-pointer"}`}>
                    <input type="checkbox" className="mt-1 size-4 accent-[var(--color-action)]" disabled={disabled}
                      checked={pick?.on ?? false} onChange={(e) => set(it.id, { on: e.target.checked, qty: Math.min(pick?.qty ?? 1, left) || 1 })} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-bold text-text">{en ? it.product_name_en || it.product_name_ar : it.product_name_ar || it.product_name_en}</span>
                      <span className="block text-xs text-text-muted">
                        {vendorName(it.group_id)}{(en ? it.option_label_en : it.option_label_ar) ? ` · ${en ? it.option_label_en : it.option_label_ar}` : ""} · {t("ret.bought", { n: it.qty })}
                        {st && st.qty_returned > 0 ? ` · ${t("ret.alreadyReturned", { n: st.qty_returned })}` : ""}
                      </span>
                      {!delivered ? <span className="block text-xs font-bold text-warning-strong">{t("ret.notDelivered")}</span> : null}
                      {delivered && left === 0 ? <span className="block text-xs font-bold text-text-muted">{t("ret.fullyReturned")}</span> : null}
                    </span>
                    <span className="num text-sm font-bold text-text">{st ? money(st.buyer_net) : ""}</span>
                  </label>
                  {pick?.on && st ? (
                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                      <label className="flex flex-col gap-1 text-xs font-bold text-text-muted">
                        {t("ret.qty")}
                        <select value={pick.qty} onChange={(e) => set(it.id, { qty: Number(e.target.value), amount: "" })} className={INPUT}>
                          {Array.from({ length: left }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-bold text-text-muted">
                        {t("ret.reason")}
                        <select value={pick.reason} onChange={(e) => set(it.id, { reason: e.target.value, fault: defaultFault(e.target.value) })} className={INPUT}>
                          {REASONS.map((r) => <option key={r} value={r}>{t(`returns.reason_${r}`)}</option>)}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-bold text-text-muted">
                        {t("ret.fault")}
                        <select value={pick.fault} onChange={(e) => set(it.id, { fault: e.target.value })} className={INPUT}>
                          {FAULTS.map((f) => <option key={f} value={f}>{t(`ret.fault_${f}`)}</option>)}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-bold text-text-muted">
                        {t("ret.amount")}
                        <input inputMode="decimal" dir="ltr" placeholder={piastresToEgp(full)} value={pick.amount}
                          onChange={(e) => set(it.id, { amount: e.target.value })} className={INPUT} />
                      </label>
                      <label className="flex items-center gap-2 self-end pb-2 text-xs font-bold text-text">
                        <input type="checkbox" checked={pick.restock} onChange={(e) => set(it.id, { restock: e.target.checked })} className="size-4 accent-[var(--color-action)]" />
                        {t("ret.restock")}
                      </label>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs font-bold text-text-muted">
              {t("ret.shippingRefund")} <span className="font-normal">{t("ret.shippingLeft", { amount: money(shippingLeft) })}</span>
              <input inputMode="decimal" dir="ltr" value={shipping} onChange={(e) => setShipping(e.target.value)} className={INPUT} placeholder="0" />
            </label>
            <label className="flex flex-col gap-1 text-xs font-bold text-text-muted">
              {t("ret.deduction")} <span className="font-normal">{t("ret.deductionHint")}</span>
              <input inputMode="decimal" dir="ltr" value={deduction} onChange={(e) => setDeduction(e.target.value)} className={INPUT} placeholder="0" />
            </label>
          </div>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-xs font-bold text-text-muted">{t("ret.logistics")}</legend>
            {["awaiting_return", "received", "not_required"].map((v) => (
              <label key={v} className="flex items-center gap-2 text-sm text-text">
                <input type="radio" name="logistics_ui" checked={logistics === v} onChange={() => setLogistics(v)} className="accent-[var(--color-action)]" />
                {t(`ret.logChoice_${v}`)}
              </label>
            ))}
          </fieldset>
          <label className="flex flex-col gap-1 text-xs font-bold text-text-muted">
            {t("ret.note")}
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={INPUT} />
          </label>
        </div>
        <footer className="flex flex-wrap items-center gap-3 border-t border-border bg-surface px-4 py-3">
          <dl className="flex flex-1 flex-wrap gap-x-4 gap-y-0.5 text-xs">
            <div><dt className="inline text-text-muted">{t("ret.itemsAmount")}: </dt><dd className="num inline font-bold">{money(totals.items)}</dd></div>
            {totals.shipping > 0 ? <div><dt className="inline text-text-muted">{t("ret.shippingRefund")}: </dt><dd className="num inline font-bold">{money(totals.shipping)}</dd></div> : null}
            {totals.deduction > 0 ? <div><dt className="inline text-text-muted">{t("ret.deduction")}: </dt><dd className="num inline font-bold">−{money(totals.deduction)}</dd></div> : null}
            <div><dt className="inline text-text-muted">{t("ret.toBuyer")}: </dt><dd className="num inline font-black text-action">{money(totals.total)}</dd></div>
          </dl>
          <Button type="submit" disabled={chosen.length === 0} loading={fetcher.state !== "idle"}>{t("ret.create", { n: chosen.length })}</Button>
        </footer>
      </fetcher.Form>
    </Dialog>
  );
}

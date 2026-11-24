import { useEffect, useState } from "react";
import { Link, data, useFetcher } from "react-router";
import type { Route } from "./+types/packaging-order";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { egpToPiastres, piastresToEgp } from "~/lib/money";
import { Button, Dialog } from "~/components/ui";
import { PageHeader } from "~/components/layout/PageHeader";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonPage } from "~/components/ui/Skeleton";
import { useActionToast } from "~/components/layout/ActionFeedback";
import { getPackagingOrder } from "~/features/packaging/api.server";
import { DocLinks, PackagingOrderView, PackagingStatusBadges } from "~/features/packaging/components/PackagingOrderView";

/**
 * Admin → one packaging order: fulfil it (process → ship with tracking →
 * deliver; COD is marked collected on delivery), record a payment taken
 * outside the gateway, cancel with a refund (wallet or original method),
 * run returns (approve → receive/restock → refund, an open balance is
 * reduced first), and print the invoice / labels.
 */

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const order = await getPackagingOrder(client, decodeURIComponent(params.number ?? ""));
  if (!order) throw new Response("Not found", { status: 404 });
  return { lang, order };
}

type Res = { ok: boolean; reason?: string };
const reply = (res: { data: unknown; error: { message: string } | null }) => {
  if (res.error) return data({ ok: false, reason: "server_error" }, { status: 500 });
  const r = res.data as Res;
  return r.ok ? { ok: true as const } : data({ ok: false, reason: r.reason ?? "failed" }, { status: 400 });
};

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const order = await getPackagingOrder(client, decodeURIComponent(params.number ?? ""));
  if (!order) return data({ ok: false, reason: "not_found" }, { status: 404 });
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const s = (k: string) => String(form.get(k) ?? "").trim();

  if (["process", "ship", "deliver", "cancel"].includes(intent)) {
    return reply(await client.rpc("fn_admin_packaging_order_action", {
      p_order_id: order.id, p_action: intent,
      p_payload: { carrier: s("carrier"), tracking_number: s("tracking_number"), reason: s("reason"), refund_method: s("refund_method") || "wallet", reference: s("reference") },
    }));
  }
  if (intent === "record_payment") {
    return reply(await client.rpc("fn_admin_packaging_record_payment", {
      p_order_id: order.id, p_amount: egpToPiastres(form.get("amount")) ?? 0, p_reference: s("reference"), p_note: s("note"),
    }));
  }
  if (intent === "create_return") {
    const items = order.items.map((i) => ({ order_item_id: i.id, qty: Number(form.get(`qty_${i.id}`) ?? 0) })).filter((x) => x.qty > 0);
    return reply(await client.rpc("fn_admin_create_packaging_return", { p_order_id: order.id, p_items: items, p_reason: s("reason") }));
  }
  if (intent.startsWith("return_")) {
    const amount = s("amount") ? egpToPiastres(form.get("amount")) : null;
    return reply(await client.rpc("fn_admin_packaging_return_action", {
      p_return_id: s("return_id"), p_action: intent.slice("return_".length),
      p_payload: { note: s("note"), refund_method: s("refund_method") || "wallet", reference: s("reference"), ...(amount ? { amount_piastres: amount } : {}) },
    }));
  }
  return data({ ok: false, reason: "bad_intent" }, { status: 400 });
}

type DialogKind = "ship" | "cancel" | "record_payment" | "create_return" | { kind: "return_approve" | "return_reject" | "return_refund"; id: string } | null;

export default function AdminPackagingOrder({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { lang, order } = loaderData;
  const en = lang === "en";
  const fetcher = useFetcher<typeof action>();
  const [dialog, setDialog] = useState<DialogKind>(null);
  useActionToast(fetcher, { success: t("common.saved") });
  useEffect(() => { if (fetcher.state === "idle" && fetcher.data?.ok) setDialog(null); }, [fetcher.state, fetcher.data]);
  const busy = fetcher.state !== "idle";
  const INPUT = "w-full rounded-md border border-border bg-surface p-2.5 text-sm text-text";
  const L = "flex flex-col gap-1 text-xs font-bold text-text-muted";
  const due = order.status === "pending_payment" ? (order.payment_plan === "split" ? order.deposit_piastres : order.total_piastres) : 0;
  const quick = (intent: string, label: string) => (
    <fetcher.Form method="post"><input type="hidden" name="intent" value={intent} /><Button type="submit" block loading={busy}>{label}</Button></fetcher.Form>
  );

  const actions = (
    <>
      {order.status === "pending_payment" ? <Button block onClick={() => setDialog("record_payment")}>{t("pkg.recordPayment")}</Button> : null}
      {order.status === "confirmed" ? quick("process", t("pkg.actProcess")) : null}
      {order.status === "confirmed" || order.status === "processing" ? <Button block variant={order.status === "confirmed" ? "outline" : "primary"} onClick={() => setDialog("ship")}>{t("pkg.actShip")}</Button> : null}
      {order.status === "shipped" ? quick("deliver", t("pkg.actDeliver")) : null}
      {order.status === "delivered" ? <Button block variant="outline" onClick={() => setDialog("create_return")}>{t("pkg.createReturn")}</Button> : null}
      {order.status !== "delivered" && order.status !== "cancelled" ? <Button block variant="ghost" onClick={() => setDialog("cancel")}>{t("pkg.actCancel")}</Button> : null}
      {order.status === "cancelled" ? <p className="text-xs text-text-muted">{t("pkg.closed")}</p> : null}
    </>
  );

  const returnActions = (r: (typeof order.returns)[number]) => (
    <>
      {r.status === "requested" ? <Button size="sm" onClick={() => setDialog({ kind: "return_approve", id: r.id })}>{t("pkg.retApprove")}</Button> : null}
      {r.status === "requested" ? <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "return_reject", id: r.id })}>{t("pkg.retReject")}</Button> : null}
      {r.status === "approved" ? (
        <fetcher.Form method="post"><input type="hidden" name="intent" value="return_receive" /><input type="hidden" name="return_id" value={r.id} />
          <Button size="sm" variant="outline" type="submit" loading={busy}>{t("pkg.retReceive")}</Button></fetcher.Form>
      ) : null}
      {r.status === "received" ? <Button size="sm" onClick={() => setDialog({ kind: "return_refund", id: r.id })}>{t("pkg.retRefundBtn")}</Button> : null}
    </>
  );
  const retDialog = dialog && typeof dialog === "object" ? dialog : null;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={`${t("pkg.order")} ${order.number}`} subtitle={order.store_name}
        actions={<div className="flex flex-wrap items-center gap-2"><PackagingStatusBadges status={order.status} payment={order.payment_status} mode={order.payment_mode} />
          <Link to={`/${lang}/admin/packaging/orders`} className="text-sm font-bold text-action hover:underline">{t("pkg.opsTitle")}</Link></div>} />
      <PackagingOrderView order={order} lang={lang} actions={actions} returnActions={returnActions}
        documents={<DocLinks number={order.number} lang={lang} returns={order.returns} />} />

      <Dialog open={dialog === "record_payment"} onClose={() => setDialog(null)} title={t("pkg.recordPayment")}>
        <fetcher.Form method="post" className="flex flex-col gap-3 p-4">
          <input type="hidden" name="intent" value="record_payment" />
          <p className="text-sm text-text-muted">{t("pkg.recordHint")}</p>
          <label className={L}>{t("pkg.amount")}<input name="amount" required inputMode="decimal" dir="ltr" defaultValue={piastresToEgp(due)} className={INPUT} /></label>
          <label className={L}>{t("pkg.reference")}<input name="reference" required dir="ltr" className={INPUT} /></label>
          <label className={L}>{t("ret.note")}<input name="note" className={INPUT} /></label>
          <Button type="submit" loading={busy}>{t("pkg.recordPayment")}</Button>
        </fetcher.Form>
      </Dialog>

      <Dialog open={dialog === "ship"} onClose={() => setDialog(null)} title={t("pkg.actShip")}>
        <fetcher.Form method="post" className="flex flex-col gap-3 p-4">
          <input type="hidden" name="intent" value="ship" />
          <label className={L}>{t("pkg.carrier")}<input name="carrier" className={INPUT} /></label>
          <label className={L}>{t("pkg.tracking")}<input name="tracking_number" dir="ltr" className={INPUT} /></label>
          <Button type="submit" loading={busy}>{t("pkg.actShip")}</Button>
        </fetcher.Form>
      </Dialog>

      <Dialog open={dialog === "cancel"} onClose={() => setDialog(null)} title={t("pkg.actCancel")}>
        <fetcher.Form method="post" className="flex flex-col gap-3 p-4">
          <input type="hidden" name="intent" value="cancel" />
          <p className="text-sm text-text-muted">{order.paid_piastres > 0 ? t("pkg.cancelPaidHint") : t("pkg.cancelHint")}</p>
          <label className={L}>{t("pkg.cancelReason")}<textarea name="reason" required rows={2} className={INPUT} /></label>
          {order.paid_piastres > 0 ? (
            <>
              <label className={L}>{t("pkg.refundMethod")}
                <select name="refund_method" defaultValue="wallet" className={INPUT}>
                  <option value="wallet">{t("pkg.refund_wallet")}</option>
                  <option value="original">{t("pkg.refund_original")}</option>
                </select>
              </label>
              <label className={L}>{t("pkg.reference")}<input name="reference" dir="ltr" className={INPUT} /></label>
            </>
          ) : null}
          <Button type="submit" loading={busy}>{t("pkg.actCancel")}</Button>
        </fetcher.Form>
      </Dialog>

      <Dialog open={dialog === "create_return"} onClose={() => setDialog(null)} title={t("pkg.createReturn")}>
        <fetcher.Form method="post" className="flex flex-col gap-3 p-4">
          <input type="hidden" name="intent" value="create_return" />
          {order.items.map((i) => (
            <label key={i.id} className="flex items-center justify-between gap-3 text-sm text-text">
              <span>{en ? i.name_en : i.name_ar} <span className="text-xs text-text-muted">({i.qty} {t(`pkg.unit_${i.unit}`)})</span></span>
              <select name={`qty_${i.id}`} defaultValue="0" className="rounded-md border border-border bg-surface p-1.5 text-sm">
                {Array.from({ length: i.qty + 1 }, (_, n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          ))}
          <label className={L}>{t("pkg.returnReason")}<textarea name="reason" rows={2} className={INPUT} /></label>
          <Button type="submit" loading={busy}>{t("pkg.createReturn")}</Button>
        </fetcher.Form>
      </Dialog>

      <Dialog open={retDialog !== null} onClose={() => setDialog(null)} title={retDialog ? t(`pkg.dlg_${retDialog.kind}`) : ""}>
        {retDialog ? (
          <fetcher.Form method="post" className="flex flex-col gap-3 p-4">
            <input type="hidden" name="intent" value={retDialog.kind} />
            <input type="hidden" name="return_id" value={retDialog.id} />
            {retDialog.kind === "return_approve" ? (
              <label className={L}>{t("pkg.retAmount")}<input name="amount" inputMode="decimal" dir="ltr" placeholder={t("ret.amountAuto")} className={INPUT} /></label>
            ) : null}
            {retDialog.kind === "return_refund" ? (
              <>
                <p className="text-sm text-text-muted">{t("pkg.retRefundHint")}</p>
                <label className={L}>{t("pkg.refundMethod")}
                  <select name="refund_method" defaultValue="wallet" className={INPUT}>
                    <option value="wallet">{t("pkg.refund_wallet")}</option>
                    <option value="original">{t("pkg.refund_original")}</option>
                  </select>
                </label>
                <label className={L}>{t("pkg.reference")}<input name="reference" dir="ltr" className={INPUT} /></label>
              </>
            ) : null}
            <label className={L}>{t("ret.note")}<textarea name="note" rows={2} required={retDialog.kind === "return_reject"} className={INPUT} /></label>
            <Button type="submit" loading={busy}>{t(`pkg.dlg_${retDialog.kind}`)}</Button>
          </fetcher.Form>
        ) : null}
      </Dialog>
    </div>
  );
}

export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}
export function HydrateFallback() {
  return <SkeletonPage />;
}

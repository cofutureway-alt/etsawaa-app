import { useEffect, useState } from "react";
import { Link, data, redirect, useFetcher } from "react-router";
import type { Route } from "./+types/packaging-order";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { Button, Dialog } from "~/components/ui";
import { PageHeader } from "~/components/layout/PageHeader";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonPage } from "~/components/ui/Skeleton";
import { PayMethodsNote } from "~/components/checkout/PayMethodsNote";
import { useActionToast } from "~/components/layout/ActionFeedback";
import { loadKashierSettings, reconcileKashierOrder, resolveKashierMode, startKashierPayment } from "~/features/checkout/kashier.server";
import { getSupabaseAdminClient } from "~/lib/supabase/admin";
import { getSiteUrl } from "~/lib/env.server";
import { getPackagingOrder } from "~/features/packaging/api.server";
import { DocLinks, PackagingOrderView, PackagingStatusBadges } from "~/features/packaging/components/PackagingOrderView";

/**
 * Seller → one packaging order: pay (or retry a failed card payment), cancel
 * while unpaid, request a return after delivery, print the invoice and
 * labels, follow every step. Coming back from the card page only shows the
 * state — the webhook is the only writer of payment results.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  const viewer = await requirePanelAccess(client, lang, "vendor", request);
  let order = await getPackagingOrder(client, decodeURIComponent(params.number ?? ""));
  if (!order) throw new Response("Not found", { status: 404 });
  if (order.status === "pending_payment") {
    // settle from Kashier's own record (server-to-server), then re-read
    const admin = getSupabaseAdminClient();
    const res = admin ? await reconcileKashierOrder(admin, "packaging", order.number) : null;
    if (res?.ok) order = (await getPackagingOrder(client, order.number)) ?? order;
  }
  const kashierMode = resolveKashierMode(await loadKashierSettings(client), viewer.profile.role);
  const { data: cfg } = await client.rpc("fn_packaging_settings");
  const windowDays = (cfg as { return_window_days?: number } | null)?.return_window_days ?? 14;
  const canReturn = order.status === "delivered" && !!order.delivered_at
    && Date.now() - new Date(order.delivered_at).getTime() < windowDays * 86_400_000;
  const url = new URL(request.url);
  return { lang, order, cardOnline: kashierMode !== null, cardTest: kashierMode === "test", canReturn, windowDays, returning: url.searchParams.get("kashier") === "return", placed: url.searchParams.get("placed") === "1" };
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  const viewer = await requirePanelAccess(client, lang, "vendor", request);
  const order = await getPackagingOrder(client, decodeURIComponent(params.number ?? ""));
  if (!order) return data({ ok: false, reason: "not_found" }, { status: 404 });
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "pay") {
    const due = order.status === "pending_payment" ? (order.payment_plan === "split" ? order.deposit_piastres : order.total_piastres) : 0;
    if (due <= 0) return data({ ok: false, reason: "not_awaiting_payment" }, { status: 400 });
    const settings = await loadKashierSettings(client);
    const mode = resolveKashierMode(settings, viewer.profile.role);
    const admin = getSupabaseAdminClient();
    if (!mode || !admin) return data({ ok: false, reason: "card_unavailable" }, { status: 400 });
    const session = await startKashierPayment(admin, "packaging", {
      mode, orderNumber: order.number, totalPiastres: due, lang,
      siteUrl: getSiteUrl(request.url),
      returnPath: `/${lang}/vendor/packaging/orders/${encodeURIComponent(order.number)}`,
      customer: { email: viewer.user.email ?? "", reference: viewer.user.id },
      methods: settings.methods,
      description: `Etsawaa packaging ${order.number}`,
    });
    if (!session.ok) return data({ ok: false, reason: "card_unavailable" }, { status: 502 });
    throw redirect(session.sessionUrl);
  }
  if (intent === "cancel") {
    const { data: res, error } = await client.rpc("fn_vendor_cancel_packaging_order", { p_order_id: order.id });
    if (error) return data({ ok: false, reason: "server_error" }, { status: 500 });
    const r = res as { ok: boolean; reason?: string };
    return r.ok ? { ok: true as const } : data({ ok: false, reason: r.reason }, { status: 400 });
  }
  if (intent === "return") {
    const items = order.items.map((i) => ({ order_item_id: i.id, qty: Number(form.get(`qty_${i.id}`) ?? 0) })).filter((x) => x.qty > 0);
    const { data: res, error } = await client.rpc("fn_vendor_request_packaging_return", {
      p_order_id: order.id, p_items: items, p_reason: String(form.get("reason") ?? "").trim(),
    });
    if (error) return data({ ok: false, reason: "server_error" }, { status: 500 });
    const r = res as { ok: boolean; reason?: string };
    return r.ok ? { ok: true as const } : data({ ok: false, reason: r.reason }, { status: 400 });
  }
  return data({ ok: false, reason: "bad_intent" }, { status: 400 });
}

export default function VendorPackagingOrder({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { lang, order } = loaderData;
  const en = lang === "en";
  const fetcher = useFetcher<typeof action>();
  const [returnOpen, setReturnOpen] = useState(false);
  useActionToast(fetcher, { success: t("common.saved") });
  useEffect(() => { if (fetcher.state === "idle" && fetcher.data?.ok) setReturnOpen(false); }, [fetcher.state, fetcher.data]);
  const busy = fetcher.state !== "idle";
  const failedAttempts = order.payments.filter((p) => p.status === "failed").length;
  const unpaid = order.status === "pending_payment";

  const actions = (
    <>
      {unpaid ? (
        <>
          {failedAttempts > 0 ? <p className="text-xs font-bold text-danger">{t("pkg.payFailedRetry", { n: failedAttempts })}</p> : null}
          {loaderData.returning ? <p className="text-xs text-text-muted">{t("pkg.payChecking")}</p> : null}
          {loaderData.cardOnline ? <PayMethodsNote test={loaderData.cardTest} /> : null}
          <fetcher.Form method="post"><input type="hidden" name="intent" value="pay" />
            <Button type="submit" block disabled={!loaderData.cardOnline} loading={busy}>{failedAttempts > 0 ? t("pkg.retryPay") : t("pkg.payNowBtn")}</Button></fetcher.Form>
          {!loaderData.cardOnline ? <p className="text-xs text-warning-strong">{t("pkg.cardOfflineOrder")}</p> : null}
          {order.paid_piastres === 0 ? (
            <fetcher.Form method="post"><input type="hidden" name="intent" value="cancel" />
              <Button type="submit" block variant="ghost" loading={busy}>{t("pkg.cancelOrder")}</Button></fetcher.Form>
          ) : null}
        </>
      ) : null}
      {loaderData.canReturn ? <Button block variant="outline" onClick={() => setReturnOpen(true)}>{t("pkg.requestReturn")}</Button> : null}
      {order.status === "delivered" && !loaderData.canReturn ? <p className="text-xs text-text-muted">{t("pkg.returnWindowOver", { n: loaderData.windowDays })}</p> : null}
      {!unpaid && !loaderData.canReturn && order.status !== "delivered" ? <p className="text-xs text-text-muted">{t(`pkg.next_${order.status}`, { defaultValue: "" })}</p> : null}
    </>
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={`${t("pkg.order")} ${order.number}`}
        actions={<div className="flex flex-wrap items-center gap-2"><PackagingStatusBadges status={order.status} payment={order.payment_status} mode={order.payment_mode} />
          <Link to={`/${lang}/vendor/packaging/orders`} className="text-sm font-bold text-action hover:underline">{t("pkg.myOrders")}</Link></div>} />
      {loaderData.placed ? <p role="status" className="rounded-md border border-success/40 bg-success-soft p-3 text-sm text-text">{t("pkg.placedOk")}</p> : null}
      <PackagingOrderView order={order} lang={lang} actions={actions} documents={<DocLinks number={order.number} lang={lang} returns={order.returns} />} />

      <Dialog open={returnOpen} onClose={() => setReturnOpen(false)} title={t("pkg.requestReturn")}>
        <fetcher.Form method="post" className="flex flex-col gap-3 p-4">
          <input type="hidden" name="intent" value="return" />
          <p className="text-xs text-text-muted">{t("pkg.returnHint", { n: loaderData.windowDays })}</p>
          {order.items.map((i) => (
            <label key={i.id} className="flex items-center justify-between gap-3 text-sm text-text">
              <span>{en ? i.name_en : i.name_ar} <span className="text-xs text-text-muted">({i.qty} {t(`pkg.unit_${i.unit}`)})</span></span>
              <select name={`qty_${i.id}`} defaultValue="0" className="rounded-md border border-border bg-surface p-1.5 text-sm">
                {Array.from({ length: i.qty + 1 }, (_, n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          ))}
          <label className="flex flex-col gap-1 text-xs font-bold text-text-muted">{t("pkg.returnReason")}
            <textarea name="reason" required rows={2} className="rounded-md border border-border bg-surface p-2.5 text-sm text-text" />
          </label>
          <Button type="submit" loading={busy}>{t("pkg.sendReturn")}</Button>
        </fetcher.Form>
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

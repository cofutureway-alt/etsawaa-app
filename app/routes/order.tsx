import { useEffect, useMemo, useState } from "react";
import { Link, data, redirect, useFetcher } from "react-router";
import type { Route } from "./+types/order";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { getViewer } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { publicMeta } from "~/lib/seo";
import { getI18n } from "~/lib/i18n/config";
import { getOwnOrder, getOrderParts, getGeoNames, type OrderRow, type GroupRow, type ItemRow } from "~/features/orders/api";
import { formatPiastres } from "~/lib/money";
import { Button } from "~/components/ui/Button";
import { MediaImg } from "~/components/catalog/MediaImg";
import { SkeletonPage } from "~/components/ui/Skeleton";
import { RotateIcon } from "~/components/ui/icons";
import { walletAvailable } from "~/features/wallet/split";

/** an order whose money is settled: nothing is left to pay */
const SETTLED = new Set(["paid", "cod_collected", "partially_refunded", "refunded"]);


/**
 * Order page (JOURNEYS §9): number, status, summary + tracking link. Doubles
 * as the success page (?placed=1 for COD) and the Kashier return target
 * (?kashier=return) where "Payment received" appears ONLY after the webhook
 * flips payment_status — the browser return query is never trusted (US-07).
 */
export const meta: Route.MetaFunction = ({ params }) => {
  const lang = params.lang === "en" ? "en" : "ar";
  const t = getI18n(lang).t;
  return publicMeta({
    lang,
    path: "/order",
    title: `${t("order.title")} — ${t("app.name")}`,
    description: t("order.metaDescription"),
    noindex: true,
  });
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  // session and order in parallel: RLS returns the order only to its owner,
  // and a guest is redirected before anything is used
  const [viewerRes, ownOrder] = await Promise.all([getViewer(client), getOwnOrder(client, params.number ?? "")]);
  const viewer = viewerRes?.viewer ?? null;
  if (!viewer) {
    const url = new URL(request.url);
    throw redirect(`/${lang}/auth/login?next=${encodeURIComponent(url.pathname)}`);
  }
  let order = ownOrder;
  if (!order) throw new Response("Not found", { status: 404 });
  if (order.payment_method === "kashier" && order.payment_status === "unpaid") {
    // settle from Kashier's own record (server-to-server), then re-read
    const { getSupabaseAdminClient } = await import("~/lib/supabase/admin");
    const { reconcileKashierOrder } = await import("~/features/checkout/kashier.server");
    const admin = getSupabaseAdminClient();
    const res = admin ? await reconcileKashierOrder(admin, "order", order.number) : null;
    if (res?.ok) order = (await getOwnOrder(client, order.number)) ?? order;
  }

  const [parts, geo, exchange] = await Promise.all([
    getOrderParts(client, order.id),
    getGeoNames(client, order.governorate_id, order.area_id),
    loadExchangeInfo(client, order.exchange_request_id ?? null),
  ]);
  // a replacement order still to pay: can the wallet cover the difference?
  let walletBalance = 0;
  if (exchange && order.status !== "cancelled" && (order.payment_status === "unpaid" || order.payment_status === "cod_pending")) {
    const { data: w } = await client.rpc("fn_my_wallet");
    walletBalance = walletAvailable(w as { refund_piastres: number; gift_piastres: number } | null);
  }

  return {
    lang,
    order: JSON.parse(JSON.stringify(order)) as OrderRow,
    groups: JSON.parse(JSON.stringify(parts.groups)) as GroupRow[],
    items: JSON.parse(JSON.stringify(parts.items)) as ItemRow[],
    history: parts.history,
    governorate: geo.governorate,
    area: geo.area,
    exchange,
    walletBalance,
    flags: {
      placed: new URL(request.url).searchParams.get("placed") === "1",
      kashierReturn: new URL(request.url).searchParams.get("kashier") === "return",
      kashierRetry: new URL(request.url).searchParams.get("kashier") === "retry",
    },
  };
}

/**
 * The exchange behind a replacement order: the original order, the credit
 * the return gave, and how the difference may be paid (returns settings,
 * read with the service key: the setting is not public).
 */
async function loadExchangeInfo(client: NonNullable<ReturnType<typeof createSupabaseServerClient>["client"]>, requestId: string | null) {
  if (!requestId) return null;
  const { data: req } = await client
    .from("refund_requests")
    .select("id, resolution, refund_total_piastres, exchange_applied_piastres, order:orders!refund_requests_order_id_fkey(number)")
    .eq("id", requestId)
    .maybeSingle();
  if (!req) return null;
  const { getSupabaseAdminClient } = await import("~/lib/supabase/admin");
  const admin = getSupabaseAdminClient();
  const { data: setting } = admin
    ? await admin.from("settings").select("value").eq("key", "returns").maybeSingle()
    : { data: null };
  const methods = ((setting?.value as { exchange_pay_methods?: string[] } | null)?.exchange_pay_methods) ?? ["kashier", "cod"];
  const r = req as unknown as { resolution: string; refund_total_piastres: number; exchange_applied_piastres: number; order: { number: string } | null };
  return {
    resolution: r.resolution,
    credit: r.refund_total_piastres ?? 0,
    applied: r.exchange_applied_piastres ?? 0,
    originalNumber: r.order?.number ?? "",
    payByCard: methods.includes("kashier"),
    payOnDelivery: methods.includes("cod"),
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  const { viewer } = (await getViewer(client)) ?? { viewer: null };
  if (!viewer) return data({ ok: false, reason: "auth_required" }, { status: 401 });
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  const order = await getOwnOrder(client, params.number ?? "");
  if (!order) return data({ ok: false, reason: "not_found" }, { status: 404 });

  if (intent === "cancel") {
    const reason = String(form.get("reason") ?? "").trim();
    const { data: res, error } = await client.rpc("fn_cancel_order", { p_order_id: order.id, p_reason: reason });
    if (error) return data({ ok: false, reason: "server_error" }, { status: 500 });
    const r = res as { ok: boolean; reason?: string };
    if (!r.ok) return data({ ok: false, reason: r.reason ?? "server_error" }, { status: 400 });
    return { ok: true as const };
  }

  if (intent === "exchange_cod") {
    // the difference of an exchange is paid to the courier (settings allowing)
    const { data: res, error } = await client.rpc("fn_exchange_choose_cod", { p_order_id: order.id });
    if (error) return data({ ok: false, reason: "server_error" }, { status: 500 });
    const r = res as { ok: boolean; reason?: string };
    if (!r.ok) return data({ ok: false, reason: r.reason ?? "server_error" }, { status: 400 });
    return { ok: true as const };
  }

  if (intent === "exchange_wallet") {
    // the whole difference of an exchange from the customer's wallet
    const { data: res, error } = await client.rpc("fn_exchange_pay_wallet", { p_order_id: order.id });
    if (error) return data({ ok: false, reason: "server_error" }, { status: 500 });
    const r = res as { ok: boolean; reason?: string };
    if (!r.ok) return data({ ok: false, reason: r.reason ?? "server_error" }, { status: 400 });
    return { ok: true as const };
  }

  if (intent === "pay") {
    // retry on the SAME order (US-07) — no new order is created
    if (order.payment_method !== "kashier" || order.payment_status === "paid") {
      return data({ ok: false, reason: "not_retryable" }, { status: 400 });
    }
    const { loadKashierSettings, resolveKashierMode, startKashierPayment } = await import("~/features/checkout/kashier.server");
    const { getSupabaseAdminClient } = await import("~/lib/supabase/admin");
    const { getSiteUrl } = await import("~/lib/env.server");
    const settings = await loadKashierSettings(client);
    const mode = resolveKashierMode(settings, viewer.profile.role);
    const admin = getSupabaseAdminClient();
    if (!mode || !admin) return data({ ok: false, reason: "payment_unavailable" }, { status: 400 });
    const session = await startKashierPayment(admin, "order", {
      mode,
      orderNumber: order.number,
      // the card covers only what the wallet did not pay
      totalPiastres: Math.max(0, order.total_piastres - (order.wallet_paid_piastres ?? 0)),
      lang: lang === "en" ? "en" : "ar",
      siteUrl: getSiteUrl(request.url),
      customer: { email: viewer.user.email ?? "", reference: viewer.user.id },
      methods: settings.methods,
    });
    if (!session.ok) return data({ ok: false, reason: "payment_session_failed" }, { status: 502 });
    throw redirect(session.sessionUrl);
  }

  return data({ ok: false, reason: "bad_intent" }, { status: 400 });
}

export default function OrderPage({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const lang = loaderData.lang;
  const cancelFetcher = useFetcher<typeof action>();
  const payFetcher = useFetcher<typeof action>();
  const exchangeFetcher = useFetcher<typeof action>();
  const walletFetcher = useFetcher<typeof action>();
  const { order, groups, items, history } = loaderData;
  const [liveStatus, setLiveStatus] = useState({ status: order.status, payment_status: order.payment_status });

  const en = i18n.language?.startsWith("en");
  const money = (p: number) => formatPiastres(p, en ? "en" : "ar");
  // what is still to pay: nothing once the order is paid or collected
  const outstanding = SETTLED.has(liveStatus.payment_status) || SETTLED.has(order.payment_status)
    || liveStatus.status === "cancelled" || order.status === "cancelled"
    ? 0 : Math.max(0, order.total_piastres - (order.wallet_paid_piastres ?? 0));

  // Kashier return: poll until the webhook lands (never trust the query)
  const awaitingWebhook =
    order.payment_method === "kashier" &&
    liveStatus.payment_status === "unpaid" &&
    liveStatus.status === "pending_payment";
  useEffect(() => {
    if (!awaitingWebhook) return;
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/order-status?number=${encodeURIComponent(order.number)}`);
        if (!res.ok) return;
        const j = (await res.json()) as { status?: string; payment_status?: string };
        if (alive && j.status && j.payment_status) {
          setLiveStatus({
            status: j.status as typeof order.status,
            payment_status: j.payment_status as typeof order.payment_status,
          });
        }
      } catch { /* transient — next tick retries */ }
    };
    const iv = setInterval(tick, 3000);
    const stop = setTimeout(() => clearInterval(iv), 60000);
    return () => { alive = false; clearInterval(iv); clearTimeout(stop); };
  }, [awaitingWebhook, order.number]);

  const itemsByGroup = useMemo(() => {
    const m = new Map<string, ItemRow[]>();
    for (const it of items) {
      const arr = m.get(it.group_id) ?? [];
      arr.push(it);
      m.set(it.group_id, arr);
    }
    return m;
  }, [items]);

  const cancellable =
    (liveStatus.status === "pending_payment" || liveStatus.status === "processing" || liveStatus.status === "on_hold") &&
    groups.every((g) => g.status === "pending" || g.status === "preparing");

  const statusLabel = (s: string): string => {
    const key = `order.status_${s}`;
    const translated = t(key);
    return translated === key ? s : translated; // unknown states never crash the page
  };

  const banner = (() => {
    if (loaderData.flags.placed && order.payment_method === "cod") return t("order.placedCod");
    if (liveStatus.payment_status === "paid") return t("order.paid");
    if (liveStatus.payment_status === "cod_pending") return t("order.codPending");
    if (awaitingWebhook && loaderData.flags.kashierReturn) return t("order.awaitingConfirmation");
    if (awaitingWebhook) return t("order.pendingPayment");
    if (liveStatus.payment_status === "cod_collected") return t("order.codCollected");
    if (liveStatus.status === "cancelled") return t("order.cancelled");
    return null;
  })();

  return (
    <div className="mx-auto w-full max-w-page px-4 py-6">
      <h1 className="text-lg font-extrabold text-text">
        {t("order.title")} <span dir="ltr">{order.number}</span>
      </h1>
      <p className="mt-1 text-sm text-text-muted">
        {t("order.createdAt")} {new Date(order.created_at).toLocaleDateString(en ? "en-EG" : "ar-EG-u-nu-latn", { dateStyle: "long" })}
      </p>

      {banner ? (
        <div
          role="status"
          className={`mt-4 rounded-md border p-4 text-sm font-bold ${
            liveStatus.status === "cancelled" || (awaitingWebhook && loaderData.flags.kashierRetry)
              ? "border-danger bg-surface text-text"
              : "border-primary bg-surface-tint text-text"
          }`}
        >
          {banner}
        </div>
      ) : null}

      {/* a replacement order: what the return covered and what is left to pay */}
      {loaderData.exchange ? (
        <section className="mt-4 rounded-md border border-action/40 bg-surface-tint p-4 text-sm" aria-label={t("exchange.orderTitle")}>
          <p className="flex items-center gap-2 font-extrabold text-text">
            <RotateIcon aria-hidden="true" className="size-4 text-action" />
            {t("exchange.orderTitle")}
          </p>
          <p className="mt-1 text-text-muted">
            {t("exchange.orderFrom")}{" "}
            <Link to={`/${lang}/account/orders/${encodeURIComponent(loaderData.exchange.originalNumber)}`} className="font-bold text-action hover:underline" dir="ltr">
              {loaderData.exchange.originalNumber}
            </Link>
          </p>
          <dl className="mt-2 flex flex-col gap-1">
            <div className="flex justify-between gap-2">
              <dt className="text-text-muted">{t("exchange.creditApplied")}</dt>
              <dd className="num font-bold text-success" dir="ltr">−{money(loaderData.exchange.applied)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="font-extrabold text-text">{t("exchange.leftToPay")}</dt>
              <dd className="num font-black text-text" dir="ltr">{money(outstanding)}</dd>
            </div>
          </dl>
          {(order.payment_status === "unpaid" || order.payment_status === "cod_pending") && outstanding > 0 ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {loaderData.walletBalance >= outstanding ? (
                <Button loading={walletFetcher.state !== "idle"}
                  onClick={() => walletFetcher.submit({ intent: "exchange_wallet" }, { method: "post", preventScrollReset: true })}>
                  {t("exchange.payFromWallet", { amount: money(outstanding) })}
                </Button>
              ) : null}
              {loaderData.exchange.payOnDelivery && order.payment_method === "kashier" && liveStatus.payment_status === "unpaid" ? (
                <Button variant="outline" loading={exchangeFetcher.state !== "idle"}
                  onClick={() => exchangeFetcher.submit({ intent: "exchange_cod" }, { method: "post", preventScrollReset: true })}>
                  {t("exchange.payOnDelivery")}
                </Button>
              ) : null}
              {exchangeFetcher.data && !exchangeFetcher.data.ok ? (
                <p role="alert" className="text-xs font-bold text-danger">{t(`exchange.codErr_${exchangeFetcher.data.reason}`, { defaultValue: t("returns.failed") })}</p>
              ) : null}
              {walletFetcher.data && !walletFetcher.data.ok ? (
                <p role="alert" className="text-xs font-bold text-danger">{t(`exchange.walletErr_${walletFetcher.data.reason}`, { defaultValue: t("returns.failed") })}</p>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {/* retry / resume for kashier orders still unpaid */}
      {order.payment_method === "kashier" && liveStatus.payment_status === "unpaid" && liveStatus.status !== "cancelled"
        && (!loaderData.exchange || loaderData.exchange.payByCard) ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button
            loading={payFetcher.state !== "idle"}
            onClick={() => payFetcher.submit({ intent: "pay" }, { method: "post", preventScrollReset: true })}
          >
            {loaderData.exchange ? t("exchange.payByCard") : t("order.retryPayment")}
          </Button>
          <p className="text-sm text-text-muted">{t("order.retryNote")}</p>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          to={`/${lang}/order/${encodeURIComponent(order.number)}/track`}
          className="rounded-md border border-action px-4 py-2 text-sm font-bold text-action transition-colors duration-150 hover:bg-surface-tint"
        >
          {t("order.track")}
        </Link>
        {cancellable ? (
          <cancelFetcher.Form method="post" preventScrollReset className="flex items-center gap-2">
            <input type="hidden" name="intent" value="cancel" />
            <input
              name="reason" required maxLength={500}
              placeholder={t("order.cancelReasonPlaceholder")}
              className="w-56 rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-primary focus:shadow-focus"
            />
            <Button variant="outline" type="submit" loading={cancelFetcher.state !== "idle"}>
              {t("order.cancel")}
            </Button>
          </cancelFetcher.Form>
        ) : null}
      </div>
      {cancelFetcher.data && !cancelFetcher.data.ok ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {cancelFetcher.data.reason === "already_shipping" ? t("order.cancelBlockedShipping")
            : cancelFetcher.data.reason === "reason_required" ? t("order.cancelReasonPlaceholder")
            : t("order.cancelFailed")}
        </p>
      ) : null}

      {/* groups */}
      <div className="mt-6 flex flex-col gap-4">
        {groups.map((g) => (
          <section key={g.id} className="rounded-md border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-extrabold text-text">
                {en ? g.vendor.store_name_en : g.vendor.store_name_ar}
              </h2>
              <span className={`rounded-md px-2 py-1 text-xs font-bold ${
                g.status === "cancelled" ? "bg-surface-tint text-danger" : "bg-surface-tint text-text"
              }`}>
                {statusLabel(g.status)}
              </span>
            </div>
            <ul className="mt-3 flex flex-col divide-y divide-border">
              {(itemsByGroup.get(g.id) ?? []).map((it) => (
                <li key={it.id} className="flex items-center gap-3 py-2.5">
                  <MediaImg
                    path={it.image_path ?? ""}
                    alt={en ? it.product_name_en : it.product_name_ar}
                    className="size-12 shrink-0 rounded-md border border-border object-cover"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-text">
                      {en ? it.product_name_en : it.product_name_ar}
                    </span>
                    <span className="text-xs text-text-muted">
                      {(en ? it.option_label_en : it.option_label_ar) ? `${en ? it.option_label_en : it.option_label_ar} · ` : ""}{t("cart.qty")} {it.qty}
                    </span>
                  </span>
                  <span className="text-sm font-extrabold text-text">{money(it.line_total_piastres)}</span>
                </li>
              ))}
            </ul>
            <dl className="mt-2 flex flex-col gap-1 border-t border-border pt-2 text-sm">
              <div className="flex justify-between"><dt className="text-text-muted">{t("order.itemsSubtotal")}</dt><dd className="font-bold text-text">{money(g.items_subtotal_piastres)}</dd></div>
              {g.discount_piastres > 0 ? (
                <div className="flex justify-between"><dt className="text-text-muted">{t("cart.discount")}</dt><dd className="font-bold text-primary">−{money(g.discount_piastres)}</dd></div>
              ) : null}
            </dl>
            {g.status === "cancelled" && g.cancel_reason ? (
              <p className="mt-2 text-sm text-text-muted">{t("order.cancelReason")}: {g.cancel_reason}</p>
            ) : null}
          </section>
        ))}
      </div>

      {/* totals */}
      <section className="mt-4 rounded-md border border-border bg-surface p-4">
        <h2 className="text-sm font-extrabold text-text">{t("order.summary")}</h2>
        <dl className="mt-2 flex flex-col gap-1.5 text-sm">
          <div className="flex justify-between"><dt className="text-text-muted">{t("cart.subtotal")}</dt><dd className="font-bold text-text">{money(order.subtotal_piastres)}</dd></div>
          {order.discount_piastres > 0 ? (
            <div className="flex justify-between"><dt className="text-text-muted">{t("cart.discount")} {order.coupon_code ? `(${order.coupon_code})` : ""}</dt><dd className="font-bold text-primary">−{money(order.discount_piastres)}</dd></div>
          ) : null}
          <div className="flex justify-between"><dt className="text-text-muted">{t("cart.shipping")}</dt><dd className="font-bold text-text">{money(order.shipping_fee_piastres)}</dd></div>
          <div className="mt-1 flex justify-between border-t border-border pt-2">
            <dt className="font-extrabold text-text">{t("cart.total")}</dt>
            <dd className="text-base font-extrabold text-text">{money(order.total_piastres)}</dd>
          </div>
          {(order.wallet_paid_piastres ?? 0) > 0 ? (
            <>
              <div className="flex justify-between">
                <dt className="text-text-muted">{t("checkout.pay_wallet")}</dt>
                <dd className="font-bold text-success">−{money(order.wallet_paid_piastres ?? 0)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-text-muted">{t("order.dueNow")}</dt>
                <dd className="font-bold text-text">{money(outstanding)}</dd>
              </div>
            </>
          ) : null}
          <div className="flex justify-between">
            <dt className="text-text-muted">{t("order.paymentMethod")}</dt>
            <dd className="font-bold text-text">
              {order.payment_method === "cod"
                ? t("checkout.pay_cod")
                : order.payment_method === "wallet"
                  ? t("checkout.pay_wallet")
                  : t("checkout.pay_kashier")}
            </dd>
          </div>
        </dl>
      </section>

      {/* delivery snapshot */}
      <section className="mt-4 rounded-md border border-border bg-surface p-4">
        <h2 className="text-sm font-extrabold text-text">{t("order.deliveryDetails")}</h2>
        <p className="mt-1.5 text-sm text-text">
          {order.ship_name} — <span dir="ltr">{order.phone_primary}</span> · <span dir="ltr">{order.phone_alternate}</span>
        </p>
        <p className="text-sm text-text-muted">
          {order.address1}{order.address2 ? `، ${order.address2}` : ""} — {en ? loaderData.governorate?.name_en : loaderData.governorate?.name_ar} · {en ? loaderData.area?.name_en : loaderData.area?.name_ar}
        </p>
        <p className="mt-1 text-xs text-text-faint">{t("order.emailSnapshot")}: <span dir="ltr">{order.email}</span></p>
      </section>

      <details className="mt-4 rounded-md border border-border bg-surface p-4">
        <summary className="cursor-pointer text-sm font-extrabold text-text">{t("order.historyTitle")}</summary>
        <ol className="mt-3 flex flex-col gap-2">
          {history.length === 0 ? (
            <li className="text-sm text-text-muted">{t("order.preparing")}</li>
          ) : (
            history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-bold text-text">{statusLabel(h.status)}</span>
                <span className="text-text-faint" dir="ltr">{new Date(h.created_at).toLocaleString(en ? "en-EG" : "ar-EG-u-nu-latn")}</span>
                {h.note && h.note !== "order_created" ? <span className="text-text-muted">— {h.note}</span> : null}
              </li>
            ))
          )}
        </ol>
      </details>
      <p className="mt-3 text-xs text-text-faint">{t("order.emailNotice")}</p>
    </div>
  );
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonPage />;
}

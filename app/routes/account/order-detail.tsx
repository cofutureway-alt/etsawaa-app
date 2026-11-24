import { Link, data, useFetcher } from "react-router";
import { useState } from "react";
import type { Route } from "./+types/order-detail";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { formatPiastres } from "~/lib/money";
import { parseReviewMedia, type ReviewMediaItem } from "~/lib/review-media";
import { Rating } from "~/components/ui/Rating";
import { ReviewMediaPicker } from "~/components/catalog/ReviewMediaPicker";
import {
  getOwnOrder, getOrderParts, getGeoNames, requestedQtyByItem,
} from "~/features/orders/api";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { afterSaleKind, canCompletePayment } from "~/features/orders/customer-actions";
import { SkeletonPage } from "~/components/ui/Skeleton";


/** Account order detail: summary + per-item return/review actions (US-11/§10). */
export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  // round 1: guard + order together (RLS only ever returns the caller's own order)
  const [viewer, order] = await Promise.all([
    requirePanelAccess(client, lang, "account", request),
    getOwnOrder(client, params.number ?? ""),
  ]);
  if (!order) throw new Response("Not found", { status: 404 });
  // round 2: lines/groups/history + place names
  const [parts, geo] = await Promise.all([
    getOrderParts(client, order.id),
    getGeoNames(client, order.governorate_id, order.area_id),
  ]);
  // round 3: per-line refund quantities and reviews, together — reviews are
  // limited to THIS order's lines (it used to load every review the customer
  // ever wrote, after a second auth.getUser() call)
  const itemIds = parts.items.map((i) => i.id);
  const [requested, { data: reviewed }] = await Promise.all([
    requestedQtyByItem(client, itemIds),
    itemIds.length
      ? client.from("reviews").select("order_item_id").eq("customer_id", viewer.user.id).in("order_item_id", itemIds)
      : Promise.resolve({ data: [] }),
  ]);
  const reviewedSet = new Set(((reviewed ?? []) as Array<{ order_item_id: string | null }>).map((r) => r.order_item_id));

  return {
    lang,
    order: JSON.parse(JSON.stringify(order)),
    groups: JSON.parse(JSON.stringify(parts.groups)),
    items: JSON.parse(JSON.stringify(parts.items)),
    geo: JSON.parse(JSON.stringify(geo)),
    requested: Object.fromEntries(requested),
    reviewed: [...reviewedSet].filter((x): x is string => x !== null),
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "account", request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "review") {
    const orderItemId = String(form.get("order_item_id") ?? "");
    const rating = Number(form.get("rating") ?? 0);
    const { data: res, error } = await client.rpc("fn_submit_review", {
      p_order_item_id: orderItemId,
      p_rating: rating,
      p_title: String(form.get("title") ?? ""),
      p_body: String(form.get("body") ?? ""),
      p_media: parseReviewMedia(form.get("media")),
    });
    if (error) return data({ ok: false, reason: "server_error" }, { status: 500 });
    const r = res as { ok: boolean; reason?: string };
    return r.ok ? { ok: true as const } : data({ ok: false, reason: r.reason }, { status: 400 });
  }

  if (intent === "cancel") {
    const order = await getOwnOrder(client, params.number ?? "");
    if (!order) return data({ ok: false, reason: "not_found" }, { status: 404 });
    const { data: res, error } = await client.rpc("fn_cancel_order", {
      p_order_id: order.id, p_reason: String(form.get("reason") ?? ""),
    });
    if (error) return data({ ok: false, reason: "server_error" }, { status: 500 });
    const r = res as { ok: boolean; reason?: string };
    return r.ok ? { ok: true as const } : data({ ok: false, reason: r.reason }, { status: 400 });
  }

  return data({ ok: false, reason: "bad_intent" }, { status: 400 });
}

export default function AccountOrderDetail({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const money = (p: number) => formatPiastres(p, en ? "en" : "ar");
  const { order, groups, items, requested, reviewed } = loaderData;
  const cancelFetcher = useFetcher<typeof action>();

  const delivered = order.delivered_at !== null;
  const withinReturn = delivered && new Date(order.delivered_at).getTime() + 14 * 86400000 > Date.now();
  const withinWarranty = delivered && new Date(order.delivered_at).getTime() + 30 * 86400000 > Date.now();
  const cancellable =
    (order.status === "pending_payment" || order.status === "processing" || order.status === "on_hold") &&
    groups.every((g: { status: string }) => g.status === "pending" || g.status === "preparing");

  return (
    <div>
      <p className="text-sm">
        <Link to={`/${loaderData.lang}/account/orders`} className="font-bold text-action hover:underline">{t("account.ordersTab")}</Link>
      </p>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-extrabold text-text"><span dir="ltr">{order.number}</span></h1>
        <span className={`rounded-md px-2 py-1 text-xs font-bold ${order.status === "cancelled" ? "bg-surface-tint text-danger" : "bg-surface-tint text-text"}`}>
          {t(`order.status_${order.status}`)}
        </span>
      </div>

      {/* what the customer can still do with this order */}
      {canCompletePayment(order) || afterSaleKind(order) ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {canCompletePayment(order) ? (
            <Link to={`/${loaderData.lang}/order/${encodeURIComponent(order.number)}`}
              className="rounded-md bg-action px-4 py-2 text-sm font-extrabold text-on-action hover:opacity-90">
              {t("orders.completePayment")}
            </Link>
          ) : null}
          {afterSaleKind(order) ? (
            <Link to={`/${loaderData.lang}/account/orders/${encodeURIComponent(order.number)}/return${afterSaleKind(order) === "warranty" ? "?kind=warranty" : ""}`}
              className="rounded-md border border-action px-4 py-2 text-sm font-bold text-action hover:bg-surface-tint">
              {t(afterSaleKind(order) === "warranty" ? "returns.warrantyButton" : "returns.requestButton")}
            </Link>
          ) : null}
        </div>
      ) : null}

      {delivered && !withinReturn && !withinWarranty ? (
        <p className="mt-3 rounded-md border border-border bg-surface-tint p-3 text-sm text-text-muted">
          {t("returns.windowsClosed")}
        </p>
      ) : null}

      <div className="mt-4 flex flex-col gap-4">
        {groups.map((g: { id: string; status: string; items_subtotal_piastres: number; discount_piastres: number; cancel_reason: string | null; vendor: { store_name_ar: string; store_name_en: string } }) => {
          const own = items.filter((it: { group_id: string }) => it.group_id === g.id);
          return (
            <section key={g.id} className="rounded-md border border-border bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-extrabold text-text">{en ? g.vendor.store_name_en : g.vendor.store_name_ar}</h2>
                <span className="rounded-md bg-surface-tint px-2 py-1 text-xs font-bold text-text">{t(`order.status_${g.status}`)}</span>
              </div>
              <ul className="mt-2 flex flex-col divide-y divide-border">
                {own.map((it: {
                  id: string; product_name_ar: string; product_name_en: string; option_key: string; option_label_ar?: string | null; option_label_en?: string | null;
                  qty: number; line_total_piastres: number; image_path: string | null;
                }) => {
                  const remaining = it.qty - (requested[it.id] ?? 0);
                  const isReviewed = reviewed.includes(it.id);
                  return (
                    <li key={it.id} className="py-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-bold text-text">
                          {en ? it.product_name_en : it.product_name_ar}{(en ? it.option_label_en : it.option_label_ar) ? ` (${en ? it.option_label_en : it.option_label_ar})` : ""} × {it.qty}
                        </span>
                        <span className="text-sm font-extrabold text-text">{money(it.line_total_piastres)}</span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs">
                        {delivered && withinReturn && remaining > 0 ? (
                          <Link to={`/${loaderData.lang}/account/orders/${encodeURIComponent(order.number)}/return?items=${it.id}`} className="font-bold text-action hover:underline">
                            {t("returns.requestButton")}
                          </Link>
                        ) : null}
                        {delivered && withinWarranty && remaining > 0 ? (
                          <Link to={`/${loaderData.lang}/account/orders/${encodeURIComponent(order.number)}/return?kind=warranty&items=${it.id}`} className="font-bold text-action hover:underline">
                            {t("returns.warrantyButton")}
                          </Link>
                        ) : null}
                        {delivered && !isReviewed ? (
                          <button
                            type="button"
                            className="font-bold text-action hover:underline"
                            onClick={() => {
                              const el = document.getElementById(`review-${it.id}`) as HTMLDetailsElement | null;
                              if (el) el.open = true;
                              el?.scrollIntoView({ block: "center" });
                            }}
                          >
                            {t("reviews.write")}
                          </button>
                        ) : null}
                        {isReviewed ? <span className="text-text-faint">{t("reviews.submitted")}</span> : null}
                        {delivered && remaining === 0 ? <span className="text-text-faint">{t("returns.fullyRequested")}</span> : null}
                      </div>
                      {delivered && !isReviewed ? (
                        <details id={`review-${it.id}`} className="mt-2 rounded-md border border-border p-3">
                          <summary className="cursor-pointer text-sm font-bold text-text">{t("reviews.write")}</summary>
                          <ReviewForm itemId={it.id} />
                        </details>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      <section className="mt-4 rounded-md border border-border bg-surface p-4">
        <dl className="flex flex-col gap-1.5 text-sm">
          <div className="flex justify-between"><dt className="text-text-muted">{t("cart.subtotal")}</dt><dd className="font-bold">{money(order.subtotal_piastres)}</dd></div>
          <div className="flex justify-between"><dt className="text-text-muted">{t("cart.discount")}</dt><dd className="font-bold">−{money(order.discount_piastres)}</dd></div>
          <div className="flex justify-between"><dt className="text-text-muted">{t("cart.shipping")}</dt><dd className="font-bold">{money(order.shipping_fee_piastres)}</dd></div>
          <div className="flex justify-between border-t border-border pt-1.5"><dt className="font-extrabold">{t("cart.total")}</dt><dd className="text-base font-extrabold">{money(order.total_piastres)}</dd></div>
        </dl>
        <p className="mt-2 text-sm text-text-muted">
          {order.ship_name} — <span dir="ltr">{order.phone_primary}</span>
        </p>
        <p className="text-sm text-text-muted">
          {order.address1}{order.address2 ? `، ${order.address2}` : ""} — {en ? loaderData.geo.governorate?.name_en : loaderData.geo.governorate?.name_ar} · {en ? loaderData.geo.area?.name_en : loaderData.geo.area?.name_ar}
        </p>
      </section>

      {cancellable ? (
        <cancelFetcher.Form method="post" preventScrollReset className="mt-4 flex flex-wrap items-center gap-2">
          <input type="hidden" name="intent" value="cancel" />
          <input
            name="reason" required maxLength={500} placeholder={t("order.cancelReasonPlaceholder")}
            className="w-56 rounded-md border border-border bg-surface px-3 py-2 text-sm text-text"
          />
          <button type="submit" className="cursor-pointer rounded-md border border-danger px-3 py-2 text-sm font-bold text-danger hover:bg-surface-tint">
            {t("order.cancel")}
          </button>
        </cancelFetcher.Form>
      ) : null}
    </div>
  );
}


/** One line's review form: real stars + optional photos/videos. */
function ReviewForm({ itemId }: { itemId: string }) {
  const { t } = useTranslation();
  const fetcher = useFetcher<{ ok: boolean; reason?: string }>();
  const [rating, setRating] = useState(5);
  const [media, setMedia] = useState<ReviewMediaItem[]>([]);
  const failed = fetcher.data && !fetcher.data.ok;
  return (
    <fetcher.Form method="post" preventScrollReset className="mt-2 flex flex-col gap-2">
      <input type="hidden" name="intent" value="review" />
      <input type="hidden" name="order_item_id" value={itemId} />
      <input type="hidden" name="rating" value={rating} />
      <div className="flex flex-col gap-1">
        <span className="text-xs font-bold text-text">{t("reviews.rating")}</span>
        <Rating value={rating} onChange={setRating} size="lg" />
      </div>
      <input name="title" maxLength={200} placeholder={t("reviews.titlePlaceholder")} className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text" />
      <textarea name="body" maxLength={2000} rows={3} placeholder={t("reviews.bodyPlaceholder")} className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text" />
      <ReviewMediaPicker value={media} onChange={setMedia} />
      <button type="submit" disabled={fetcher.state !== "idle"} className="w-fit cursor-pointer rounded-md bg-action px-4 py-2 text-sm font-bold text-on-action hover:bg-action-hover disabled:opacity-50">
        {t("reviews.submit")}
      </button>
      {failed ? (
        <p role="alert" className="text-xs text-danger">
          {fetcher.data?.reason === "bad_media" ? t("reviews.badMedia")
            : fetcher.data?.reason === "already_reviewed" ? t("reviews.duplicate")
            : t("reviews.failed")}
        </p>
      ) : null}
    </fetcher.Form>
  );
}

/** H-06: friendly route error page (500s log a CORERR id; 403/404 keep their message) */
export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonPage />;
}

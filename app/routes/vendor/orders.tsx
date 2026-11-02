import { data, useFetcher, useSearchParams } from "react-router";
import type { Route } from "./+types/orders";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { formatPiastres } from "~/lib/money";
import { Button } from "~/components/ui/Button";
import { Badge } from "~/components/ui/Badge";
import { EmptyState } from "~/components/ui/EmptyState";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonPage } from "~/components/ui/Skeleton";
import { SearchIcon } from "~/components/ui/icons";


/**
 * Vendor orders (VO-01..VO-06, VO-19, VO-20) — ONLY the vendor's own groups
 * (definer list), filters + search, fulfillment transitions via
 * fn_vendor_set_fulfillment (through fn_update_group_status's vendor ladder),
 * vendor-shipping request via fn_request_vendor_shipping, own print links,
 * per-order print history (order_documents). No admin-only fields leak: the
 * snapshot RPC returns SAFE columns only.
 */
const GROUP_STATUSES = ["pending", "preparing", "on_hold", "handed_to_carrier", "out_for_delivery", "delivered", "cancelled"] as const;

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "vendor", request);

  const { data: vendorId } = await client.rpc("own_vendor_id");
  if (!vendorId) throw new Response("Forbidden", { status: 403 });

  const { data: groups, error } = await client.rpc("fn_vendor_orders_list");
  if (error) throw new Error(error.message);
  let list = (groups ?? []) as VendorGroup[];

  // VO-01 filters + search (client of the definer list — same isolation)
  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? "";
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  if (status) list = list.filter((g) => g.status === status);
  if (q) list = list.filter((g) => g.order.number.toLowerCase().includes(q) || (g.order.ship_name ?? "").toLowerCase().includes(q));

  const groupIds = list.map((g) => g.id);
  const { data: items } = groupIds.length > 0
    ? await client.from("order_items").select("id, group_id, product_name_ar, product_name_en, option_key, qty, line_total_piastres, coupon_discount_piastres").in("group_id", groupIds)
    : { data: [] };
  const { data: docs } = groupIds.length > 0
    ? await client.from("order_documents").select("id, order_id, doc_type, copies, created_at").in("order_id", [...new Set(list.map((g) => g.order.id))]).order("created_at", { ascending: false })
    : { data: [] };

  return {
    lang,
    groups: JSON.parse(JSON.stringify(list)),
    items: items ?? [],
    docs: docs ?? [],
    filters: { status, q },
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "vendor", request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "status") {
    const groupId = String(form.get("group_id") ?? "");
    const status = String(form.get("status") ?? "");
    const note = String(form.get("note") ?? "");
    const { data: res, error } = await client.rpc("fn_vendor_set_fulfillment", {
      p_group_id: groupId, p_status: status, p_note: note || null,
    });
    if (error) return data({ ok: false, reason: "server_error" }, { status: 500 });
    const r = res as { ok: boolean; reason?: string };
    return r.ok ? { ok: true as const } : data({ ok: false, reason: r.reason }, { status: 400 });
  }

  if (intent === "request_shipping") {
    const groupId = String(form.get("group_id") ?? "");
    const { data: res, error } = await client.rpc("fn_request_vendor_shipping", { p_group_id: groupId });
    if (error) return data({ ok: false, reason: "server_error" }, { status: 500 });
    const r = res as { ok: boolean; reason?: string };
    return r.ok ? { ok: true as const } : data({ ok: false, reason: r.reason }, { status: 400 });
  }

  return data({ ok: false, reason: "bad_intent" }, { status: 400 });
}

interface VendorGroup {
  id: string;
  status: string;
  shipping_mode: "platform" | "vendor";
  vendor_ship_status: "not_required" | "pending_admin" | "approved" | "rejected";
  items_subtotal_piastres: number;
  discount_piastres: number;
  cancel_reason: string | null;
  order: {
    id: string; number: string; status: string; payment_method: string;
    payment_status: string; ship_name: string; total_piastres: number; created_at: string;
  };
}

const NEXT_STEP: Record<string, { to: string; key: string }> = {
  pending: { to: "preparing", key: "order.status_preparing" },
  preparing: { to: "handed_to_carrier", key: "order.status_handed_to_carrier" },
  handed_to_carrier: { to: "out_for_delivery", key: "order.status_out_for_delivery" },
  out_for_delivery: { to: "delivered", key: "order.status_delivered" },
};

export default function VendorOrdersPage({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const money = (p: number) => formatPiastres(p, en ? "en" : "ar");
  const fetcher = useFetcher<typeof action>();
  const [searchParams, setSearchParams] = useSearchParams();
  const busy = fetcher.state !== "idle";

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value); else next.delete(key);
    setSearchParams(next, { preventScrollReset: true });
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-black text-text">{t("vendorOrders.title")}</h1>
            <span className="rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-black text-action">
              {loaderData.groups.length} {en ? "Orders" : "طلب"}
            </span>
          </div>
          <p className="mt-1 text-xs text-text-muted">
            {en
              ? "Track your orders, prepare packages, request carrier handoffs, and print labels."
              : "متابعة طلبات متجرك، تجهيز الشحنات، وتسليم الطرود لشركات الشحن."}
          </p>
        </div>
      </div>

      {/* VO-01 filters */}
      <div className="flex flex-wrap items-center gap-2.5 rounded-lg border border-border bg-surface p-3 shadow-1">
        <div className="relative min-w-48 flex-1">
          <input
            type="search"
            placeholder={t("vendorOrders.search")}
            value={loaderData.filters.q}
            onChange={(e) => setFilter("q", e.target.value)}
            className="w-full rounded-md border border-border bg-surface-alt px-3 py-2 text-[13px] text-text transition-all focus:border-primary focus:bg-surface focus:outline-none"
            aria-label={t("vendorOrders.search")}
          />
        </div>
        <select
          value={loaderData.filters.status}
          onChange={(e) => setFilter("status", e.target.value)}
          aria-label={t("vendorOrders.allStatuses")}
          className="rounded-md border border-border bg-surface-alt px-3 py-2 text-[13px] font-bold text-text transition-all focus:border-primary focus:bg-surface focus:outline-none"
        >
          <option value="">{t("vendorOrders.allStatuses")}</option>
          {GROUP_STATUSES.map((s) => (
            <option key={s} value={s}>{t(`order.status_${s}`)}</option>
          ))}
        </select>
      </div>

      {loaderData.groups.length === 0 ? (
        <EmptyState title={t("vendorOrders.empty")} body={t("vendorOrders.pickupFeeNote")} />
      ) : (
        <div className="flex flex-col gap-3.5">
          {loaderData.groups.map((g: VendorGroup) => {
            const own = loaderData.items.filter((it: { group_id: string }) => it.group_id === g.id);
            const pieces = own.reduce((s: number, it: { qty: number }) => s + it.qty, 0);
            const history = (loaderData.docs as Array<{ order_id: string; doc_type: string; copies: number; created_at: string }>)
              .filter((d) => d.order_id === g.order.id);
            const next = NEXT_STEP[g.status];
            const shipBlocked = g.shipping_mode === "vendor" && g.vendor_ship_status !== "approved";
            const printQ = `?lang=${en ? "en" : "ar"}`;

            const tone =
              g.status === "delivered"
                ? "success"
                : g.status === "cancelled"
                ? "danger"
                : ["preparing", "handed_to_carrier", "out_for_delivery"].includes(g.status)
                ? "warning"
                : "neutral";

            return (
              <section
                key={g.id}
                className="rounded-lg border border-border bg-surface p-4 sm:p-5 shadow-1 transition-all duration-150 hover:shadow-2"
              >
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-base font-black text-text" dir="ltr">{g.order.number}</p>
                      <span className="rounded bg-surface-alt px-2 py-0.5 text-[11px] font-bold text-text-muted border border-border">
                        {t("order.pieces")}: <span className="num">{pieces}</span>
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-text-muted">
                      {new Date(g.order.created_at).toLocaleDateString(en ? "en-EG" : "ar-EG")} · {g.order.ship_name}
                    </p>
                  </div>
                  <Badge tone={tone} dot>
                    {t(`order.status_${g.status}`)}
                  </Badge>
                </div>

                {/* vendor-shipping state banner (VO-04/US-03) */}
                {g.shipping_mode === "vendor" ? (
                  g.vendor_ship_status === "pending_admin" ? (
                    <p role="status" className="mt-3 rounded-md border border-warning/30 bg-warning-soft p-2.5 text-xs font-bold text-warning-strong">
                      {t("vendorOrders.awaitingAdmin")}
                    </p>
                  ) : g.vendor_ship_status === "rejected" ? (
                    <p role="status" className="mt-3 rounded-md border border-danger/30 bg-danger-soft p-2.5 text-xs font-bold text-danger">
                      {t("vendorOrders.shipRejected")}
                    </p>
                  ) : g.vendor_ship_status === "approved" ? (
                    <p role="status" className="mt-3 rounded-md border border-success/30 bg-success-soft p-2.5 text-xs font-bold text-success-strong">
                      {t("vendorOrders.shipApproved")}
                    </p>
                  ) : (
                    <fetcher.Form method="post" preventScrollReset className="mt-3">
                      <input type="hidden" name="intent" value="request_shipping" />
                      <input type="hidden" name="group_id" value={g.id} />
                      <Button type="submit" variant="outline" size="sm" disabled={busy}>
                        {t("vendorOrders.requestShip")}
                      </Button>
                    </fetcher.Form>
                  )
                ) : null}

                {/* Items List */}
                <ul className="mt-3 flex flex-col divide-y divide-border text-[13px]">
                  {own.map((it: { id: string; product_name_ar: string; product_name_en: string; option_key: string; qty: number; line_total_piastres: number; coupon_discount_piastres: number }) => (
                    <li key={it.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span className="font-bold text-text">
                        {en ? it.product_name_en : it.product_name_ar}
                        {it.option_key ? <span className="text-text-muted font-normal"> ({it.option_key})</span> : null}
                        <span className="text-action ms-1">× {it.qty}</span>
                      </span>
                      <span className="tabular-nums font-bold text-text-muted">
                        {money(it.line_total_piastres)}
                        {it.coupon_discount_piastres > 0 ? ` · −${money(it.coupon_discount_piastres)}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                  <p className="text-[13px]">
                    <span className="text-text-muted">{t("order.vendorNet")}: </span>
                    <span className="text-base font-black text-text tabular-nums text-action">
                      {money(g.items_subtotal_piastres - g.discount_piastres)}
                    </span>
                  </p>
                  <p className="text-[11px] text-text-faint">{t("vendorOrders.pickupFeeNote")}</p>
                </div>

                {/* fulfillment transitions (VO-03; server-validated ladder) */}
                {next && g.status !== "cancelled" ? (
                  <fetcher.Form method="post" preventScrollReset className="mt-3 flex flex-wrap items-center gap-2 rounded-md bg-surface-alt p-3 border border-border">
                    <input type="hidden" name="intent" value="status" />
                    <input type="hidden" name="group_id" value={g.id} />
                    <input type="hidden" name="status" value={next.to} />
                    <input
                      name="note"
                      placeholder={t("order.notePlaceholder")}
                      className="min-w-40 flex-1 rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] text-text focus:border-primary focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={busy || shipBlocked}
                      className="cursor-pointer rounded-md bg-action px-3.5 py-1.5 text-[13px] font-bold text-on-action hover:bg-action-hover disabled:cursor-not-allowed disabled:opacity-50 transition-colors shadow-1"
                    >
                      {t(next.key)}
                    </button>
                    {shipBlocked && g.vendor_ship_status === "pending_admin" ? (
                      <span className="text-xs text-text-muted">{t("vendorOrders.awaitingAdmin")}</span>
                    ) : null}
                  </fetcher.Form>
                ) : null}

                {g.status === "cancelled" && g.cancel_reason ? (
                  <p className="mt-2 text-xs font-bold text-danger">{t("order.cancelReason")}: {g.cancel_reason}</p>
                ) : null}

                {/* print actions (VO-19) + per-order history (VO-20) */}
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                  <a
                    href={`/order/${encodeURIComponent(g.order.number)}/print/invoice_vendor${printQ}`}
                    target="_blank" rel="noreferrer"
                    className="rounded-md border border-action px-2.5 py-1.5 text-xs font-bold text-action hover:bg-surface-tint"
                  >
                    {t("order.printInvoiceVendor")}
                  </a>
                  <a
                    href={`/order/${encodeURIComponent(g.order.number)}/print/label_vendor${printQ}`}
                    target="_blank" rel="noreferrer"
                    className="rounded-md border border-action px-2.5 py-1.5 text-xs font-bold text-action hover:bg-surface-tint"
                  >
                    {t("order.printLabelVendor")}
                  </a>
                </div>
                {history.length > 0 ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[13px] font-bold text-text">{t("vendorOrders.printHistory")} ({history.length})</summary>
                    <ul className="mt-1.5 flex flex-col gap-1 text-xs text-text-muted">
                      {history.slice(0, 8).map((d, i) => (
                        <li key={`${d.created_at}-${i}`} className="flex flex-wrap justify-between gap-2">
                          <span>{t(`order.doc_${d.doc_type}`)} × <span className="num">{d.copies}</span></span>
                          <span className="num">{new Date(d.created_at).toLocaleString(en ? "en-EG" : "ar-EG")}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </section>
            );
          })}
        </div>
      )}
    </div>
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

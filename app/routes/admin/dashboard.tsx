import { useState, type ReactNode } from "react";
import { data, Link, useNavigation } from "react-router";
import type { Route } from "./+types/dashboard";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { formatPiastres } from "~/lib/money";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonPage } from "~/components/ui/Skeleton";
import { MediaImg } from "~/components/catalog/MediaImg";
import {
  AlertIcon, CashIcon, ChartIcon, MailIcon, PackageIcon, PencilIcon, ReceiptIcon, RotateIcon,
  ShieldIcon, StoreIcon, UsersIcon,
} from "~/components/ui/icons";

/**
 * A-01 — Admin dashboard v2.
 *
 * Top: the work queue (everything waiting for a decision), for admins AND staff.
 * Below, admins only: period KPIs with the change against the previous period,
 * daily sales, order status and payment mix, best categories / stores /
 * products, recent orders, growth and catalogue health — one RPC
 * (fn_admin_dashboard), which refuses anyone who is not an admin.
 */

const PERIODS = [1, 7, 30, 90] as const;
type Period = (typeof PERIODS)[number];

interface PeriodKpis {
  gmv: number; orders: number; orders_paid: number; aov: number; commission: number; discounts: number;
  buyers: number; cancelled: number; new_customers: number; new_vendors: number; new_products: number;
  refunds_amount: number; refunds_count: number;
}
interface Dash {
  days: number; from: string; to: string;
  kpis: { cur: PeriodKpis; prev: PeriodKpis };
  series: Array<{ day: string; sales: number; orders: number }>;
  by_status: Record<string, number>;
  by_payment: Array<{ method: string; orders: number; amount: number }>;
  top_categories: Array<{ name_ar: string; name_en: string; revenue: number; units: number }>;
  top_vendors: Array<{ id: string; slug: string; name_ar: string; name_en: string; logo: string | null; orders: number; revenue: number; commission: number }>;
  top_products: Array<{ id: string; name_ar: string; name_en: string; image: string | null; units: number; revenue: number }>;
  recent_orders: Array<{ id: string; number: string; name: string; total: number; status: string; payment_method: string; payment_status: string; created_at: string }>;
  catalog: { approved: number; pending: number; draft: number; rejected: number; out_of_stock: number; low_stock: number; listed: number };
  totals: { customers: number; users_all?: number; support?: number; admins?: number; vendors_all?: number; products_all?: number; products_live?: number; orders_all?: number; vendors_active: number; vendors_pending: number; gmv_all: number; commission_all: number; withdrawals_pending: number; withdrawals_pending_amount: number; repeat_buyers: number; all_buyers: number };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  const viewer = await requirePanelAccess(client, lang, "admin", request);
  // money and site statistics are the owner's eyes only
  const isAdmin = viewer.profile.role === "admin";
  const raw = Number(new URL(request.url).searchParams.get("days"));
  const days: Period = (PERIODS as readonly number[]).includes(raw) ? (raw as Period) : 30;

  // the work queue: shared by admins and staff (no money in it)
  const [products, vendors, storeChanges, verifications, refunds, ordersAction, messages, nextProducts, withdrawals, dash] = await Promise.all([
    client.from("products").select("id", { count: "exact", head: true }).eq("status", "pending").is("deleted_at", null),
    client.from("vendors").select("id", { count: "exact", head: true }).eq("status", "pending"),
    client.from("vendor_change_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
    client.from("vendors").select("id", { count: "exact", head: true }).eq("verification_status", "submitted"),
    client.from("refund_requests").select("id", { count: "exact", head: true }).eq("status", "pending_admin"),
    client.from("orders").select("id", { count: "exact", head: true }).in("status", ["pending_payment", "processing", "on_hold"]),
    client.from("contact_messages").select("id", { count: "exact", head: true }).eq("status", "new"),
    client.from("products")
      .select("id, name_ar, name_en, submitted_at, created_at, vendors(store_name_ar, store_name_en), product_media(path, kind, position)")
      .eq("status", "pending").is("deleted_at", null)
      .order("submitted_at", { ascending: true, nullsFirst: false }).limit(4),
    isAdmin ? client.from("withdrawal_requests").select("id", { count: "exact", head: true }).eq("status", "pending") : Promise.resolve({ count: 0 }),
    isAdmin ? client.rpc("fn_admin_dashboard", { p_days: days }) : Promise.resolve({ data: null, error: null }),
  ]);
  if (dash.error) throw new Error(dash.error.message);

  const firstImage = (m: unknown) =>
    ((m ?? []) as Array<{ path: string; kind: string; position: number | null }>)
      .filter((x) => x.kind === "image").sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0]?.path ?? null;

  return {
    lang,
    isAdmin,
    days,
    queue: {
      products: products.count ?? 0,
      vendors: vendors.count ?? 0,
      storeChanges: storeChanges.count ?? 0,
      verifications: verifications.count ?? 0,
      refunds: refunds.count ?? 0,
      orders: ordersAction.count ?? 0,
      messages: messages.count ?? 0,
      withdrawals: withdrawals.count ?? 0,
    },
    nextProducts: ((nextProducts.data ?? []) as Array<Record<string, unknown>>).map((r) => {
      const v = (r.vendors ?? {}) as { store_name_ar?: string; store_name_en?: string };
      return {
        id: r.id as string, name_ar: (r.name_ar as string) ?? "", name_en: (r.name_en as string) ?? "",
        store_ar: v.store_name_ar ?? "", store_en: v.store_name_en ?? "",
        since: (r.submitted_at as string | null) ?? (r.created_at as string), image: firstImage(r.product_media),
      };
    }),
    dash: (dash.data ?? null) as Dash | null,
  };
}

/* ------------------------------------------------------------------ helpers */

/** % change against the previous period; null = nothing to compare with. */
function delta(cur: number, prev: number): { pct: number | null; isNew: boolean } {
  if (prev > 0) return { pct: Math.round(((cur - prev) / prev) * 100), isNew: false };
  return { pct: null, isNew: cur > 0 };
}

function waitedDays(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

const STATUS_ORDER = ["pending_payment", "processing", "on_hold", "completed", "cancelled"] as const;
const STATUS_DOT: Record<string, string> = {
  pending_payment: "bg-warning", processing: "bg-info", on_hold: "bg-warning-strong", completed: "bg-success", cancelled: "bg-text-faint",
};

/* --------------------------------------------------------------------- page */

export default function AdminDashboard({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const { lang, isAdmin, days, queue, nextProducts, dash } = loaderData;
  const root = `/${lang}/admin`;
  const busy = useNavigation().state === "loading";
  const money = (p: number) => formatPiastres(p, en ? "en" : "ar");
  const num = (n: number) => n.toLocaleString(en ? "en-US" : "ar-EG-u-nu-latn");
  const L = (o: { name_ar: string; name_en: string }) => (en ? o.name_en || o.name_ar : o.name_ar || o.name_en) || "—";

  const tiles: QueueTile[] = [
    { to: `${root}/products?status=pending&sort=oldest`, label: t("dash.q.products"), count: queue.products, icon: <PackageIcon /> },
    { to: `${root}/orders?filter=active`, label: t("dash.q.orders"), count: queue.orders, icon: <ReceiptIcon /> },
    { to: `${root}/vendors?status=pending`, label: t("dash.q.vendors"), count: queue.vendors, icon: <StoreIcon /> },
    { to: `${root}/store-changes`, label: t("dash.q.storeChanges"), count: queue.storeChanges, icon: <PencilIcon /> },
    { to: `${root}/vendors?verify=submitted`, label: t("dash.q.verifications"), count: queue.verifications, icon: <ShieldIcon /> },
    { to: `${root}/refunds`, label: t("dash.q.refunds"), count: queue.refunds, icon: <RotateIcon /> },
    { to: `${root}/contact`, label: t("dash.q.messages"), count: queue.messages, icon: <MailIcon /> },
    ...(isAdmin ? [{ to: `${root}/withdrawals`, label: t("dash.q.withdrawals"), count: queue.withdrawals, icon: <CashIcon /> }] : []),
  ];
  const waiting = tiles.reduce((s, x) => s + x.count, 0);

  return (
    <div className={`flex flex-col gap-6 transition-opacity ${busy ? "opacity-70" : ""}`}>
      {/* header + period */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-black text-text">{t("adminDash.title")}</h1>
          <p className="mt-1 text-sm text-text-muted">
            {waiting > 0 ? t("dash.waitingSummary", { count: waiting }) : t("dash.allClear")}
          </p>
        </div>
        {isAdmin ? (
          <nav aria-label={t("dash.period")} className="flex w-full rounded-lg border border-border bg-surface p-1 shadow-1 sm:w-auto">
            {PERIODS.map((d) => (
              <Link key={d} to={`?days=${d}`} preventScrollReset aria-current={d === days ? "page" : undefined}
                className={`flex-1 rounded-md px-3 py-1.5 text-center text-xs font-extrabold transition-colors sm:flex-none ${
                  d === days ? "bg-action text-on-action" : "text-text-muted hover:bg-surface-tint hover:text-text"}`}>
                {t(`dash.p${d}`)}
              </Link>
            ))}
          </nav>
        ) : null}
      </header>

      {/* work queue */}
      <section aria-labelledby="dash-queue" className="flex flex-col gap-3">
        <h2 id="dash-queue" className="text-sm font-extrabold text-text">{t("dash.queue")}</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {tiles.map((x) => <QueueCard key={x.to} {...x} />)}
        </div>
        {nextProducts.length ? (
          <div className="rounded-lg border border-border bg-surface shadow-1">
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <h3 className="text-sm font-extrabold text-text">{t("dash.nextProducts")}</h3>
              <Link to={`${root}/products?status=pending&sort=oldest`} className="text-xs font-bold text-action hover:underline">{t("dash.reviewAll")}</Link>
            </div>
            <ul className="grid grid-cols-1 divide-y divide-border sm:grid-cols-2 sm:divide-y-0">
              {nextProducts.map((p) => {
                const d = waitedDays(p.since);
                return (
                  <li key={p.id} className="min-w-0 sm:border-b sm:border-border sm:[&:nth-last-child(-n+2)]:border-b-0 sm:odd:border-e">
                    <Link to={`${root}/products/${p.id}`} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-tint/60">
                      <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-surface-tint text-text-faint">
                        {p.image ? <MediaImg path={p.image} alt="" width={40} height={40} className="size-full object-cover" /> : <PackageIcon className="size-4" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold text-text">{L(p)}</span>
                        <span className="block truncate text-xs text-text-muted">{(en ? p.store_en || p.store_ar : p.store_ar || p.store_en) || "—"}</span>
                      </span>
                      <span className={`num shrink-0 rounded-full px-2 py-0.5 text-2xs font-extrabold ${d >= 2 ? "bg-danger-soft text-danger" : "bg-surface-tint text-text-muted"}`}>
                        {d === 0 ? t("adminDash.review.today") : t("adminDash.review.days", { count: d })}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </section>

      {isAdmin && dash ? (
        <>
          {/* the platform at a glance: people, catalogue, orders (all time), with this period's growth */}
          <section aria-labelledby="dash-glance" className="flex flex-col gap-3">
            <h2 id="dash-glance" className="text-sm font-extrabold text-text">{t("dash.glance")}</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
              <GlanceTile label={t("dash.g.users")} value={num(dash.totals.users_all ?? 0)} />
              <GlanceTile label={t("dash.g.customers")} value={num(dash.totals.customers)} d={delta(dash.kpis.cur.new_customers, dash.kpis.prev.new_customers)} sub={t("dash.g.newThis", { count: dash.kpis.cur.new_customers })} />
              <GlanceTile label={t("dash.g.vendors")} value={num(dash.totals.vendors_all ?? dash.totals.vendors_active)} d={delta(dash.kpis.cur.new_vendors, dash.kpis.prev.new_vendors)} sub={t("dash.g.activeOf", { count: dash.totals.vendors_active })} />
              <GlanceTile label={t("dash.g.support")} value={num(dash.totals.support ?? 0)} />
              <GlanceTile label={t("dash.g.admins")} value={num(dash.totals.admins ?? 0)} />
              <GlanceTile label={t("dash.g.products")} value={num(dash.totals.products_all ?? 0)} d={delta(dash.kpis.cur.new_products, dash.kpis.prev.new_products)} sub={t("dash.g.liveOf", { count: dash.totals.products_live ?? 0 })} />
              <GlanceTile label={t("dash.g.orders")} value={num(dash.totals.orders_all ?? 0)} d={delta(dash.kpis.cur.orders, dash.kpis.prev.orders)} sub={t("dash.g.newThis", { count: dash.kpis.cur.orders })} />
              <GlanceTile label={t("dash.g.buyers")} value={num(dash.totals.all_buyers)} sub={dash.totals.all_buyers ? t("dash.g.repeat", { pct: Math.round((dash.totals.repeat_buyers / dash.totals.all_buyers) * 100) }) : undefined} />
            </div>
          </section>

          {/* period KPIs */}
          <section aria-labelledby="dash-kpis" className="flex flex-col gap-3">
            <h2 id="dash-kpis" className="text-sm font-extrabold text-text">{t("dash.performance", { period: t(`dash.p${days}`) })}</h2>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi label={t("dash.k.gmv")} value={money(dash.kpis.cur.gmv)} d={delta(dash.kpis.cur.gmv, dash.kpis.prev.gmv)} hint={t("dash.k.gmvHint")} accent />
              <Kpi label={t("dash.k.commission")} value={money(dash.kpis.cur.commission)} d={delta(dash.kpis.cur.commission, dash.kpis.prev.commission)} hint={t("dash.k.commissionHint")} />
              <Kpi label={t("dash.k.orders")} value={num(dash.kpis.cur.orders)} d={delta(dash.kpis.cur.orders, dash.kpis.prev.orders)}
                hint={t("dash.k.ordersHint", { paid: num(dash.kpis.cur.orders_paid), cancelled: num(dash.kpis.cur.cancelled) })} />
              <Kpi label={t("dash.k.aov")} value={money(dash.kpis.cur.aov)} d={delta(dash.kpis.cur.aov, dash.kpis.prev.aov)} hint={t("dash.k.aovHint")} />
            </div>
          </section>

          {/* sales chart + order mix */}
          <section className="grid gap-4 lg:grid-cols-3">
            <Panel title={t("dash.dailySales")} className="lg:col-span-2"
              action={<span className="num text-xs font-bold text-text-muted">{money(dash.kpis.cur.gmv)}</span>}>
              <SalesBars points={dash.series} money={money} emptyLabel={t("adminDash.noData")} ordersLabel={t("dash.k.orders")} lang={en ? "en" : "ar"} />
            </Panel>
            <Panel title={t("dash.ordersByStatus")}>
              <StatusList counts={dash.by_status} labelOf={(s) => t(`order.status_${s}`)} empty={t("adminDash.noData")} />
              <div className="mt-5 border-t border-border pt-4">
                <h4 className="mb-3 text-xs font-extrabold text-text-muted">{t("dash.payments")}</h4>
                {dash.by_payment.length === 0 ? <p className="text-xs text-text-muted">{t("adminDash.noData")}</p> : (
                  <ul className="flex flex-col gap-2.5">
                    {dash.by_payment.map((p) => (
                      <li key={p.method} className="flex items-center justify-between gap-3 text-sm">
                        <span className="font-bold text-text">{t(`checkout.pay_${p.method}`)}</span>
                        <span className="num text-xs text-text-muted">{t("dash.ordersCount", { count: p.orders })} · <b className="text-text">{money(p.amount)}</b></span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Panel>
          </section>

          {/* leaders */}
          <section className="grid gap-4 lg:grid-cols-3">
            <Panel title={t("dash.topCategories")}>
              <BarList empty={t("adminDash.noData")} rows={dash.top_categories.map((c) => ({ key: c.name_en, label: L(c), value: c.revenue, display: money(c.revenue), sub: t("dash.units", { count: c.units }) }))} />
            </Panel>
            <Panel title={t("dash.topVendors")} action={<Link to={`${root}/vendors`} className="text-xs font-bold text-action hover:underline">{t("dash.viewAll")}</Link>}>
              {dash.top_vendors.length === 0 ? <Empty text={t("adminDash.noData")} /> : (
                <ol className="flex flex-col gap-1">
                  {dash.top_vendors.map((v, i) => (
                    <li key={v.id}>
                      <Link to={`${root}/vendors/${v.id}`} className="flex items-center gap-3 rounded-md p-1.5 transition-colors hover:bg-surface-tint/60">
                        <span className="num w-4 shrink-0 text-center text-xs font-black text-text-faint">{i + 1}</span>
                        <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-white">
                          {v.logo ? <MediaImg path={v.logo} alt="" width={36} height={36} className="size-full object-contain" /> : <StoreIcon className="size-4 text-text-faint" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-bold text-text">{L(v)}</span>
                          <span className="num block text-2xs text-text-muted">{t("dash.ordersCount", { count: v.orders })} · {t("dash.commissionShort")} {money(v.commission)}</span>
                        </span>
                        <span className="num shrink-0 text-sm font-black text-text">{money(v.revenue)}</span>
                      </Link>
                    </li>
                  ))}
                </ol>
              )}
            </Panel>
            <Panel title={t("dash.topProducts")}>
              {dash.top_products.length === 0 ? <Empty text={t("adminDash.noData")} /> : (
                <ol className="flex flex-col gap-1">
                  {dash.top_products.map((p, i) => (
                    <li key={p.id}>
                      <Link to={`${root}/products/${p.id}`} className="flex items-center gap-3 rounded-md p-1.5 transition-colors hover:bg-surface-tint/60">
                        <span className="num w-4 shrink-0 text-center text-xs font-black text-text-faint">{i + 1}</span>
                        <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-surface-tint">
                          {p.image ? <MediaImg path={p.image} alt="" width={36} height={36} className="size-full object-cover" /> : <PackageIcon className="size-4 text-text-faint" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-bold text-text">{L(p)}</span>
                          <span className="num block text-2xs text-text-muted">{t("dash.units", { count: p.units })}</span>
                        </span>
                        <span className="num shrink-0 text-sm font-black text-text">{money(p.revenue)}</span>
                      </Link>
                    </li>
                  ))}
                </ol>
              )}
            </Panel>
          </section>

          {/* recent orders + growth */}
          <section className="grid gap-4 lg:grid-cols-3">
            <Panel title={t("dash.recentOrders")} className="lg:col-span-2" flush
              action={<Link to={`${root}/orders`} className="text-xs font-bold text-action hover:underline">{t("dash.viewAll")}</Link>}>
              {dash.recent_orders.length === 0 ? <div className="p-4"><Empty text={t("adminDash.noData")} /></div> : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead>
                      <tr className="border-b border-border text-start text-2xs font-extrabold text-text-muted">
                        <th className="px-4 py-2 text-start">{t("dash.col.order")}</th>
                        <th className="px-4 py-2 text-start">{t("dash.col.customer")}</th>
                        <th className="px-4 py-2 text-start">{t("dash.col.status")}</th>
                        <th className="px-4 py-2 text-start">{t("dash.col.payment")}</th>
                        <th className="px-4 py-2 text-end">{t("dash.col.total")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {dash.recent_orders.map((o) => (
                        <tr key={o.id} className="transition-colors hover:bg-surface-tint/50">
                          <td className="px-4 py-2.5">
                            <Link to={`${root}/orders/${o.id}`} className="num font-extrabold text-action hover:underline">{o.number}</Link>
                            <span className="num block text-2xs text-text-muted">{new Date(o.created_at).toLocaleDateString(en ? "en-GB" : "ar-EG-u-nu-latn", { day: "numeric", month: "short" })}</span>
                          </td>
                          <td className="max-w-[10rem] truncate px-4 py-2.5 font-bold text-text">{o.name}</td>
                          <td className="px-4 py-2.5">
                            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-text">
                              <span aria-hidden="true" className={`size-2 rounded-full ${STATUS_DOT[o.status] ?? "bg-text-faint"}`} />
                              {t(`order.status_${o.status}`)}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-xs text-text-muted">{t(`checkout.pay_${o.payment_method}`)}</td>
                          <td className="num px-4 py-2.5 text-end font-black text-text">{money(o.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
            <Panel title={t("dash.growth", { period: t(`dash.p${days}`) })}>
              <ul className="flex flex-col divide-y divide-border">
                <GrowthRow icon={<UsersIcon />} label={t("dash.g.customers")} value={num(dash.kpis.cur.new_customers)} d={delta(dash.kpis.cur.new_customers, dash.kpis.prev.new_customers)} />
                <GrowthRow icon={<StoreIcon />} label={t("dash.g.vendors")} value={num(dash.kpis.cur.new_vendors)} d={delta(dash.kpis.cur.new_vendors, dash.kpis.prev.new_vendors)} />
                <GrowthRow icon={<PackageIcon />} label={t("dash.g.products")} value={num(dash.kpis.cur.new_products)} d={delta(dash.kpis.cur.new_products, dash.kpis.prev.new_products)} />
                <GrowthRow icon={<ChartIcon />} label={t("dash.g.buyers")} value={num(dash.kpis.cur.buyers)} d={delta(dash.kpis.cur.buyers, dash.kpis.prev.buyers)} />
                <GrowthRow icon={<RotateIcon />} label={t("dash.g.refunds")} value={`${num(dash.kpis.cur.refunds_count)} · ${money(dash.kpis.cur.refunds_amount)}`} d={null} />
              </ul>
            </Panel>
          </section>

          {/* catalogue + all time */}
          <section className="grid gap-4 lg:grid-cols-3">
            <Panel title={t("dash.catalog")} className="lg:col-span-2"
              action={<Link to={`${root}/products`} className="text-xs font-bold text-action hover:underline">{t("dash.viewAll")}</Link>}>
              <CatalogBar c={dash.catalog} t={t} num={num} />
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <MiniStat label={t("dash.c.listed")} value={num(dash.catalog.listed)} />
                <MiniStat label={t("dash.c.outOfStock")} value={num(dash.catalog.out_of_stock)} warn={dash.catalog.out_of_stock > 0} icon={<AlertIcon />} />
                <MiniStat label={t("dash.c.lowStock")} value={num(dash.catalog.low_stock)} warn={dash.catalog.low_stock > 0} />
              </div>
            </Panel>
            <Panel title={t("dash.allTime")}>
              <dl className="flex flex-col divide-y divide-border">
                <TotalRow label={t("dash.t.gmv")} value={money(dash.totals.gmv_all)} strong />
                <TotalRow label={t("dash.t.commission")} value={money(dash.totals.commission_all)} strong />
                <TotalRow label={t("dash.t.customers")} value={num(dash.totals.customers)} />
                <TotalRow label={t("dash.t.vendors")} value={num(dash.totals.vendors_active)} />
                <TotalRow label={t("dash.t.repeat")} value={dash.totals.all_buyers ? `${Math.round((dash.totals.repeat_buyers / dash.totals.all_buyers) * 100)}%` : "—"} />
                <TotalRow label={t("dash.t.withdrawals")} value={money(dash.totals.withdrawals_pending_amount)} />
              </dl>
            </Panel>
          </section>
        </>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

interface QueueTile { to: string; label: string; count: number; icon: ReactNode }

function QueueCard({ to, label, count, icon }: QueueTile) {
  const { t } = useTranslation();
  const on = count > 0;
  return (
    <Link to={to}
      className={`group flex items-center gap-3 rounded-lg border bg-surface p-3.5 shadow-1 transition-all duration-150 hover:-translate-y-0.5 hover:shadow-2 ${
        on ? "border-warning/60" : "border-border"}`}>
      <span aria-hidden="true" className={`grid size-10 shrink-0 place-items-center rounded-lg [&>svg]:size-5 ${on ? "bg-warning-soft text-warning-strong" : "bg-surface-tint text-text-faint"}`}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`num block text-2xl font-black leading-none ${on ? "text-text" : "text-text-faint"}`}>{count}</span>
        <span className="mt-1 block truncate text-xs font-bold text-text-muted">{label}</span>
      </span>
      {on ? <span className="sr-only">{t("common.pending")}</span> : null}
    </Link>
  );
}

function DeltaChip({ d }: { d: { pct: number | null; isNew: boolean } | null }) {
  const { t } = useTranslation();
  if (!d) return null;
  if (d.pct === null) {
    return d.isNew
      ? <span className="rounded-full bg-success-soft px-2 py-0.5 text-2xs font-extrabold text-success-strong">{t("dash.new")}</span>
      : <span className="rounded-full bg-surface-tint px-2 py-0.5 text-2xs font-bold text-text-faint">—</span>;
  }
  const up = d.pct >= 0;
  return (
    <span className={`num inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-2xs font-extrabold ${up ? "bg-success-soft text-success-strong" : "bg-danger-soft text-danger"}`} dir="ltr">
      {up ? "▲" : "▼"} {Math.abs(d.pct)}%
    </span>
  );
}

function Kpi({ label, value, d, hint, accent = false }: { label: string; value: string; d: { pct: number | null; isNew: boolean }; hint: string; accent?: boolean }) {
  return (
    <div className={`flex flex-col gap-2 rounded-lg border p-4 shadow-1 ${accent ? "border-action/30 bg-gradient-to-b from-action/5 to-surface" : "border-border bg-surface"}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-extrabold text-text-muted">{label}</p>
        <DeltaChip d={d} />
      </div>
      <p className={`num truncate text-xl font-black sm:text-2xl ${accent ? "text-action" : "text-text"}`}>{value}</p>
      <p className="num truncate text-2xs text-text-muted">{hint}</p>
    </div>
  );
}

function Panel({ title, action, className = "", flush = false, children }: { title: string; action?: ReactNode; className?: string; flush?: boolean; children: ReactNode }) {
  return (
    <section className={`flex flex-col rounded-lg border border-border bg-surface shadow-1 ${className}`}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h3 className="text-sm font-extrabold text-text">{title}</h3>
        {action}
      </div>
      <div className={flush ? "" : "p-4"}>{children}</div>
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="py-6 text-center text-sm text-text-muted">{text}</p>;
}

/** Single-series daily bars (one hue, rounded tops, hover tooltip + table fallback). */
function SalesBars({ points, money, emptyLabel, ordersLabel, lang }: {
  points: Array<{ day: string; sales: number; orders: number }>; money: (p: number) => string; emptyLabel: string; ordersLabel: string; lang: "ar" | "en";
}) {
  const { t } = useTranslation();
  const [hover, setHover] = useState<number | null>(null);
  if (points.every((p) => p.sales === 0 && p.orders === 0)) return <Empty text={emptyLabel} />;
  const max = Math.max(1, ...points.map((p) => p.sales));
  const fmt = (day: string) => new Date(`${day}T00:00:00`).toLocaleDateString(lang === "en" ? "en-GB" : "ar-EG-u-nu-latn", { day: "numeric", month: "short" });
  const ticks = [0, Math.floor((points.length - 1) / 2), points.length - 1].filter((v, i, a) => a.indexOf(v) === i);
  const h = hover != null ? points[hover] : null;
  return (
    <figure className="flex flex-col gap-2">
      <div className="relative">
        {/* recessive grid */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex flex-col justify-between">
          {[0, 1, 2, 3].map((i) => <span key={i} className="border-t border-dashed border-border" />)}
        </div>
        <div className="relative flex h-48 items-end gap-[2px]" dir="ltr" onMouseLeave={() => setHover(null)}>
          {points.map((p, i) => (
            <button key={p.day} type="button" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
              aria-label={`${fmt(p.day)}: ${money(p.sales)}`}
              className="group relative flex h-full flex-1 cursor-default items-end focus:outline-none">
              <span className={`w-full rounded-t-[4px] transition-colors ${hover === i ? "bg-action" : p.sales > 0 ? "bg-action/70" : "bg-border"}`}
                style={{ height: p.sales > 0 ? `${Math.max(3, (p.sales / max) * 100)}%` : "2px" }} />
            </button>
          ))}
        </div>
        {h ? (
          <div className="pointer-events-none absolute top-0 z-10 rounded-md border border-border bg-surface px-3 py-2 text-xs shadow-2"
            style={{ left: `clamp(0px, calc(${((hover! + 0.5) / points.length) * 100}% - 70px), calc(100% - 140px))` }}>
            <p className="num font-bold text-text-muted">{fmt(h.day)}</p>
            <p className="num text-sm font-black text-text">{money(h.sales)}</p>
            <p className="num text-text-muted">{ordersLabel}: {h.orders}</p>
          </div>
        ) : null}
      </div>
      <div className="flex justify-between text-2xs tabular-nums text-text-muted" dir="ltr">
        {ticks.map((i) => <span key={i}>{fmt(points[i]!.day)}</span>)}
      </div>
      <details>
        <summary className="cursor-pointer text-xs font-bold text-action hover:underline">{t("adminDash.chartTable")}</summary>
        <div className="mt-2 max-h-48 overflow-y-auto rounded-md border border-border">
          <table className="w-full text-xs">
            <tbody className="divide-y divide-border">
              {points.filter((p) => p.orders > 0 || p.sales > 0).map((p) => (
                <tr key={p.day}>
                  <td className="num px-3 py-1.5 text-text-muted">{fmt(p.day)}</td>
                  <td className="num px-3 py-1.5 text-text-muted">{ordersLabel}: {p.orders}</td>
                  <td className="num px-3 py-1.5 text-end font-bold text-text">{money(p.sales)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

function StatusList({ counts, labelOf, empty }: { counts: Record<string, number>; labelOf: (s: string) => string; empty: string }) {
  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  if (!total) return <Empty text={empty} />;
  return (
    <ul className="flex flex-col gap-3">
      {STATUS_ORDER.filter((s) => counts[s]).map((s) => {
        const n = counts[s] ?? 0;
        return (
          <li key={s} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="inline-flex items-center gap-2 font-bold text-text">
                <span aria-hidden="true" className={`size-2.5 rounded-full ${STATUS_DOT[s]}`} />{labelOf(s)}
              </span>
              <span className="num text-xs text-text-muted"><b className="text-text">{n}</b> · {Math.round((n / total) * 100)}%</span>
            </div>
            <span className="h-1.5 overflow-hidden rounded-full bg-surface-tint">
              <span className={`block h-full rounded-full ${STATUS_DOT[s]}`} style={{ width: `${(n / total) * 100}%` }} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function BarList({ rows, empty }: { rows: Array<{ key: string; label: string; value: number; display: string; sub: string }>; empty: string }) {
  if (!rows.length) return <Empty text={empty} />;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((r) => (
        <li key={r.key} className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="truncate font-bold text-text">{r.label}</span>
            <span className="num shrink-0 font-black text-text">{r.display}</span>
          </div>
          <span className="h-2 overflow-hidden rounded-full bg-surface-tint">
            <span className="block h-full rounded-full bg-action/70" style={{ width: `${(r.value / max) * 100}%` }} />
          </span>
          <span className="num text-2xs text-text-muted">{r.sub}</span>
        </li>
      ))}
    </ul>
  );
}

function GrowthRow({ icon, label, value, d }: { icon: ReactNode; label: string; value: string; d: { pct: number | null; isNew: boolean } | null }) {
  return (
    <li className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
      <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-md bg-surface-tint text-text-muted [&>svg]:size-4">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-sm text-text">{label}</span>
      <span className="num shrink-0 text-sm font-black text-text">{value}</span>
      {d ? <DeltaChip d={d} /> : null}
    </li>
  );
}

function CatalogBar({ c, t, num }: { c: Dash["catalog"]; t: (k: string) => string; num: (n: number) => string }) {
  const parts = [
    { k: "approved", n: c.approved, cls: "bg-success" },
    { k: "pending", n: c.pending, cls: "bg-warning" },
    { k: "draft", n: c.draft, cls: "bg-text-faint" },
    { k: "rejected", n: c.rejected, cls: "bg-danger" },
  ];
  const total = parts.reduce((s, p) => s + p.n, 0) || 1;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-3 gap-[2px] overflow-hidden rounded-full" role="img" aria-label={parts.map((p) => `${t(`dash.c.${p.k}`)} ${p.n}`).join(", ")}>
        {parts.filter((p) => p.n > 0).map((p) => <span key={p.k} className={p.cls} style={{ width: `${(p.n / total) * 100}%` }} />)}
      </div>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {parts.map((p) => (
          <li key={p.k} className="flex items-center gap-2 text-xs">
            <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${p.cls}`} />
            <span className="text-text-muted">{t(`dash.c.${p.k}`)}</span>
            <b className="num ms-auto text-text">{num(p.n)}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

function GlanceTile({ label, value, sub, d }: { label: string; value: string; sub?: string; d?: { pct: number | null; isNew: boolean } | null }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-surface p-3 shadow-1">
      <p className="truncate text-2xs font-bold text-text-muted">{label}</p>
      <p className="num text-xl font-black text-text">{value}</p>
      <div className="flex min-h-5 flex-wrap items-center gap-1.5">
        {d !== undefined ? <DeltaChip d={d} /> : null}
        {sub ? <span className="num truncate text-2xs text-text-muted">{sub}</span> : null}
      </div>
    </div>
  );
}

function MiniStat({ label, value, warn = false, icon }: { label: string; value: string; warn?: boolean; icon?: ReactNode }) {
  return (
    <div className={`rounded-md border p-3 ${warn ? "border-warning/50 bg-warning-soft" : "border-border bg-surface-alt"}`}>
      <p className="flex items-center gap-1 text-2xs font-bold text-text-muted [&>svg]:size-3.5">{warn ? icon : null}{label}</p>
      <p className="num mt-1 text-lg font-black text-text">{value}</p>
    </div>
  );
}

function TotalRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
      <dt className="text-sm text-text-muted">{label}</dt>
      <dd className={`num text-sm ${strong ? "font-black text-action" : "font-extrabold text-text"}`}>{value}</dd>
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

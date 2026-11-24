import { Link, data } from "react-router";
import type { Route } from "./+types/packaging-orders";
import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { formatPiastres } from "~/lib/money";
import { Badge, EmptyState } from "~/components/ui";
import { PageHeader } from "~/components/layout/PageHeader";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonTable } from "~/components/ui/Skeleton";
import { PackagingStatusBadges, RET_TONE } from "~/features/packaging/components/PackagingOrderView";
import { ListSkeleton, useListLoading } from "~/components/ui/ListLoading";

/**
 * Admin → Packaging operations: one page for the whole fulfilment loop —
 * orders (by status), returns, every payment attempt (failures included),
 * and outstanding 50% balances with where each was collected. Invoices and
 * labels print from each order.
 */

const TABS = ["orders", "returns", "payments", "balances"] as const;
const ORDER_FILTERS = ["active", "pending_payment", "confirmed", "processing", "shipped", "delivered", "cancelled", "all"] as const;

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const url = new URL(request.url);
  const tab = (TABS as readonly string[]).includes(url.searchParams.get("tab") ?? "") ? (url.searchParams.get("tab") as (typeof TABS)[number]) : "orders";
  const filter = (ORDER_FILTERS as readonly string[]).includes(url.searchParams.get("status") ?? "") ? (url.searchParams.get("status") as string) : "active";

  let orders = client.from("packaging_orders")
    .select("id, number, status, payment_plan, payment_method, payment_status, payment_mode, total_piastres, paid_piastres, created_at, vendors(store_name_ar, store_name_en)")
    .order("created_at", { ascending: false }).limit(200);
  if (filter === "active") orders = orders.in("status", ["pending_payment", "confirmed", "processing", "shipped"]);
  else if (filter !== "all") orders = orders.eq("status", filter);

  const [o, r, p, b, counts] = await Promise.all([
    tab === "orders" ? orders : Promise.resolve({ data: [] }),
    tab === "returns" ? client.from("packaging_returns").select("id, number, status, source, refund_piastres, created_at, packaging_orders(number), vendors(store_name_ar, store_name_en)").order("created_at", { ascending: false }).limit(200) : Promise.resolve({ data: [] }),
    tab === "payments" ? client.from("packaging_payments").select("id, kind, method, amount_piastres, status, failure_reason, provider_ref, created_at, packaging_orders(number)").order("created_at", { ascending: false }).limit(300) : Promise.resolve({ data: [] }),
    tab === "balances" ? client.from("packaging_balances").select("id, status, amount_piastres, original_piastres, collected_at, note, created_at, packaging_orders(number), vendors(store_name_ar, store_name_en), orders:collected_order_id(number)").order("created_at", { ascending: false }).limit(300) : Promise.resolve({ data: [] }),
    Promise.all([
      client.from("packaging_orders").select("id", { count: "exact", head: true }).eq("status", "pending_payment"),
      client.from("packaging_orders").select("id", { count: "exact", head: true }).in("status", ["confirmed", "processing"]),
      client.from("packaging_returns").select("id", { count: "exact", head: true }).in("status", ["requested", "approved", "received"]),
      client.from("packaging_balances").select("amount_piastres").eq("status", "open"),
    ]),
  ]);
  const [awaiting, toShip, openReturns, openBal] = counts;
  return {
    lang, tab, filter,
    orders: (o.data ?? []) as unknown as Array<{ id: string; number: string; status: string; payment_plan: string; payment_method: string; payment_status: string; payment_mode: string; total_piastres: number; paid_piastres: number; created_at: string; vendors: { store_name_ar: string; store_name_en: string } | null }>,
    returns: (r.data ?? []) as unknown as Array<{ id: string; number: string; status: string; source: string; refund_piastres: number; created_at: string; packaging_orders: { number: string } | null; vendors: { store_name_ar: string; store_name_en: string } | null }>,
    payments: (p.data ?? []) as unknown as Array<{ id: string; kind: string; method: string; amount_piastres: number; status: string; failure_reason: string | null; provider_ref: string; created_at: string; packaging_orders: { number: string } | null }>,
    balances: (b.data ?? []) as unknown as Array<{ id: string; status: string; amount_piastres: number; original_piastres: number; collected_at: string | null; note: string | null; created_at: string; packaging_orders: { number: string } | null; vendors: { store_name_ar: string; store_name_en: string } | null; orders: { number: string } | null }>,
    stats: {
      awaiting: awaiting.count ?? 0, toShip: toShip.count ?? 0, openReturns: openReturns.count ?? 0,
      openBalance: ((openBal.data ?? []) as Array<{ amount_piastres: number }>).reduce((s, x) => s + x.amount_piastres, 0),
      openBalanceCount: (openBal.data ?? []).length,
    },
  };
}

export default function AdminPackagingOrders({ loaderData }: Route.ComponentProps) {
  const listLoading = useListLoading();
  const { t } = useTranslation();
  const { lang, tab, filter, stats } = loaderData;
  const en = lang === "en";
  const money = (p: number) => formatPiastres(p, lang);
  const day = (v: string) => new Date(v).toLocaleDateString(en ? "en-GB" : "ar-EG-u-nu-latn", { day: "numeric", month: "short" });
  const store = (v: { store_name_ar: string; store_name_en: string } | null) => (v ? (en ? v.store_name_en : v.store_name_ar) : "—");
  const orderLink = (n?: string) => n ? <Link to={`/${lang}/admin/packaging/orders/${encodeURIComponent(n)}`} className="num font-bold text-action hover:underline" dir="ltr">{n}</Link> : "—";
  const tabCls = (on: boolean) => `rounded-md px-3.5 py-1.5 text-xs font-bold ${on ? "bg-action text-on-action" : "text-text-muted hover:bg-surface-tint hover:text-text"}`;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("pkg.opsTitle")} subtitle={t("pkg.opsHint")}
        actions={<Link to={`/${lang}/admin/packaging`} className="rounded-md border border-border px-4 py-2 text-sm font-bold text-text hover:bg-surface-tint">{t("pkg.adminTitle")}</Link>} />

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t("pkg.statAwaiting")} value={stats.awaiting} />
        <Stat label={t("pkg.statToShip")} value={stats.toShip} />
        <Stat label={t("pkg.statReturns")} value={stats.openReturns} />
        <Stat label={t("pkg.statBalances", { n: stats.openBalanceCount })} value={money(stats.openBalance)} />
      </dl>

      <nav className="flex flex-wrap gap-1 rounded-lg border border-border bg-surface p-2 shadow-1">
        {TABS.map((x) => <Link key={x} to={`?tab=${x}`} className={tabCls(tab === x)}>{t(`pkg.tab_${x}`)}</Link>)}
      </nav>

      {tab === "orders" ? (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-1">
            {ORDER_FILTERS.map((f) => (
              <Link key={f} to={`?tab=orders&status=${f}`} className={`rounded-full border px-3 py-1 text-xs font-bold ${filter === f ? "border-action bg-action/10 text-action" : "border-border text-text-muted hover:text-text"}`}>
                {f === "active" ? t("pkg.filterActive") : f === "all" ? t("pkg.filterAll") : t(`pkg.status_${f}`)}
              </Link>
            ))}
          </div>
          {listLoading ? <ListSkeleton /> : loaderData.orders.length === 0 ? <EmptyState title={t("pkg.noOrders")} /> : (
            <Table head={[t("pkg.number"), t("pkg.store"), t("pkg.statusCol"), t("pkg.planCol"), t("pkg.total"), t("pkg.paid"), t("pkg.date")]}>
              {loaderData.orders.map((o) => (
                <tr key={o.id}>
                  <td className="p-2.5">{orderLink(o.number)}</td>
                  <td className="p-2.5">{store(o.vendors)}</td>
                  <td className="p-2.5"><PackagingStatusBadges status={o.status} payment={o.payment_status} mode={o.payment_mode} /></td>
                  <td className="p-2.5 text-xs text-text-muted">{t(`pkg.plan_${o.payment_plan}`)} · {t(`pkg.method_${o.payment_method}`)}</td>
                  <td className="num p-2.5 font-bold">{money(o.total_piastres)}</td>
                  <td className="num p-2.5">{money(o.paid_piastres)}</td>
                  <td className="num p-2.5 text-xs text-text-muted">{day(o.created_at)}</td>
                </tr>
              ))}
            </Table>
          )}
        </section>
      ) : null}

      {tab === "returns" ? (listLoading ? <ListSkeleton /> : loaderData.returns.length === 0 ? <EmptyState title={t("pkg.noReturns")} /> : (
        <Table head={[t("pkg.returnNo"), t("pkg.number"), t("pkg.store"), t("pkg.statusCol"), t("pkg.refundCol"), t("pkg.date")]}>
          {loaderData.returns.map((r) => (
            <tr key={r.id}>
              <td className="num p-2.5 font-bold" dir="ltr">{r.number}</td>
              <td className="p-2.5">{orderLink(r.packaging_orders?.number)}</td>
              <td className="p-2.5">{store(r.vendors)}</td>
              <td className="p-2.5"><Badge tone={RET_TONE[r.status] ?? "neutral"}>{t(`pkg.ret_${r.status}`)}</Badge></td>
              <td className="num p-2.5">{money(r.refund_piastres)}</td>
              <td className="num p-2.5 text-xs text-text-muted">{day(r.created_at)}</td>
            </tr>
          ))}
        </Table>
      )) : null}

      {tab === "payments" ? (listLoading ? <ListSkeleton /> : loaderData.payments.length === 0 ? <EmptyState title={t("pkg.noPayments")} /> : (
        <Table head={[t("pkg.number"), t("pkg.kindCol"), t("pkg.statusCol"), t("pkg.amount"), t("pkg.reference"), t("pkg.date")]}>
          {loaderData.payments.map((p) => (
            <tr key={p.id}>
              <td className="p-2.5">{orderLink(p.packaging_orders?.number)}</td>
              <td className="p-2.5 text-xs">{t(`pkg.k_${p.kind}`)} · {t(`pkg.m_${p.method}`)}</td>
              <td className="p-2.5">
                <Badge tone={p.status === "succeeded" ? (p.kind === "overpayment" ? "warning" : "success") : p.status === "failed" ? "danger" : "neutral"}>{t(`pkg.ps_${p.status}`)}</Badge>
                {p.failure_reason ? <span className="block text-2xs text-text-muted">{t(`pkg.fail_${p.failure_reason}`, { defaultValue: p.failure_reason })}</span> : null}
              </td>
              <td className="num p-2.5 font-bold">{p.kind === "refund" ? "−" : ""}{money(p.amount_piastres)}</td>
              <td className="num p-2.5 text-2xs text-text-muted" dir="ltr">{p.provider_ref}</td>
              <td className="num p-2.5 text-xs text-text-muted">{day(p.created_at)}</td>
            </tr>
          ))}
        </Table>
      )) : null}

      {tab === "balances" ? (listLoading ? <ListSkeleton /> : loaderData.balances.length === 0 ? <EmptyState title={t("pkg.noBalances")} /> : (
        <Table head={[t("pkg.number"), t("pkg.store"), t("pkg.statusCol"), t("pkg.outstanding"), t("pkg.collectedWith"), t("pkg.date")]}>
          {loaderData.balances.map((b) => (
            <tr key={b.id}>
              <td className="p-2.5">{orderLink(b.packaging_orders?.number)}</td>
              <td className="p-2.5">{store(b.vendors)}</td>
              <td className="p-2.5"><Badge tone={b.status === "open" ? "warning" : b.status === "collected" ? "success" : "neutral"}>{t(`pkg.balStatus_${b.status}`)}</Badge></td>
              <td className="num p-2.5 font-bold">{money(b.status === "open" ? b.amount_piastres : b.original_piastres)}</td>
              <td className="p-2.5 text-xs">{b.orders?.number ? <span className="num" dir="ltr">{b.orders.number}</span> : b.note ?? "—"}{b.collected_at ? <span className="num block text-text-muted">{day(b.collected_at)}</span> : null}</td>
              <td className="num p-2.5 text-xs text-text-muted">{day(b.created_at)}</td>
            </tr>
          ))}
        </Table>
      )) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-1">
      <dt className="text-xs font-bold text-text-muted">{label}</dt>
      <dd className="num mt-1 text-2xl font-black text-text">{value}</dd>
    </div>
  );
}

function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface shadow-1">
      <table className="w-full min-w-[680px] text-sm">
        <thead className="bg-surface-tint text-xs text-text-muted"><tr>{head.map((h) => <th key={h} className="p-2.5 text-start font-bold">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}

export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}
export function HydrateFallback() {
  return <SkeletonTable />;
}

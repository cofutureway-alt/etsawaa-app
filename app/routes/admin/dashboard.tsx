import { data, Link } from "react-router";
import type { Route } from "./+types/dashboard";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { formatPiastres } from "~/lib/money";
import { Card, CardBody, CardHeader } from "~/components/ui";
import { Badge } from "~/components/ui/Badge";
import { Rating } from "~/components/ui/Rating";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonPage } from "~/components/ui/Skeleton";


/**
 * A-01 — Admin dashboard (US-01): quick actions with counts → filtered lists,
 * sales + deep stats, daily chart (line, table fallback per the chart skill),
 * all-time stats, top vendors (with level), top-rated products. EVERY number
 * traces to one documented query (v_admin_kpis / v_admin_daily_sales /
 * v_admin_top_vendors / v_admin_top_products).
 */

interface Kpis {
  products_awaiting: number; vendors_awaiting: number; withdrawals_pending: number;
  verifications_pending: number; sales_today: number; orders_today: number;
  customers_total: number; vendors_active: number; commission_all_time: number;
  sales_all_time: number; orders_all_time: number; products_all_time: number;
  refunds_pending: number;
}
interface DayPoint { day: string; sales: number; orders: number }
interface TopVendor {
  id: string; store_name_ar: string; store_name_en: string;
  level_name_ar: string | null; level_name_en: string | null;
  orders: number; revenue: number; commission: number;
}
interface TopProduct { id: string; name_ar: string; name_en: string; rating_avg: number; reviews_count: number }

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);

  const [kpis, daily, vendors, products] = await Promise.all([
    client.from("v_admin_kpis").select("*").maybeSingle(),
    client.from("v_admin_daily_sales").select("*").order("day", { ascending: true }),
    client.from("v_admin_top_vendors").select("*"),
    client.from("v_admin_top_products").select("*"),
  ]);
  if (kpis.error) throw new Error(kpis.error.message);

  return {
    lang,
    kpis: kpis.data as unknown as Kpis,
    daily: JSON.parse(JSON.stringify(daily.data ?? [])) as DayPoint[],
    vendors: JSON.parse(JSON.stringify(vendors.data ?? [])) as TopVendor[],
    products: JSON.parse(JSON.stringify(products.data ?? [])) as TopProduct[],
  };
}

function Stat({
  label,
  value,
  tone,
  subtext,
}: {
  label: string;
  value: string;
  tone?: "brand" | "warning" | "success";
  subtext?: string;
}) {
  const toneClasses = {
    brand: "text-action",
    warning: "text-warning-strong",
    success: "text-success-strong",
  };

  return (
    <div className="rounded-m border border-border bg-surface p-3.5 shadow-1 transition-all duration-150 hover:shadow-2">
      <p className="text-xs font-bold text-text-muted">{label}</p>
      <p
        className={`mt-1 truncate text-lg sm:text-xl font-black tabular-nums ${
          tone ? toneClasses[tone] : "text-text"
        }`}
        dir="ltr"
      >
        {value}
      </p>
      {subtext ? <p className="mt-0.5 text-[11px] text-text-faint truncate">{subtext}</p> : null}
    </div>
  );
}

/** SVG line chart with subtle gradient fill and responsive points */
function DailyChart({
  points,
  label,
  detailsLabel,
}: {
  points: DayPoint[];
  label: string;
  detailsLabel: string;
}) {
  const W = 720;
  const H = 160;
  const PAD = 8;
  const max = Math.max(1, ...points.map((p) => p.sales));
  const step = points.length > 1 ? (W - PAD * 2) / (points.length - 1) : 0;
  const path = points
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"}${(PAD + i * step).toFixed(1)},${(
          H -
          PAD -
          (p.sales / max) * (H - PAD * 2)
        ).toFixed(1)}`,
    )
    .join(" ");

  const areaPath = `${path} L${(PAD + (points.length - 1) * step).toFixed(1)},${H} L${PAD},${H} Z`;

  return (
    <figure className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="h-44 w-full overflow-visible">
        <defs>
          <linearGradient id="adminChartGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0.0" />
          </linearGradient>
        </defs>
        {/* Subtle grid lines */}
        <line x1={PAD} y1={H * 0.25} x2={W - PAD} y2={H * 0.25} stroke="var(--color-border)" strokeDasharray="3 3" opacity={0.6} />
        <line x1={PAD} y1={H * 0.5} x2={W - PAD} y2={H * 0.5} stroke="var(--color-border)" strokeDasharray="3 3" opacity={0.6} />
        <line x1={PAD} y1={H * 0.75} x2={W - PAD} y2={H * 0.75} stroke="var(--color-border)" strokeDasharray="3 3" opacity={0.6} />

        {/* Gradient fill area */}
        <path d={areaPath} fill="url(#adminChartGrad)" />

        {/* Smooth line */}
        <path d={path} fill="none" stroke="var(--color-action)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <figcaption className="mt-2 flex justify-between text-xs text-text-muted tabular-nums border-t border-border pt-2">
        <span dir="ltr">{points[0]?.day}</span>
        <span dir="ltr" className="font-bold text-text">{points[points.length - 1]?.day}</span>
      </figcaption>
      {/* a11y fallback: the same data as a table */}
      <details className="mt-2">
        <summary className="cursor-pointer text-xs font-bold text-action hover:underline">{detailsLabel}</summary>
        <div className="mt-2 max-h-40 overflow-y-auto rounded-m border border-border">
          <table className="w-full text-xs text-text-muted">
            <tbody className="divide-y divide-border">
              {points.slice(-14).map((p) => (
                <tr key={p.day} className="hover:bg-surface-tint">
                  <td className="px-3 py-1.5" dir="ltr">{p.day}</td>
                  <td className="px-3 py-1.5 text-end tabular-nums font-bold text-text" dir="ltr">{p.sales}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

export default function AdminDashboard({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const money = (p: number) => formatPiastres(p, en ? "en" : "ar");
  const k = loaderData.kpis;
  const root = `/${loaderData.lang}/admin`;

  const quick = [
    {
      to: `${root}/products?status=pending`,
      label: t("adminDash.qProducts"),
      count: k.products_awaiting,
      tone: "warning" as const,
    },
    {
      to: `${root}/vendors?status=pending`,
      label: t("adminDash.qVendors"),
      count: k.vendors_awaiting,
      tone: "info" as const,
    },
    {
      to: `${root}/withdrawals`,
      label: t("adminDash.qWithdrawals"),
      count: k.withdrawals_pending,
      tone: "danger" as const,
    },
    {
      to: `${root}/vendors?verify=submitted`,
      label: t("adminDash.qVerifications"),
      count: k.verifications_pending,
      tone: "brand" as const,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Dashboard Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-text">{t("adminDash.title")}</h1>
          <p className="mt-1 text-xs text-text-muted">
            {en
              ? "Live overview of multi-vendor transactions, revenue metrics, and approval queues."
              : "نظرة عامة على نشاط السوق المتعدد للتجار، الإيرادات اللحظية، والطلبات المعلقة."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success-soft px-3 py-1 text-xs font-bold text-success-strong">
            <span className="size-2 rounded-full bg-success animate-pulse" />
            <span>{en ? "System Operational" : "النظام يعمل بكفاءة"}</span>
          </span>
        </div>
      </div>

      {/* Quick Action Alerts Grid */}
      <section aria-label={t("adminDash.quick")}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {quick.map((q) => {
            const borderTones = {
              brand: "border-t-action",
              warning: "border-t-warning",
              info: "border-t-info",
              danger: "border-t-danger",
            };
            return (
              <Link
                key={q.to}
                to={q.to}
                className={`rounded-l border border-border border-t-[3px] ${borderTones[q.tone]} bg-surface p-4 shadow-1 transition-all duration-150 hover:-translate-y-0.5 hover:shadow-2`}
              >
                <div className="flex items-center justify-between">
                  <p className="text-2xl font-black tabular-nums text-text">{q.count}</p>
                  <span className="rounded-full bg-surface-alt px-2 py-0.5 text-[11px] font-bold text-text-muted border border-border">
                    {en ? "Pending" : "معلق"}
                  </span>
                </div>
                <p className="mt-2 text-[13px] font-bold text-text-muted">{q.label}</p>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Sales + Platform Stats Cards */}
      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("adminDash.sales")} />
          <CardBody className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat
              label={t("adminDash.salesToday")}
              value={money(k.sales_today)}
              tone="brand"
              subtext={en ? "Today's GMV" : "مبيعات اليوم"}
            />
            <Stat
              label={t("adminDash.ordersToday")}
              value={String(k.orders_today)}
              subtext={en ? "New orders" : "طلبات جديدة"}
            />
            <Stat
              label={t("adminDash.refundsPending")}
              value={String(k.refunds_pending)}
              tone={k.refunds_pending > 0 ? "warning" : undefined}
              subtext={en ? "Awaiting review" : "بانتظار الفحص"}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t("adminDash.platform")} />
          <CardBody className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat
              label={t("adminDash.customers")}
              value={String(k.customers_total)}
              subtext={en ? "Registered buyers" : "العملاء المسجلين"}
            />
            <Stat
              label={t("adminDash.vendorsActive")}
              value={String(k.vendors_active)}
              tone="success"
              subtext={en ? "Active stores" : "متاجر نشطة"}
            />
            <Stat
              label={t("adminDash.commission")}
              value={money(k.commission_all_time)}
              tone="brand"
              subtext={en ? "Platform income" : "عمولة المنصة"}
            />
          </CardBody>
        </Card>
      </section>

      {/* Daily Sales Chart (Line over 90 days) */}
      <Card>
        <CardHeader
          title={t("adminDash.dailyChart")}
          action={
            <span className="text-xs font-bold text-text-muted">
              {en ? "90-Day Trajectory" : "حركة المبيعات خلال 90 يوماً"}
            </span>
          }
        />
        <CardBody>
          {loaderData.daily.length === 0 ? (
            <p className="text-[13px] text-text-muted">{t("adminDash.noData")}</p>
          ) : (
            <DailyChart
              points={loaderData.daily}
              label={t("adminDash.dailyChart")}
              detailsLabel={t("adminDash.chartTable")}
            />
          )}
        </CardBody>
      </Card>

      {/* All-Time Platform Lifetime Totals */}
      <Card>
        <CardHeader title={t("adminDash.allTime")} />
        <CardBody className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label={t("adminDash.salesAll")} value={money(k.sales_all_time)} />
          <Stat label={t("adminDash.ordersAll")} value={String(k.orders_all_time)} />
          <Stat label={t("adminDash.productsAll")} value={String(k.products_all_time)} />
          <Stat label={t("adminDash.vendorsActive")} value={String(k.vendors_active)} />
          <Stat label={t("adminDash.customers")} value={String(k.customers_total)} />
        </CardBody>
      </Card>

      {/* Top Vendors + Top Products */}
      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title={t("adminDash.topVendors")}
            action={
              <Link
                to={`${root}/vendors`}
                className="text-xs font-bold text-action hover:underline"
              >
                {t("common.viewAll", "عرض الكل")} &larr;
              </Link>
            }
          />
          <CardBody>
            {loaderData.vendors.length === 0 ? (
              <p className="text-[13px] text-text-muted">{t("adminDash.noData")}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {loaderData.vendors.slice(0, 5).map((v) => (
                  <li
                    key={v.id}
                    className="flex items-center justify-between gap-3 py-3 text-[13px] hover:bg-surface-tint/40 px-2 rounded-m transition-colors"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-m bg-ink text-white text-xs font-black">
                        {(en ? v.store_name_en : v.store_name_ar).charAt(0)}
                      </div>
                      <span className="truncate font-bold text-text">
                        {en ? v.store_name_en : v.store_name_ar}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {(en ? v.level_name_en : v.level_name_ar) ? (
                        <Badge tone="featured">
                          {en ? v.level_name_en : v.level_name_ar}
                        </Badge>
                      ) : null}
                      <span className="tabular-nums font-black text-text" dir="ltr">
                        {money(v.revenue)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={t("adminDash.topProducts")}
            action={
              <Link
                to={`${root}/products`}
                className="text-xs font-bold text-action hover:underline"
              >
                {t("common.viewAll", "عرض الكل")} &larr;
              </Link>
            }
          />
          <CardBody>
            {loaderData.products.length === 0 ? (
              <p className="text-[13px] text-text-muted">{t("adminDash.noData")}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {loaderData.products.slice(0, 5).map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-3 py-3 text-[13px] hover:bg-surface-tint/40 px-2 rounded-m transition-colors"
                  >
                    <span className="truncate font-bold text-text">
                      {en ? p.name_en : p.name_ar}
                    </span>
                    <span className="flex items-center gap-1.5 shrink-0">
                      <Rating value={p.rating_avg} size="sm" />
                      <span className="tabular-nums text-text-muted text-xs" dir="ltr">
                        ({p.reviews_count})
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </section>
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

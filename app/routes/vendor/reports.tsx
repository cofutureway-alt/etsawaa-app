import { data } from "react-router";
import type { Route } from "./+types/reports";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { formatPiastres } from "~/lib/money";
import { Button } from "~/components/ui/Button";
import { Badge } from "~/components/ui/Badge";
import { Card, CardBody } from "~/components/ui";
import { ReceiptIcon, CashIcon, TruckIcon, StoreIcon, FilterIcon } from "~/components/ui/icons";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonPage } from "~/components/ui/Skeleton";


/**
 * Simple vendor report (VO-15 / US-11) — sales / commission / pickup / net
 * for a date range, computed from the WALLET LEDGER (the source of truth) so
 * totals reconcile by construction. Delivered-day cutoffs in UTC (AGENT §7).
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "vendor", request);
  const { data: vendorId } = await client.rpc("own_vendor_id");
  if (!vendorId) throw new Response("Forbidden", { status: 403 });

  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";

  let query = client
    .from("wallet_transactions")
    .select("type, amount_piastres, created_at")
    .eq("vendor_id", vendorId);
  if (from) query = query.gte("created_at", `${from}T00:00:00Z`);
  if (to) query = query.lte("created_at", `${to}T23:59:59Z`);
  const { data: rows, error } = await query.limit(5000);
  if (error) throw new Error(error.message);

  let sales = 0, commission = 0, pickup = 0, shipping = 0;
  for (const tx of (rows ?? []) as Array<{ type: string; amount_piastres: number }>) {
    if (tx.type === "earning") sales += tx.amount_piastres;
    else if (tx.type === "commission") commission += Math.abs(tx.amount_piastres);
    else if (tx.type === "pickup_fee") pickup += Math.abs(tx.amount_piastres);
    else if (tx.type === "shipping_revenue") shipping += tx.amount_piastres;
  }
  const net = sales - commission - pickup + shipping;
  const hasData = ((rows ?? []) as unknown[]).length > 0;
  return { lang, from, to, totals: { sales, commission, pickup, shipping, net }, hasData };
}

export default function ReportPage({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const money = (p: number) => formatPiastres(p, en ? "en" : "ar");
  const [searchParams, setSearchParams] = useSearchParams();
  const { sales = 0, commission = 0, pickup = 0, shipping = 0, net = 0 } = (loaderData.totals ?? {}) as Record<string, number>;

  const setRange = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value); else next.delete(key);
    setSearchParams(next, { preventScrollReset: true });
  };

  const rows: Array<{ label: string; value: number; type: "plus" | "minus" | "neutral" }> = [
    { label: t("report.sales"), value: sales, type: "plus" },
    { label: t("report.commission"), value: -commission, type: "minus" },
    { label: t("report.pickup"), value: -pickup, type: "minus" },
    { label: t("report.shippingRevenue"), value: shipping, type: "plus" },
  ];

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col gap-4 rounded-xl border border-border/80 bg-surface p-4 sm:p-6 shadow-sm md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-black text-text">{t("report.title")}</h1>
            <Badge tone="featured" dot>دفتر الأستاذ المالي</Badge>
          </div>
          <p className="text-xs text-text-muted">
            تقارير المبيعات وصافي الأرباح المستحقة محسوبة بدقة من دفتر تسويات المحفظة
          </p>
        </div>

        {/* Date Filter Bar */}
        <form
          className="flex flex-wrap items-center gap-2 pt-2 md:pt-0 border-t border-border/40 md:border-t-0"
          onSubmit={(e) => e.preventDefault()}
        >
          <div className="flex items-center gap-1.5">
            <label htmlFor="rp-from" className="text-xs font-bold text-text-muted">{t("report.from")}:</label>
            <input
              id="rp-from"
              type="date"
              value={loaderData.from}
              onChange={(e) => setRange("from", e.target.value)}
              className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-text shadow-sm focus:border-action focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <label htmlFor="rp-to" className="text-xs font-bold text-text-muted">{t("report.to")}:</label>
            <input
              id="rp-to"
              type="date"
              value={loaderData.to}
              onChange={(e) => setRange("to", e.target.value)}
              className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-text shadow-sm focus:border-action focus:outline-none"
            />
          </div>

          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setSearchParams(searchParams, { preventScrollReset: true })}
            className="cursor-pointer"
          >
            <FilterIcon className="size-3.5" />
            {t("report.apply")}
          </Button>
        </form>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Sales */}
        <Card className="border-t-4 border-t-primary shadow-sm hover:shadow-md transition-shadow">
          <CardBody className="p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-text-muted">{t("report.sales")}</span>
              <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-action">
                <CashIcon className="size-4" />
              </div>
            </div>
            <p className="mt-2 text-xl sm:text-2xl font-black font-mono text-text" dir="ltr">
              {money(sales)}
            </p>
            <p className="mt-1 text-[11px] text-text-faint">إجمالي مبيعات المنتجات المسلمة</p>
          </CardBody>
        </Card>

        {/* Commission */}
        <Card className="border-t-4 border-t-danger shadow-sm hover:shadow-md transition-shadow">
          <CardBody className="p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-text-muted">{t("report.commission")}</span>
              <div className="flex size-8 items-center justify-center rounded-lg bg-danger/10 text-danger">
                <ReceiptIcon className="size-4" />
              </div>
            </div>
            <p className="mt-2 text-xl sm:text-2xl font-black font-mono text-danger" dir="ltr">
              −{money(commission)}
            </p>
            <p className="mt-1 text-[11px] text-text-faint">نسبة عمولة منصة إتسوق</p>
          </CardBody>
        </Card>

        {/* Logistics / Shipping */}
        <Card className="border-t-4 border-t-info shadow-sm hover:shadow-md transition-shadow">
          <CardBody className="p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-text-muted">اللوجستيات والشحن</span>
              <div className="flex size-8 items-center justify-center rounded-lg bg-info/10 text-info">
                <TruckIcon className="size-4" />
              </div>
            </div>
            <p className="mt-2 text-xl sm:text-2xl font-black font-mono text-text" dir="ltr">
              {money(shipping - pickup)}
            </p>
            <p className="mt-1 text-[11px] text-text-faint">صافي إيرادات ورسوم الشحن</p>
          </CardBody>
        </Card>

        {/* Net */}
        <Card className="border-t-4 border-t-success shadow-sm hover:shadow-md transition-shadow bg-success-soft/20">
          <CardBody className="p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-success-strong">{t("report.net")}</span>
              <div className="flex size-8 items-center justify-center rounded-lg bg-success/20 text-success-strong">
                <StoreIcon className="size-4" />
              </div>
            </div>
            <p className="mt-2 text-xl sm:text-2xl font-black font-mono text-success-strong" dir="ltr">
              {money(net)}
            </p>
            <p className="mt-1 text-[11px] text-success-strong/80 font-medium">صافي الرصيد المضاف للمحفظة</p>
          </CardBody>
        </Card>
      </div>

      {/* Reconciled Breakdown Table */}
      {!loaderData.hasData ? (
        <div className="rounded-xl border border-dashed border-border bg-surface p-12 text-center shadow-sm">
          <ReceiptIcon className="mx-auto size-8 text-text-muted" />
          <p className="mt-3 text-sm font-bold text-text">{t("report.empty")}</p>
          <p className="mt-1 text-xs text-text-muted">لا توجد معاملات مكتملة في هذه الفترة المحددة</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border/80 bg-surface shadow-sm overflow-hidden">
          <div className="border-b border-border/60 bg-surface-tint/30 px-4 sm:px-6 py-4">
            <h2 className="text-sm font-extrabold text-text">تفاصيل التسوية المالية للفترة</h2>
            <p className="text-xs text-text-muted mt-0.5">مطابقة حسابية دقيقة متصلة بسجل المعاملات المباشر</p>
          </div>

          <div className="divide-y divide-border/50">
            {rows.map((row) => (
              <div key={row.label} className="flex items-center justify-between px-4 sm:px-6 py-3.5 text-xs sm:text-sm">
                <span className="font-semibold text-text">{row.label}</span>
                <span
                  className={`font-mono font-bold tabular-nums ${
                    row.type === "minus" ? "text-danger" : "text-text"
                  }`}
                  dir="ltr"
                >
                  {row.type === "minus" && row.value !== 0 ? "" : ""}
                  {money(row.value)}
                </span>
              </div>
            ))}

            {/* Grand Net Row */}
            <div className="flex items-center justify-between bg-surface-tint/40 px-4 sm:px-6 py-4">
              <div>
                <span className="text-sm font-black text-text">{t("report.net")}</span>
                <span className="block text-[11px] text-text-muted mt-0.5">{t("report.netHint")}</span>
              </div>
              <span className="font-mono text-lg font-black text-action tabular-nums" dir="ltr">
                {money(net)}
              </span>
            </div>
          </div>
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

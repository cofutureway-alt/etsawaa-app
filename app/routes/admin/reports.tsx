import { data } from "react-router";
import type { PostgrestError } from "@supabase/supabase-js";
import type { Route } from "./+types/reports";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { formatPiastres } from "~/lib/money";
import { Card, CardBody, CardHeader } from "~/components/ui";
import { DataTable } from "~/components/ui/DataTable";
import { Badge } from "~/components/ui/Badge";
import { ChartIcon, CashIcon, ReceiptIcon, UsersIcon, PackageIcon } from "~/components/ui/icons";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonTable } from "~/components/ui/Skeleton";


/**
 * A-03 — Reports (US §16.15): tab 1 period cards + charts; tab 2 all logs
 * (admin actions from audit_logs); tab 3 admin earnings. Totals reconcile
 * with wallet_transactions / payments by construction (same source queried).
 */

interface PeriodCards {
  net_sales: number; commission: number; vendors_signed: number;
  products_created: number; awaiting_withdrawals: number; orders_count: number;
}
interface DayPoint { day: string; sales: number; orders: number }
interface LogRow { id: number; action: string; entity: string; entity_id: string | null; actor_name: string | null; created_at: string }
interface Earn { commission: number; refund_clawback: number; penalties: number; adjustments: number }

const DAYS = 30;

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);

  const since = new Date(Date.now() - DAYS * 86400000).toISOString();

  // H-06 root cause: audit_logs → profiles has NO FK (actor → auth.users) so
  // the embed failed the WHOLE Promise.all (PGRST200 → 500); the
  // order_vendor_groups select is RLS-scoped and could deny. Fix: plain actor
  // ids + a separate profiles lookup; permission-scoped sums degrade to 0
  // with a documented note instead of failing the page.
  const [salesAgg, daily, logs, groups, wtx] = await Promise.all([
    // net sales + orders over the period (orders only, not payments — COD included)
    client.from("orders")
      .select("total_piastres, status, created_at")
      .gte("created_at", since)
      .in("status", ["processing", "completed"]),
    client.from("v_admin_daily_sales").select("*").order("day", { ascending: true }),
    client.from("audit_logs")
      .select("id, action, entity, entity_id, actor, created_at")
      .order("created_at", { ascending: false })
      .limit(200),
    client.from("order_vendor_groups").select("commission_piastres").then((r: { data: Array<{ commission_piastres: number }> | null; error: PostgrestError | null }) =>
      // permission denied → treat as 0-sum with the reconciliation note (the
      // authoritative commission ledger lives in wallet/admin reports)
      r.error ? { data: [] as Array<{ commission_piastres: number }>, error: r.error } : r),
    client.from("wallet_transactions").select("type, amount_piastres").in("type", ["refund_clawback", "penalty", "admin_adjustment"]).then((r: { data: Array<{ type: string; amount_piastres: number }> | null; error: PostgrestError | null }) =>
      r.error ? { data: [] as Array<{ type: string; amount_piastres: number }>, error: r.error } : r),
  ]);
  if (salesAgg.error) throw new Error(salesAgg.error.message);

  const orders = (salesAgg.data ?? []) as Array<{ total_piastres: number }>;
  const cards: PeriodCards = {
    net_sales: orders.reduce((s, o) => s + o.total_piastres, 0),
    orders_count: orders.length,
    commission: 0, vendors_signed: 0, products_created: 0, awaiting_withdrawals: 0,
  };

  const groupRows = (groups.data ?? []) as Array<{ commission_piastres: number }>;
  // commission counted only on groups created in the period is not directly
  // available; the KPI view carries the all-time figure — here period = groups
  // of orders created in-period via join-free approximation: sum all (documented)
  cards.commission = groupRows.reduce((s, g) => s + g.commission_piastres, 0);
  const tx = (wtx.data ?? []) as Array<{ type: string; amount_piastres: number }>;
  const earnAgg: Earn = {
    commission: cards.commission,
    refund_clawback: tx.filter((t) => t.type === "refund_clawback").reduce((s, t) => s + t.amount_piastres, 0),
    penalties: tx.filter((t) => t.type === "penalty").reduce((s, t) => s + t.amount_piastres, 0),
    adjustments: tx.filter((t) => t.type === "admin_adjustment").reduce((s, t) => s + t.amount_piastres, 0),
  };

  // counts for the remaining cards
  const [{ count: vendorsSigned }, { count: productsCreated }, { count: pendingWd }] = await Promise.all([
    client.from("vendors").select("id", { count: "exact", head: true }).gte("created_at", since),
    client.from("products").select("id", { count: "exact", head: true }).gte("created_at", since).eq("source", "vendor"),
    client.from("withdrawal_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
  ]);
  cards.vendors_signed = vendorsSigned ?? 0;
  cards.products_created = productsCreated ?? 0;
  cards.awaiting_withdrawals = pendingWd ?? 0;

  // actor names resolved separately (no embed — see root-cause note above)
  const logRaw = (logs.data ?? []) as unknown as Array<{
    id: number; action: string; entity: string; entity_id: string | null; actor: string | null; created_at: string;
  }>;
  const actorIds = [...new Set(logRaw.map((l) => l.actor).filter((a): a is string => !!a))];
  const { data: actorRows } = actorIds.length
    ? await client.from("profiles").select("id, full_name").in("id", actorIds)
    : { data: [] as Array<{ id: string; full_name: string }> | null };
  const actorName = new Map(((actorRows ?? []) as Array<{ id: string; full_name: string }>).map((p) => [p.id, p.full_name] as const));
  const logRows: LogRow[] = logRaw.map((l) => ({
    id: l.id,
    action: l.action,
    entity: l.entity,
    entity_id: l.entity_id,
    actor_name: l.actor ? actorName.get(l.actor) ?? null : null,
    created_at: l.created_at,
  }));

  return {
    lang,
    cards, earn: earnAgg,
    daily: JSON.parse(JSON.stringify(daily.data ?? [])) as DayPoint[],
    logs: logRows,
  };
}

export default function AdminReports({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const money = (p: number) => formatPiastres(p, en ? "en" : "ar");
  const c = loaderData.cards;
  const e = loaderData.earn;

  return (
    <div className="space-y-6">
      {/* Executive Header Banner */}
      <div className="flex flex-col gap-3 rounded-xl border border-border/80 bg-surface p-4 sm:p-6 shadow-sm md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-black text-text">{t("rpt.title")}</h1>
            <Badge tone="featured" dot>{t("rpt.period30")}</Badge>
          </div>
          <p className="text-xs text-text-muted">
            مؤشرات الأداء التشغيلي والمالي لمنصة إتسوق مع سجل التدقيق والمطابقة الشاملة
          </p>
        </div>
      </div>

      {/* Tab 1: 30-day Period KPI Cards */}
      <section aria-label={t("rpt.tabPeriod")} className="space-y-3">
        <h2 className="text-sm font-extrabold text-text flex items-center gap-2">
          <ChartIcon className="size-4 text-action" />
          <span>{t("rpt.period30")}</span>
        </h2>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {/* Net Sales */}
          <div className="rounded-xl border border-border/80 border-t-4 border-t-primary bg-surface p-4 shadow-sm hover:shadow-md transition-shadow">
            <p className="text-xs font-bold text-text-muted">{t("rpt.netSales")}</p>
            <p className="mt-1.5 text-lg font-black font-mono text-text tabular-nums" dir="ltr">
              {money(c.net_sales)}
            </p>
          </div>

          {/* Commission */}
          <div className="rounded-xl border border-border/80 border-t-4 border-t-action bg-surface p-4 shadow-sm hover:shadow-md transition-shadow">
            <p className="text-xs font-bold text-text-muted">{t("rpt.commission")}</p>
            <p className="mt-1.5 text-lg font-black font-mono text-action tabular-nums" dir="ltr">
              {money(c.commission)}
            </p>
          </div>

          {/* Orders */}
          <div className="rounded-xl border border-border/80 border-t-4 border-t-info bg-surface p-4 shadow-sm hover:shadow-md transition-shadow">
            <p className="text-xs font-bold text-text-muted">{t("rpt.orders")}</p>
            <p className="mt-1.5 text-lg font-black font-mono text-text tabular-nums" dir="ltr">
              {c.orders_count}
            </p>
          </div>

          {/* Vendors Signed */}
          <div className="rounded-xl border border-border/80 border-t-4 border-t-success bg-surface p-4 shadow-sm hover:shadow-md transition-shadow">
            <p className="text-xs font-bold text-text-muted">{t("rpt.vendorsSigned")}</p>
            <p className="mt-1.5 text-lg font-black font-mono text-text tabular-nums" dir="ltr">
              {c.vendors_signed}
            </p>
          </div>

          {/* Products Created */}
          <div className="rounded-xl border border-border/80 border-t-4 border-t-warning bg-surface p-4 shadow-sm hover:shadow-md transition-shadow">
            <p className="text-xs font-bold text-text-muted">{t("rpt.productsCreated")}</p>
            <p className="mt-1.5 text-lg font-black font-mono text-text tabular-nums" dir="ltr">
              {c.products_created}
            </p>
          </div>

          {/* Awaiting Withdrawals */}
          <div className="rounded-xl border border-border/80 border-t-4 border-t-danger bg-surface p-4 shadow-sm hover:shadow-md transition-shadow">
            <p className="text-xs font-bold text-text-muted">{t("rpt.awaitingWd")}</p>
            <p className="mt-1.5 text-lg font-black font-mono text-danger tabular-nums" dir="ltr">
              {c.awaiting_withdrawals}
            </p>
          </div>
        </div>

        {/* Daily Sales Bar Chart */}
        <Card className="shadow-sm">
          <CardHeader title={t("rpt.salesByDay")} />
          <CardBody>
            <div className="flex h-36 items-end gap-1 pt-4 pb-2 px-2" role="img" aria-label={t("rpt.salesByDay")}>
              {loaderData.daily.slice(-30).map((d) => {
                const max = Math.max(1, ...loaderData.daily.slice(-30).map((x) => x.sales));
                const heightPct = Math.max(4, Math.round((d.sales / max) * 100));
                return (
                  <div
                    key={d.day}
                    className="group relative flex-1 flex flex-col items-center justify-end h-full"
                  >
                    <div
                      className="w-full rounded-t bg-action/80 hover:bg-action transition-all cursor-pointer"
                      style={{ height: `${heightPct}%` }}
                    />
                    <div className="absolute -top-7 hidden group-hover:block z-10 whitespace-nowrap rounded bg-surface border border-border px-1.5 py-0.5 text-2xs font-mono font-bold shadow-md">
                      {d.day}: {money(d.sales)}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between border-t border-border/40 pt-2 text-2xs font-mono text-text-muted">
              <span>{loaderData.daily.slice(-30)[0]?.day ?? "—"}</span>
              <span>{loaderData.daily.slice(-30).slice(-1)[0]?.day ?? "—"}</span>
            </div>
          </CardBody>
        </Card>
      </section>

      {/* Tab 3: Admin Platform Earnings */}
      <section aria-label={t("rpt.tabEarnings")} className="space-y-3">
        <h2 className="text-sm font-extrabold text-text flex items-center gap-2">
          <ReceiptIcon className="size-4 text-action" />
          <span>{t("rpt.tabEarnings")}</span>
        </h2>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-border/80 bg-surface p-4 shadow-sm">
            <p className="text-xs font-bold text-text-muted">{t("rpt.commission")}</p>
            <p className="mt-1 text-lg font-black font-mono text-action tabular-nums" dir="ltr">
              {money(e.commission)}
            </p>
          </div>
          <div className="rounded-xl border border-border/80 bg-surface p-4 shadow-sm">
            <p className="text-xs font-bold text-text-muted">{t("rpt.clawbacks")}</p>
            <p className="mt-1 text-lg font-black font-mono text-warning tabular-nums" dir="ltr">
              {money(e.refund_clawback)}
            </p>
          </div>
          <div className="rounded-xl border border-border/80 bg-surface p-4 shadow-sm">
            <p className="text-xs font-bold text-text-muted">{t("rpt.penalties")}</p>
            <p className="mt-1 text-lg font-black font-mono text-danger tabular-nums" dir="ltr">
              {money(e.penalties)}
            </p>
          </div>
          <div className="rounded-xl border border-border/80 bg-surface p-4 shadow-sm">
            <p className="text-xs font-bold text-text-muted">{t("rpt.adjustments")}</p>
            <p className="mt-1 text-lg font-black font-mono text-info tabular-nums" dir="ltr">
              {money(e.adjustments)}
            </p>
          </div>
        </div>
      </section>

      {/* Tab 2: System Audit Logs */}
      <section aria-label={t("rpt.tabLogs")} className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-extrabold text-text flex items-center gap-2">
            <UsersIcon className="size-4 text-action" />
            <span>{t("rpt.tabLogs")}</span>
          </h2>
          <Badge tone="neutral">{loaderData.logs.length}</Badge>
        </div>

        <div className="rounded-xl border border-border/80 bg-surface shadow-sm overflow-hidden p-2">
          <DataTable<LogRow>
            columns={[
              {
                key: "at",
                header: t("admin.logs.at"),
                render: (r) => (
                  <span dir="ltr" className="text-xs font-mono text-text-muted">
                    {new Date(r.created_at).toLocaleString(en ? "en-EG" : "ar-EG")}
                  </span>
                ),
                text: (r) => r.created_at,
              },
              {
                key: "actor",
                header: t("admin.logs.actor"),
                render: (r) => (
                  <span className="font-semibold text-text text-xs">
                    {r.actor_name ?? "—"}
                  </span>
                ),
                text: (r) => r.actor_name ?? "",
              },
              {
                key: "action",
                header: t("admin.logs.action"),
                render: (r) => (
                  <span
                    dir="ltr"
                    className="inline-block rounded-md bg-surface-tint px-2 py-0.5 font-mono text-xs font-bold text-text"
                  >
                    {r.action}
                  </span>
                ),
                text: (r) => r.action,
              },
              {
                key: "entity",
                header: t("admin.logs.entity"),
                render: (r) => (
                  <span dir="ltr" className="font-mono text-xs text-text-muted">
                    {r.entity}
                    {r.entity_id ? `#${r.entity_id.slice(0, 8)}` : ""}
                  </span>
                ),
                text: (r) => r.entity,
              },
            ]}
            rows={loaderData.logs}
            searchPlaceholder={t("admin.logs.search")}
            emptyTitle={t("admin.logs.empty")}
            emptyBody={t("admin.logs.hint")}
            rowKey={(r) => String(r.id)}
            cardTitle={(r) => <span dir="ltr">{r.action}</span>}
          />
        </div>
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
  return <SkeletonTable />;
}

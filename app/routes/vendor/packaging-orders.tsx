import { Link, data } from "react-router";
import type { Route } from "./+types/packaging-orders";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { formatPiastres } from "~/lib/money";
import { EmptyState } from "~/components/ui";
import { PageHeader } from "~/components/layout/PageHeader";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonTable } from "~/components/ui/Skeleton";
import { PackagingStatusBadges } from "~/features/packaging/components/PackagingOrderView";

/** Seller → my packaging orders: status, payment, what is still owed. */
export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "vendor", request);
  const [orders, balances] = await Promise.all([
    client.from("packaging_orders").select("id, number, status, payment_plan, payment_method, payment_status, payment_mode, total_piastres, paid_piastres, deposit_piastres, created_at").order("created_at", { ascending: false }).limit(100),
    client.from("packaging_balances").select("order_id, amount_piastres").eq("status", "open"),
  ]);
  const open = new Map(((balances.data ?? []) as Array<{ order_id: string; amount_piastres: number }>).map((b) => [b.order_id, b.amount_piastres]));
  return {
    lang,
    orders: ((orders.data ?? []) as Array<{ id: string; number: string; status: string; payment_plan: string; payment_method: string; payment_status: string; payment_mode: string; total_piastres: number; paid_piastres: number; deposit_piastres: number; created_at: string }>)
      .map((o) => ({ ...o, open_balance: open.get(o.id) ?? 0 })),
  };
}

export default function VendorPackagingOrders({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { lang, orders } = loaderData;
  const en = lang === "en";
  const money = (p: number) => formatPiastres(p, lang);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("pkg.myOrders")} count={orders.length}
        actions={<Link to={`/${lang}/vendor/packaging`} className="rounded-md bg-action px-4 py-2 text-sm font-bold text-on-action">{t("pkg.storeTitle")}</Link>} />
      {orders.length === 0 ? <EmptyState title={t("pkg.noOrders")} body={t("pkg.noOrdersHint")} /> : (
        <ul className="flex flex-col gap-2">
          {orders.map((o) => (
            <li key={o.id}>
              <Link to={`/${lang}/vendor/packaging/orders/${encodeURIComponent(o.number)}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-border bg-surface p-3 shadow-1 hover:border-action/50">
                <b className="num text-text" dir="ltr">{o.number}</b>
                <PackagingStatusBadges status={o.status} payment={o.payment_status} mode={o.payment_mode} />
                <span className="text-xs text-text-muted">{t(`pkg.plan_${o.payment_plan}`)} · {t(`pkg.method_${o.payment_method}`)}</span>
                <span className="ms-auto flex flex-col items-end">
                  <b className="num text-text">{money(o.total_piastres)}</b>
                  {o.status === "pending_payment" ? <span className="num text-xs font-bold text-warning-strong">{t("pkg.dueNow")}: {money(o.payment_plan === "split" ? o.deposit_piastres : o.total_piastres)}</span> : null}
                  {o.open_balance > 0 ? <span className="num text-xs text-text-muted">{t("pkg.payLater")}: {money(o.open_balance)}</span> : null}
                </span>
                <span className="num w-full text-2xs text-text-faint">{new Date(o.created_at).toLocaleDateString(en ? "en-GB" : "ar-EG-u-nu-latn", { day: "numeric", month: "long", year: "numeric" })}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}
export function HydrateFallback() {
  return <SkeletonTable />;
}

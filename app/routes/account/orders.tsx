import { Link, data } from "react-router";
import type { Route } from "./+types/orders";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { formatPiastres } from "~/lib/money";
import { listOwnOrders } from "~/features/orders/api";
import { ReorderButton } from "~/features/account/ReorderButton";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonPage } from "~/components/ui/Skeleton";


/** Account orders (JOURNEYS §12): filters + details + reorder entry. */
export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "account", request);
  const filterParam = new URL(request.url).searchParams.get("filter") ?? "all";
  const filter = (["all", "active", "completed", "cancelled"] as const).includes(filterParam as "all")
    ? (filterParam as "all" | "active" | "completed" | "cancelled")
    : "all";
  const orders = await listOwnOrders(client, filter);
  return { lang, filter, orders: JSON.parse(JSON.stringify(orders)) };
}

export default function AccountOrdersPage({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const money = (p: number) => formatPiastres(p, en ? "en" : "ar");
  const filters = [
    { key: "all", label: t("orders.filterAll") },
    { key: "active", label: t("orders.filterActive") },
    { key: "completed", label: t("orders.filterCompleted") },
    { key: "cancelled", label: t("orders.filterCancelled") },
  ];
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <Link
            key={f.key}
            to={`/${loaderData.lang}/account/orders?filter=${f.key}`}
            className={`rounded-md border px-3 py-1.5 text-[13px] font-bold transition-colors duration-150 ${
              loaderData.filter === f.key ? "border-action text-action" : "border-border text-text-muted hover:text-text"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {loaderData.orders.length === 0 ? (
        <p className="mt-6 text-sm text-text-muted">{t("orders.empty")}</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {loaderData.orders.map((o: {
            id: string; number: string; status: string; payment_method: string;
            payment_status: string; total_piastres: number; created_at: string;
          }) => (
            <li key={o.id} className="rounded-md border border-border bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <Link
                    to={`/${loaderData.lang}/account/orders/${encodeURIComponent(o.number)}`}
                    className="text-sm font-extrabold text-action hover:underline" dir="ltr"
                  >
                    {o.number}
                  </Link>
                  <p className="text-xs text-text-muted" dir="ltr">
                    {new Date(o.created_at).toLocaleDateString(en ? "en-EG" : "ar-EG")}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-md px-2 py-1 text-xs font-bold ${o.status === "cancelled" ? "bg-surface-tint text-danger" : "bg-surface-tint text-text"}`}>
                    {t(`order.status_${o.status}`)}
                  </span>
                  <span className="text-[13px] font-extrabold text-text">{money(o.total_piastres)}</span>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Link
                  to={`/${loaderData.lang}/account/orders/${encodeURIComponent(o.number)}`}
                  className="rounded-md border border-border px-3 py-1.5 text-[13px] font-bold text-text hover:bg-surface-tint"
                >
                  {t("orders.details")}
                </Link>
                <ReorderButton orderNumber={o.number} lang={loaderData.lang} />
                <Link
                  to={`/${loaderData.lang}/order/${encodeURIComponent(o.number)}/track`}
                  className="rounded-md border border-border px-3 py-1.5 text-[13px] font-bold text-text hover:bg-surface-tint"
                >
                  {t("order.track")}
                </Link>
              </div>
            </li>
          ))}
        </ul>
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

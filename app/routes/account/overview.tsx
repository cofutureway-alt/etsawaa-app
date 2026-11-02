import { Link, data } from "react-router";
import type { Route } from "./+types/overview";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { formatPiastres } from "~/lib/money";
import { listOwnOrders, listRefundRequests } from "~/features/orders/api";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { ChevronLeftIcon } from "~/components/ui/icons";
import { SkeletonPage } from "~/components/ui/Skeleton";


/**
 * Account overview (JOURNEYS §12) — H-01 professional rebuild:
 * a quick-stats row (orders count / in-progress / refunds), profile
 * completeness alert, then recent orders as horizontal cards with status
 * tone chips. Same data loaders; presentation only.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  const viewer = await requirePanelAccess(client, lang, "account", request);
  const [orders, refunds, profileRes] = await Promise.all([
    listOwnOrders(client, "all", 5),
    listRefundRequests(client, 5),
    client.from("profiles").select("full_name, phone, phone_alternate").eq("id", viewer.user.id).maybeSingle(),
  ]);
  const p = profileRes.data as { full_name: string; phone: string | null; phone_alternate: string | null } | null;
  const missingProfile = !p?.full_name || !p?.phone || !p?.phone_alternate;
  return {
    lang,
    orders: JSON.parse(JSON.stringify(orders)),
    refunds: JSON.parse(JSON.stringify(refunds)),
    missingProfile,
  };
}

const STATUS_TONE: Record<string, string> = {
  pending_payment: "bg-warning-soft text-warning-strong",
  processing: "bg-info-soft text-info-strong",
  on_hold: "bg-warning-soft text-warning-strong",
  completed: "bg-success-soft text-success-strong",
  cancelled: "bg-danger-soft text-danger-strong",
  pending: "bg-info-soft text-info-strong",
};

export default function AccountOverview({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const money = (p: number) => formatPiastres(p, en ? "en" : "ar");
  const lang = loaderData.lang;
  const orders = loaderData.orders as Array<{ id: string; number: string; status: string; total_piastres: number; created_at: string }>;
  const refunds = loaderData.refunds as Array<{ id: string; order: { number: string } | null; status: string; created_at: string }>;
  const inProgress = orders.filter((o) => !["completed", "cancelled"].includes(o.status)).length

  const stats = [
    { label: t("account.ordersTab"), value: orders.length, to: `/${lang}/account/orders` },
    { label: t("overview.inProgress"), value: inProgress, to: `/${lang}/account/orders` },
    { label: t("overview.refundStatuses"), value: refunds.length, to: `/${lang}/account/returns` },
  ];

  return (
    <div className="flex flex-col gap-5">
      {loaderData.missingProfile ? (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-m border border-primary/40 bg-primary-soft p-4 text-[13px]">
          <p className="font-bold text-text">{t("overview.completeProfile")}</p>
          <Link to={`/${lang}/account/profile`} className="inline-flex min-h-11 items-center rounded-m bg-action px-4 font-extrabold text-on-action hover:bg-action-hover">
            {t("account.profile")}
          </Link>
        </div>
      ) : null}

      {/* quick stats */}
      <section aria-label={t("account.overview")} className="grid grid-cols-3 gap-3">
        {stats.map((s) => (
          <Link key={s.label} to={s.to} className="rounded-l border border-border bg-surface p-4 transition-colors duration-150 hover:border-primary/40">
            <p className="num text-2xl font-black text-text">{s.value}</p>
            <p className="mt-1 truncate text-xs font-bold text-text-muted">{s.label}</p>
          </Link>
        ))}
      </section>

      <section aria-label={t("overview.recentOrders")}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-extrabold text-text">{t("overview.recentOrders")}</h2>
          <Link to={`/${lang}/account/orders`} className="inline-flex min-h-11 items-center gap-1 text-[13px] font-bold text-action hover:underline">
            {t("overview.viewAll")}
            <ChevronLeftIcon aria-hidden="true" width={13} height={13} className="rtl:rotate-0 ltr:rotate-180" />
          </Link>
        </div>
        {orders.length === 0 ? (
          <div className="mt-2 rounded-l border border-dashed border-border-strong bg-surface px-5 py-8 text-center">
            <p className="text-sm font-bold text-text">{t("orders.empty")}</p>
            <Link to={`/${lang}/products`} className="mt-2 inline-flex min-h-11 items-center rounded-m bg-action px-4 text-[13px] font-extrabold text-on-action hover:bg-action-hover">
              {t("nav.allProducts")}
            </Link>
          </div>
        ) : (
          <ul className="mt-2 flex flex-col gap-2.5">
            {orders.map((o) => (
              <li key={o.id}>
                <Link
                  to={`/${lang}/account/orders/${encodeURIComponent(o.number)}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-m border border-border bg-surface p-4 transition-colors duration-150 hover:border-primary/40"
                >
                  <span className="min-w-0">
                    <span className="block font-extrabold text-text" dir="ltr">{o.number}</span>
                    <span className="block text-xs text-text-muted num" dir="ltr">
                      {new Date(o.created_at).toLocaleDateString(en ? "en-EG" : "ar-EG")}
                    </span>
                  </span>
                  <span className={`ms-auto rounded-full px-3 py-1 text-xs font-extrabold ${STATUS_TONE[o.status] ?? "bg-surface-tint text-text-muted"}`}>
                    {t(`order.status_${o.status}`)}
                  </span>
                  <span className="num text-sm font-black text-text">{money(o.total_piastres)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label={t("overview.refundStatuses")}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-extrabold text-text">{t("overview.refundStatuses")}</h2>
          <Link to={`/${lang}/account/returns`} className="inline-flex min-h-11 items-center gap-1 text-[13px] font-bold text-action hover:underline">
            {t("overview.viewAll")}
            <ChevronLeftIcon aria-hidden="true" width={13} height={13} className="rtl:rotate-0 ltr:rotate-180" />
          </Link>
        </div>
        {refunds.length === 0 ? (
          <div className="mt-2 rounded-l border border-dashed border-border-strong bg-surface px-5 py-8 text-center">
            <p className="text-sm text-text-muted">{t("returns.empty")}</p>
          </div>
        ) : (
          <ul className="mt-2 flex flex-col gap-2.5">
            {refunds.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-m border border-border bg-surface p-4 text-[13px]">
                <span className="font-extrabold text-text" dir="ltr">{r.order?.number ?? "—"}</span>
                <span className="ms-auto rounded-full bg-surface-tint px-3 py-1 text-xs font-extrabold text-text-muted">
                  {t(`returns.status_${r.status}`)}
                </span>
              </li>
            ))}
          </ul>
        )}
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

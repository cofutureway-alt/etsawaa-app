import { Link, data } from "react-router";
import type { Route } from "./+types/returns";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { listRefundRequests } from "~/features/orders/api";
import { formatPiastres } from "~/lib/money";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonPage } from "~/components/ui/Skeleton";


/** Account returns list (JOURNEYS §11): statuses + timeline + amounts. */
export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "account", request);
  const requests = await listRefundRequests(client);
  return {
    lang,
    requests: JSON.parse(JSON.stringify(requests)),
    submitted: new URL(request.url).searchParams.get("submitted") === "1",
  };
}

export default function AccountReturnsPage({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const money = (p: number) => formatPiastres(p, en ? "en" : "ar");
  return (
    <div>
      {loaderData.submitted ? (
        <p role="status" className="mb-4 rounded-md border border-primary bg-surface-tint p-3 text-sm font-bold text-text">
          {t("returns.submittedNotice")}
        </p>
      ) : null}
      {loaderData.requests.length === 0 ? (
        <p className="mt-2 text-sm text-text-muted">{t("returns.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {loaderData.requests.map((r: {
            id: string; order: { number: string } | null; kind: string; status: string;
            created_at: string; decision_note: string | null;
            resolution?: string; refund_total_piastres?: number; exchange_applied_piastres?: number;
            exchange_wallet_piastres?: number; exchange_hold_piastres?: number; credit_destination?: string | null;
            exchange_order?: { number: string; total_piastres: number; wallet_paid_piastres: number; payment_status: string; status: string } | null;
          }) => {
            const ex = r.exchange_order ?? null;
            const toPay = ex && ex.payment_status === "unpaid" && ex.status !== "cancelled"
              ? Math.max(0, ex.total_piastres - (ex.wallet_paid_piastres ?? 0)) : 0;
            const leftover = Math.max(0, (r.refund_total_piastres ?? 0) - (r.exchange_applied_piastres ?? 0));
            return (
            <li key={r.id} className="rounded-md border border-border bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-bold text-text" dir="ltr">{r.order?.number ?? "—"}</p>
                  <p className="text-xs text-text-muted">
                    {new Date(r.created_at).toLocaleDateString(en ? "en-GB" : "ar-EG-u-nu-latn", { day: "numeric", month: "short", year: "numeric" })}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-surface-tint px-2 py-1 text-xs font-bold text-text">
                    {r.kind === "return" ? t("returns.kindReturn") : t("returns.kindWarranty")}
                  </span>
                  {r.resolution && r.resolution !== "refund" ? (
                    <span className="rounded-md bg-action/10 px-2 py-1 text-xs font-bold text-action">
                      {t(`exchange.res_${r.resolution}`)}
                    </span>
                  ) : null}
                  <span className="rounded-md bg-surface-tint px-2 py-1 text-xs font-bold text-text">
                    {r.status === "refunded" && r.resolution && r.resolution !== "refund" ? t("exchange.done") : t(`returns.status_${r.status}`)}
                  </span>
                </div>
              </div>
              {ex ? (
                <div className="mt-3 rounded-md border border-border bg-surface-tint p-3 text-sm">
                  <p className="font-bold text-text">
                    {t("exchange.newOrder")}{" "}
                    <Link to={`/${loaderData.lang}/order/${encodeURIComponent(ex.number)}`} className="text-action hover:underline" dir="ltr">{ex.number}</Link>
                  </p>
                  <p className="mt-1 text-xs text-text-muted">{t("exchange.creditUsed", { amount: money(r.exchange_applied_piastres ?? 0) })}</p>
                  {(r.exchange_hold_piastres ?? 0) > 0 ? (
                    <p className="mt-0.5 text-xs font-bold text-text">{t("exchange.heldCustomer", { amount: money(r.exchange_hold_piastres ?? 0) })}</p>
                  ) : null}
                  {leftover > 0 && !((r.exchange_hold_piastres ?? 0) > 0 && r.credit_destination === "wallet") ? (
                    <p className="mt-0.5 text-xs text-text-muted">
                      {r.credit_destination === "wallet" ? t("exchange.leftoverWallet", { amount: money(leftover) }) : t("exchange.leftoverRefund", { amount: money(leftover) })}
                    </p>
                  ) : null}
                  {toPay > 0 ? (
                    <Link to={`/${loaderData.lang}/order/${encodeURIComponent(ex.number)}`}
                      className="mt-2 inline-flex min-h-10 items-center rounded-md bg-action px-4 text-sm font-extrabold text-on-action hover:bg-action-hover">
                      {t("exchange.payDifference", { amount: money(toPay) })}
                    </Link>
                  ) : null}
                </div>
              ) : null}
              {r.status === "pending_admin" ? (
                <p className="mt-2 text-sm text-text-muted">{t("returns.underReview")}</p>
              ) : null}
              {r.decision_note ? (
                <p className="mt-2 text-sm text-text-muted">{t("returns.decisionNote")}: {r.decision_note}</p>
              ) : null}
              {r.order ? (
                <Link
                  to={`/${loaderData.lang}/account/orders/${encodeURIComponent(r.order.number)}`}
                  className="mt-2 inline-block text-sm font-bold text-action hover:underline"
                >
                  {t("orders.details")}
                </Link>
              ) : null}
            </li>
            );
          })}
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

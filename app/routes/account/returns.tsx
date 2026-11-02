import { Link, data } from "react-router";
import type { Route } from "./+types/returns";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { listRefundRequests } from "~/features/orders/api";
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
  return (
    <div>
      {loaderData.submitted ? (
        <p role="status" className="mb-4 rounded-md border border-primary bg-surface-tint p-3 text-[13px] font-bold text-text">
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
          }) => (
            <li key={r.id} className="rounded-md border border-border bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-bold text-text" dir="ltr">{r.order?.number ?? "—"}</p>
                  <p className="text-xs text-text-muted" dir="ltr">
                    {new Date(r.created_at).toLocaleDateString(en ? "en-EG" : "ar-EG")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-surface-tint px-2 py-1 text-xs font-bold text-text">
                    {r.kind === "return" ? t("returns.kindReturn") : t("returns.kindWarranty")}
                  </span>
                  <span className="rounded-md bg-surface-tint px-2 py-1 text-xs font-bold text-text">
                    {t(`returns.status_${r.status}`)}
                  </span>
                </div>
              </div>
              {r.status === "pending_admin" ? (
                <p className="mt-2 text-[13px] text-text-muted">{t("returns.underReview")}</p>
              ) : null}
              {r.decision_note ? (
                <p className="mt-2 text-[13px] text-text-muted">{t("returns.decisionNote")}: {r.decision_note}</p>
              ) : null}
              {r.order ? (
                <Link
                  to={`/${loaderData.lang}/account/orders/${encodeURIComponent(r.order.number)}`}
                  className="mt-2 inline-block text-[13px] font-bold text-action hover:underline"
                >
                  {t("orders.details")}
                </Link>
              ) : null}
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

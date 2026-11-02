import { Link, data, redirect } from "react-router";
import type { Route } from "./+types/order-track";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { getViewer } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { publicMeta } from "~/lib/seo";
import { getOwnOrder, getOrderParts, type GroupRow } from "~/features/orders/api";
import { SkeletonPage } from "~/components/ui/Skeleton";


/**
 * Tracking (JOURNEYS §9): per-vendor-group timeline with timestamps + notes.
 * States are ordered; a group with no updates yet shows "preparing your
 * shipment" rather than an empty timeline.
 */
export const meta: Route.MetaFunction = ({ params }) =>
  publicMeta({
    lang: params.lang === "en" ? "en" : "ar",
    path: "/order/track",
    title: params.lang === "en" ? "Track order — Etsawaa" : "تتبع الطلب — اتسوء",
    description: params.lang === "en" ? "Follow your order." : "تابع حالة طلبك.",
    noindex: true,
  });

const FLOW = ["pending", "preparing", "handed_to_carrier", "out_for_delivery", "delivered"] as const;

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  const { viewer } = (await getViewer(client)) ?? { viewer: null };
  if (!viewer) {
    throw redirect(`/${lang}/auth/login?next=${encodeURIComponent(new URL(request.url).pathname)}`);
  }
  const order = await getOwnOrder(client, params.number ?? "");
  if (!order) throw new Response("Not found", { status: 404 });
  const parts = await getOrderParts(client, order.id);
  return {
    lang,
    order: JSON.parse(JSON.stringify(order)) as { id: string; number: string; status: string; created_at: string },
    groups: JSON.parse(JSON.stringify(parts.groups)) as GroupRow[],
    history: parts.history,
  };
}

export default function TrackPage({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const { lang, order, groups, history } = loaderData;

  const statusLabel = (s: string): string => {
    const key = `order.status_${s}`;
    const translated = t(key);
    return translated === key ? s : translated;
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <p className="text-sm">
        <Link to={`/${lang}/order/${encodeURIComponent(order.number)}`} className="font-bold text-action hover:underline">
          {t("order.backToOrder")} <span dir="ltr">{order.number}</span>
        </Link>
      </p>
      <h1 className="mt-1 text-lg font-extrabold text-text">{t("order.trackTitle")}</h1>

      <div className="mt-5 flex flex-col gap-5">
        {groups.map((g) => {
          const updates = history.filter((h) => h.group_id === g.id);
          const idx = FLOW.indexOf(g.status as (typeof FLOW)[number]);
          return (
            <section key={g.id} className="rounded-md border border-border bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-extrabold text-text">
                  {en ? g.vendor.store_name_en : g.vendor.store_name_ar}
                </h2>
                <span className={`rounded-md px-2 py-1 text-xs font-bold ${g.status === "cancelled" ? "bg-surface-tint text-danger" : "bg-surface-tint text-text"}`}>
                  {statusLabel(g.status)}
                </span>
              </div>

              {g.status === "cancelled" ? (
                <p className="mt-3 text-sm text-text-muted">{t("order.cancelReason")}: {g.cancel_reason ?? "—"}</p>
              ) : (
                <ol className="mt-4 flex flex-col gap-0">
                  {FLOW.map((s, i) => {
                    const reached = idx >= i;
                    const update = updates.find((u) => u.status === s);
                    return (
                      <li key={s} className="relative flex gap-3 pb-4 last:pb-0">
                        {/* connector */}
                        {i < FLOW.length - 1 ? (
                          <span aria-hidden="true" className={`absolute start-[7px] top-5 h-full w-0.5 ${reached ? "bg-action" : "bg-border"}`} />
                        ) : null}
                        <span
                          aria-hidden="true"
                          className={`relative z-10 mt-1 size-4 shrink-0 rounded-full border-2 ${
                            reached ? "border-action bg-action" : "border-border bg-surface"
                          }`}
                        />
                        <div>
                          <p className={`text-sm font-bold ${reached ? "text-text" : "text-text-faint"}`}>
                            {statusLabel(s)}
                          </p>
                          {update ? (
                            <p className="text-xs text-text-muted" dir="ltr">
                              {new Date(update.created_at).toLocaleString(en ? "en-EG" : "ar-EG")}
                              {update.note && !update.note.startsWith("fn_") ? ` — ${update.note}` : ""}
                            </p>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
              {updates.length === 0 && g.status !== "cancelled" ? (
                <p className="mt-2 text-xs text-text-faint">{t("order.preparing")}</p>
              ) : null}
            </section>
          );
        })}
        {groups.length === 0 ? <p className="text-sm text-text-muted">{t("order.preparing")}</p> : null}
      </div>
    </div>
  );
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonPage />;
}

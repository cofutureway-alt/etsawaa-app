import { useEffect, useState } from "react";
import { data, useFetcher } from "react-router";
import type { Route } from "./+types/events";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { formatPiastres } from "~/lib/money";
import { Button } from "~/components/ui/Button";
import { Badge } from "~/components/ui/Badge";
import { Dialog } from "~/components/ui";
import { TagIcon } from "~/components/ui/icons";
import { EmptyState } from "~/components/ui/EmptyState";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonTable } from "~/components/ui/Skeleton";
import { PageHeader } from "~/components/layout/PageHeader";
import { useActionToast } from "~/components/layout/ActionFeedback";

/**
 * Vendor events (ARCHITECTURE §7 lists /vendor/events; the route was missing).
 * AGENT §21: vendors are auto-enrolled and may REFUSE — refusal hides their
 * products from home/listings and excludes them from event discounts, so this
 * is the one action a vendor owns here. Acceptance is the default; a store
 * that opted out shows "Not participating". Each event card shows its phase,
 * when it ends/starts, and the discounts that apply to this store's products
 * (or that the event has none) — from fn_vendor_event_overview.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "vendor", request);
  const { data: rows, error } = await client.rpc("fn_vendor_event_overview");
  if (error) throw new Error(error.message);
  return { lang, events: (rows ?? []) as VendorEvent[] };
}

export interface VendorEvent {
  id: string; name_ar: string; name_en: string; desc_ar: string | null; desc_en: string | null;
  starts_at: string; ends_at: string;
  participation: "participating" | "refused";
  phase: "live" | "upcoming" | "ended";
  discounts: Array<{ scope: "product" | "category"; percent: number; max_piastres: number | null; name_ar: string; name_en: string; products: number }>;
  affected_products: number;
  max_percent: number | null;
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "vendor", request);
  const form = await request.formData();
  const eventId = String(form.get("event_id") ?? "");
  const status = String(form.get("status") ?? "");
  if (!eventId || !["accepted", "refused"].includes(status)) {
    return data({ ok: false, reason: "bad_request" }, { status: 400 });
  }
  // fn_vendor_event_opt validates ownership and the event state server-side.
  const { data: res, error } = await client.rpc("fn_vendor_event_opt", {
    p_event_id: eventId,
    p_status: status,
  });
  if (error) return data({ ok: false, reason: error.message.includes("store_suspended") ? "store_suspended" : "server_error" }, { status: 500 });
  const r = res as { ok?: boolean; reason?: string } | null;
  if (r && r.ok === false) return data({ ok: false, reason: r.reason ?? "refused" }, { status: 400 });
  return { ok: true as const };
}

export default function VendorEvents({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { lang, events } = loaderData;
  const en = lang === "en";
  const fetcher = useFetcher<typeof action>();
  useActionToast(fetcher);
  const busy = fetcher.state !== "idle";
  const [confirm, setConfirm] = useState<VendorEvent | null>(null);
  useEffect(() => { if (fetcher.state === "idle" && fetcher.data?.ok) setConfirm(null); }, [fetcher.state, fetcher.data]);
  const date = (v: string) => new Date(v).toLocaleString(en ? "en-GB" : "ar-EG-u-nu-latn", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const money = (p: number) => formatPiastres(p, en ? "en" : "ar");
  const setParticipation = (e: VendorEvent, status: "accepted" | "refused") =>
    fetcher.submit({ event_id: e.id, status }, { method: "post" });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("vev.title")} subtitle={t("vev.hint")} />

      {events.length === 0 ? (
        <EmptyState title={t("vev.empty")} body={t("vev.emptyHint")} />
      ) : (
        <ul className="flex flex-col gap-4">
          {events.map((e) => {
            const name = en ? e.name_en || e.name_ar : e.name_ar || e.name_en;
            const desc = en ? e.desc_en || e.desc_ar : e.desc_ar || e.desc_en;
            const refused = e.participation === "refused";
            const live = e.phase === "live";
            return (
              <li key={e.id} className={`overflow-hidden rounded-xl border-2 bg-surface shadow-1 ${live && !refused ? "border-action" : "border-border"}`}>
                <div className={`flex flex-wrap items-center gap-3 px-4 py-3 ${live && !refused ? "bg-action/10" : "bg-surface-tint/50"}`}>
                  <span className={`flex size-14 shrink-0 flex-col items-center justify-center rounded-lg text-center ${e.max_percent && !refused ? "bg-danger text-white" : "bg-surface text-action"}`}>
                    {e.max_percent && !refused
                      ? (<><span className="num text-lg font-black leading-none">{e.max_percent}%</span><span className="text-[10px] font-bold">{t("vev.off")}</span></>)
                      : <TagIcon className="size-6" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <b className="text-base text-text">{name}</b>
                      <Badge tone={live ? "success" : e.phase === "upcoming" ? "info" : "neutral"} dot={live}>{t(`vev.phase_${e.phase}`)}</Badge>
                      <Badge tone={refused ? "danger" : "success"}>{t(refused ? "vev.notParticipating" : "vev.participating")}</Badge>
                    </p>
                    <p className="num mt-0.5 text-xs text-text-muted">
                      {live ? t("vev.endsAt", { date: date(e.ends_at) }) : e.phase === "upcoming" ? t("vev.startsAt", { date: date(e.starts_at) }) : t("vev.endedAt", { date: date(e.ends_at) })}
                    </p>
                  </div>
                  {e.phase !== "ended" ? (
                    refused ? (
                      <Button size="sm" loading={busy} onClick={() => setParticipation(e, "accepted")}>{t("vev.join")}</Button>
                    ) : (
                      <Button size="sm" variant="outline" className="text-danger" disabled={busy} onClick={() => setConfirm(e)}>{t("vev.refuse")}</Button>
                    )
                  ) : null}
                </div>

                <div className="flex flex-col gap-3 px-4 py-3">
                  {desc ? <p className="text-sm text-text">{desc}</p> : null}
                  {refused ? (
                    <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{t("vev.refusedEffect")}</p>
                  ) : e.discounts.length ? (
                    <>
                      <p className="text-sm text-text">{t("vev.affects", { count: e.affected_products })}</p>
                      <ul className="grid gap-2 sm:grid-cols-2">
                        {e.discounts.map((d, i) => (
                          <li key={i} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
                            <span className="min-w-0">
                              <span className="block truncate font-bold text-text">{en ? d.name_en : d.name_ar}</span>
                              <span className="text-xs text-text-muted">{t(d.scope === "category" ? "vev.scopeCategory" : "vev.scopeProduct")} · {t("vev.productsN", { count: d.products })}</span>
                            </span>
                            <span className="shrink-0 text-end">
                              <b className="num text-danger">-{d.percent}%</b>
                              {d.max_piastres ? <span className="block text-2xs text-text-muted">{t("vev.cap", { amount: money(d.max_piastres) })}</span> : null}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p className="rounded-md bg-surface-tint px-3 py-2 text-sm text-text-muted">{t("vev.noDiscount")}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={confirm !== null} onClose={() => setConfirm(null)} title={t("vev.refuseTitle")}>
        {confirm ? (
          <div className="flex flex-col gap-3 p-1">
            <p className="text-sm text-text">{t("vev.refuseBody", { name: en ? confirm.name_en : confirm.name_ar })}</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirm(null)}>{t("common.cancel")}</Button>
              <Button className="bg-danger hover:bg-danger" loading={busy} onClick={() => setParticipation(confirm, "refused")}>{t("vev.refuseConfirm")}</Button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}

/** H-06: friendly route error page (500s log a CORERR id; 403/404 keep their message) */
export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}

/** H-24: stable skeleton while the loader streams. */
export function HydrateFallback() {
  return <SkeletonTable />;
}

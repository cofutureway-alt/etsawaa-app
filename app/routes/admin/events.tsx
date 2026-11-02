import { data, useFetcher } from "react-router";
import type { Route } from "./+types/events";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { Button } from "~/components/ui/Button";
import { Badge } from "~/components/ui/Badge";
import { EmptyState } from "~/components/ui/EmptyState";
import { PlusIcon, CheckIcon, StoreIcon, TagIcon, AlertIcon } from "~/components/ui/icons";
import { Dialog } from "~/components/ui/Overlay";
import { Input } from "~/components/ui/Input";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonTable } from "~/components/ui/Skeleton";
// Surfaces the action result: these pages used to discard {ok:false} and
// render nothing, so a failed write looked like a dead button.
import { useActionToast } from "~/components/layout/ActionFeedback";


/**
 * A-21 — Events (US-11 / AGENT §21): CRUD + Black Friday preset + category
 * discounts + vendor list (auto/accepted/refused) with refusal toggling.
 * Refusal hides the vendor's products publicly (phase-04 views) within one
 * request cycle (server-computed views — no cache).
 */

interface EventRow {
  id: string; name_ar: string; name_en: string; status: string;
  starts_at: string; ends_at: string;
}
interface DiscountRow { id: string; scope: string; ref_id: string; percent: number }
interface VendorRow {
  vendor_id: string; store_ar: string; store_en: string; status: string;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const active = await client.from("events").select("*").order("created_at", { ascending: false }).limit(10);
  if (active.error) throw new Error(active.error.message);
  const ev = ((active.data ?? []) as EventRow[])[0];
  let discounts: DiscountRow[] = [];
  let vendors: VendorRow[] = [];
  if (ev) {
    const [d, v] = await Promise.all([
      client.from("event_discounts").select("id, scope, ref_id, percent").eq("event_id", ev.id),
      client.from("event_vendors").select(`vendor_id, status, vendors!inner(store_name_ar, store_name_en)`)
        .eq("event_id", ev.id).limit(200),
    ]);
    discounts = (d.data ?? []) as DiscountRow[];
    vendors = ((v.data ?? []) as unknown as Array<Record<string, unknown>>).map((r) => {
      const vd = r.vendors as { store_name_ar: string; store_name_en: string };
      return { vendor_id: r.vendor_id as string, store_ar: vd.store_name_ar, store_en: vd.store_name_en, status: r.status as string };
    });
  }
  const cats = await client.from("categories").select("id, name_ar, name_en").eq("is_active", true).is("deleted_at", null).order("path");
  return {
    lang, events: JSON.parse(JSON.stringify(active.data ?? [])) as EventRow[],
    discounts, vendors,
    categories: JSON.parse(JSON.stringify(cats.data ?? [])) as Array<{ id: string; name_ar: string; name_en: string }>,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "create") {
    const year = new Date().getFullYear();
    const { error } = await client.from("events").insert({
      name_ar: String(form.get("name_ar") ?? "").trim() || "الجمعة البيضاء",
      name_en: String(form.get("name_en") ?? "").trim() || "Black Friday",
      starts_at: new Date(`${year}-11-01T00:00:00Z`).toISOString(),
      ends_at: new Date(`${year}-11-30T23:59:59Z`).toISOString(),
      status: "active",
    });
    if (error) return data({ ok: false, reason: error.message }, { status: 400 });
    await client.rpc("fn_audit", { p_action: "event.created", p_entity: "events", p_entity_id: null, p_before: null, p_after: { bf: true } });
    return { ok: true as const };
  }

  if (intent === "status") {
    const id = String(form.get("id") ?? "");
    const status = String(form.get("status") ?? "");
    if (!["draft", "active", "ended"].includes(status)) return data({ ok: false, reason: "bad_status" }, { status: 400 });
    const { error } = await client.from("events").update({ status }).eq("id", id);
    if (error) return data({ ok: false, reason: error.message }, { status: 400 });
    await client.rpc("fn_audit", { p_action: "event.status", p_entity: "events", p_entity_id: id, p_before: null, p_after: { status } });
    return { ok: true as const };
  }

  if (intent === "discount_add") {
    const { error } = await client.from("event_discounts").insert({
      event_id: String(form.get("event_id") ?? ""),
      scope: "category",
      ref_id: String(form.get("category_id") ?? ""),
      percent: Math.min(90, Math.max(1, Math.trunc(Number(form.get("percent") ?? 0)))),
    });
    if (error) return data({ ok: false, reason: error.message }, { status: 400 });
    return { ok: true as const };
  }

  if (intent === "discount_del") {
    const { error } = await client.from("event_discounts").delete().eq("id", String(form.get("id") ?? ""));
    if (error) return data({ ok: false, reason: error.message }, { status: 400 });
    return { ok: true as const };
  }

  if (intent === "vendor_status") {
    // refuse requires a reason; accept/auto flip back (products re-appear)
    const res = await client.rpc("fn_event_set_vendor", {
      p_event_id: String(form.get("event_id") ?? ""),
      p_vendor_id: String(form.get("vendor_id") ?? ""),
      p_status: String(form.get("status") ?? ""),
      p_reason: String(form.get("reason") ?? ""),
    });
    if (res.error) return data({ ok: false, reason: res.error.message }, { status: 500 });
    const r = res.data as { ok: boolean; reason?: string };
    return r.ok ? { ok: true as const } : data({ ok: false, reason: r.reason }, { status: 400 });
  }
  return data({ ok: false, reason: "bad_intent" }, { status: 400 });
}

export default function AdminEvents({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const fetcher = useFetcher<typeof action>();
  useActionToast(fetcher);
  const busy = fetcher.state !== "idle";
  const [creating, setCreating] = useState(false);
  const ev = (loaderData.events as EventRow[])[0];
  const lang = loaderData.lang;

  // Category name lookup map
  const catNames = new Map(
    (loaderData.categories as Array<{ id: string; name_ar: string; name_en: string }>).map((c) => [
      c.id,
      en ? c.name_en : c.name_ar,
    ])
  );

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col gap-4 rounded-xl border border-border/80 bg-surface p-4 sm:p-6 shadow-sm md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-black text-text">{t("ev.title")}</h1>
            {ev ? (
              <Badge tone={ev.status === "active" ? "success" : "neutral"} dot>
                {t(`ev.st_${ev.status}`)}
              </Badge>
            ) : null}
          </div>
          <p className="text-xs text-text-muted">
            إدارة الفعاليات الموسمية وتخفيضات الفئات وقوائم قبول ورفض المتاجر
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2 pt-2 md:pt-0 border-t border-border/40 md:border-t-0">
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => setCreating(true)}
            className="cursor-pointer"
          >
            <PlusIcon className="size-3.5" />
            {t("ev.createCta")}
          </Button>

          {/* One-click Black Friday preset */}
          <fetcher.Form method="post" className="inline">
            <input type="hidden" name="intent" value="create" />
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={busy}
              className="cursor-pointer"
            >
              {t("ev.bfPreset")}
            </Button>
          </fetcher.Form>
        </div>
      </div>

      {!ev ? (
        <div className="rounded-xl border border-border/80 bg-surface p-8 shadow-sm">
          <EmptyState title={t("ev.empty")} body={t("ev.emptyHint")} />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Active Event Showcase Card */}
          <section className="rounded-xl border border-border/80 border-t-4 border-t-action bg-surface p-4 sm:p-6 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg sm:text-xl font-black text-text">
                    {en ? ev.name_en : ev.name_ar}
                  </h2>
                  <Badge tone={ev.status === "active" ? "success" : "neutral"} dot>
                    {t(`ev.st_${ev.status}`)}
                  </Badge>
                </div>
                <p className="text-xs font-mono text-text-muted" dir="ltr">
                  {ev.starts_at.slice(0, 10)} → {ev.ends_at.slice(0, 10)}
                </p>
              </div>

              <div>
                <fetcher.Form method="post">
                  <input type="hidden" name="intent" value="status" />
                  <input type="hidden" name="id" value={ev.id} />
                  <input
                    type="hidden"
                    name="status"
                    value={ev.status === "active" ? "ended" : "active"}
                  />
                  <Button
                    type="submit"
                    size="sm"
                    variant={ev.status === "active" ? "outline" : "primary"}
                    disabled={busy}
                    className="cursor-pointer"
                  >
                    {ev.status === "active" ? t("ev.end") : t("ev.activate")}
                  </Button>
                </fetcher.Form>
              </div>
            </div>
          </section>

          {/* Category Discounts Section */}
          <section className="rounded-xl border border-border/80 bg-surface p-4 sm:p-6 shadow-sm space-y-4" aria-label={t("ev.discounts")}>
            <div className="space-y-1 border-b border-border/50 pb-3">
              <h2 className="text-sm font-extrabold text-text flex items-center gap-2">
                <TagIcon className="size-4 text-action" />
                <span>{t("ev.discounts")}</span>
              </h2>
              <p className="text-xs text-text-muted">
                تحديد نسب الخصم المئوية المطبقة على تصنيفات المنتجات خلال فترة الفعالية
              </p>
            </div>

            {/* Add Discount Form */}
            <fetcher.Form method="post" className="flex flex-wrap items-end gap-3 text-xs">
              <input type="hidden" name="intent" value="discount_add" />
              <input type="hidden" name="event_id" value={ev.id} />

              <label className="flex flex-col gap-1 font-bold text-text min-w-[200px] flex-1">
                {t("ev.category")}
                <select
                  name="category_id"
                  className="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text shadow-sm focus:border-action focus:outline-none"
                >
                  {(loaderData.categories as Array<{ id: string; name_ar: string; name_en: string }>).map((c) => (
                    <option key={c.id} value={c.id}>
                      {en ? c.name_en : c.name_ar}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1 font-bold text-text w-28">
                {t("ev.percent")} (%)
                <input
                  name="percent"
                  type="number"
                  min={1}
                  max={90}
                  required
                  defaultValue={15}
                  dir="ltr"
                  className="rounded-lg border border-border bg-surface px-3 py-2 text-xs font-mono text-text shadow-sm focus:border-action focus:outline-none"
                />
              </label>

              <Button type="submit" size="sm" disabled={busy} className="cursor-pointer shrink-0">
                <PlusIcon className="size-3.5" />
                {t("cp.create")}
              </Button>
            </fetcher.Form>

            {/* Discounts List */}
            {loaderData.discounts.length > 0 ? (
              <div className="flex flex-wrap gap-2 pt-2">
                {(loaderData.discounts as DiscountRow[]).map((d) => (
                  <div
                    key={d.id}
                    className="inline-flex items-center gap-2 rounded-lg border border-border/80 bg-surface-tint/40 px-3 py-1.5 text-xs text-text shadow-sm"
                  >
                    <span className="font-bold text-text">
                      {catNames.get(d.ref_id) ?? d.ref_id.slice(0, 8)}
                    </span>
                    <Badge tone="danger" dot>
                      −{d.percent}%
                    </Badge>
                    <fetcher.Form method="post" className="inline-flex items-center">
                      <input type="hidden" name="intent" value="discount_del" />
                      <input type="hidden" name="id" value={d.id} />
                      <button
                        type="submit"
                        aria-label={t("common.cancel")}
                        className="cursor-pointer text-text-muted hover:text-danger text-sm font-bold ms-1"
                      >
                        ×
                      </button>
                    </fetcher.Form>
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          {/* Vendors Enrollment & Refusal Section */}
          <section className="rounded-xl border border-border/80 bg-surface p-4 sm:p-6 shadow-sm space-y-4" aria-label={t("ev.vendors")}>
            <div className="flex items-center justify-between border-b border-border/50 pb-3">
              <div className="space-y-0.5">
                <h2 className="text-sm font-extrabold text-text flex items-center gap-2">
                  <StoreIcon className="size-4 text-action" />
                  <span>{t("ev.vendors")}</span>
                </h2>
                <p className="text-xs text-text-muted">{t("ev.refusalEffect")}</p>
              </div>
              <Badge tone="neutral">{loaderData.vendors.length}</Badge>
            </div>

            {loaderData.vendors.length === 0 ? (
              <p className="text-xs text-text-muted py-4 text-center">{t("ve.none")}</p>
            ) : (
              <div className="rounded-xl border border-border/80 bg-surface shadow-sm overflow-hidden divide-y divide-border/50">
                {(loaderData.vendors as VendorRow[]).map((v) => (
                  <div
                    key={v.vendor_id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 hover:bg-surface-tint/20 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex size-9 items-center justify-center rounded-lg bg-surface border border-border text-action font-black text-xs shadow-sm">
                        <StoreIcon className="size-4" />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-text">
                          {en ? v.store_en : v.store_ar}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <Badge
                        tone={
                          v.status === "refused"
                            ? "danger"
                            : v.status === "accepted"
                            ? "success"
                            : "neutral"
                        }
                        dot
                      >
                        {t(`ev.v_${v.status}`)}
                      </Badge>

                      <fetcher.Form method="post" className="flex items-center gap-2">
                        <input type="hidden" name="intent" value="vendor_status" />
                        <input type="hidden" name="event_id" value={ev.id} />
                        <input type="hidden" name="vendor_id" value={v.vendor_id} />

                        {v.status === "refused" ? (
                          <>
                            <input type="hidden" name="status" value="accepted" />
                            <Button
                              type="submit"
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              className="cursor-pointer"
                            >
                              <CheckIcon className="size-3.5" />
                              {t("ev.accept")}
                            </Button>
                          </>
                        ) : (
                          <>
                            <input type="hidden" name="status" value="refused" />
                            <input
                              name="reason"
                              required
                              minLength={3}
                              placeholder={t("wd.reason")}
                              className="rounded-lg border border-border bg-surface px-2.5 py-1 text-xs text-text shadow-sm focus:border-action focus:outline-none w-36"
                            />
                            <Button
                              type="submit"
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              className="cursor-pointer text-danger hover:bg-danger-soft"
                            >
                              {t("ev.refuse")}
                            </Button>
                          </>
                        )}
                      </fetcher.Form>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <p className="text-xs text-text-faint">
            <a href={`/${lang}/admin/vendors`} className="font-bold text-action hover:underline">
              {t("ev.manualHideLink")}
            </a>
          </p>
        </div>
      )}

      {/* Create Event Dialog */}
      <Dialog open={creating} onClose={() => setCreating(false)} title={t("ev.createTitle")}>
        <fetcher.Form
          method="post"
          className="flex flex-col gap-4"
          onSubmit={() => setCreating(false)}
        >
          <input type="hidden" name="intent" value="create" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input id="ev-nar" label={t("pn.nameAr")} name="name_ar" required inputClassName="bg-surface" />
            <Input id="ev-nen" label={t("pn.nameEn")} name="name_en" dir="ltr" inputClassName="bg-surface" />
            <Input id="ev-start" label={t("ev.startsAt")} name="starts_at" type="date" required inputClassName="bg-surface" />
            <Input id="ev-end" label={t("ev.endsAt")} name="ends_at" type="date" required inputClassName="bg-surface" />
          </div>
          <div className="flex justify-end gap-2 border-t border-border/40 pt-3">
            <Button type="button" variant="outline" onClick={() => setCreating(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" loading={busy}>
              {t("common.save")}
            </Button>
          </div>
        </fetcher.Form>
      </Dialog>
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

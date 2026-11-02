import { data, useFetcher } from "react-router";
import type { Route } from "./+types/ads";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { formatPiastres } from "~/lib/money";
import { Button } from "~/components/ui/Button";
import { Badge } from "~/components/ui/Badge";
import { TagIcon, StoreIcon, CheckIcon, CashIcon, PlusIcon } from "~/components/ui/icons";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonTable } from "~/components/ui/Skeleton";


/**
 * A-20 — Ads (US-10 / AGENT §19): packages CRUD + campaigns list + admin
 * grant (source=admin_grant, NO payment — single mechanism with paid).
 */

interface PkgRow {
  id: string; name_ar: string; name_en: string; placement: string;
  duration_days: number; price_piastres: number; visibility: string;
  slots: number; is_active: boolean;
}
interface CampRow {
  id: string; source: string; status: string; ends_at: string;
  vendor_ar: string; vendor_en: string; pkg_ar: string; pkg_en: string;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const [pkgs, camps] = await Promise.all([
    client.from("ad_packages").select("*").order("created_at"),
    client.from("ad_campaigns").select(`id, source, status, ends_at,
      vendors(store_name_ar, store_name_en), ad_packages(name_ar, name_en)`)
      .order("created_at", { ascending: false }).limit(50),
  ]);
  if (pkgs.error) throw new Error(pkgs.error.message);
  const campRows: CampRow[] = ((camps.data ?? []) as unknown as Array<Record<string, unknown>>).map((c) => {
    const v = c.vendors as { store_name_ar: string; store_name_en: string } | null;
    const p = c.ad_packages as { name_ar: string; name_en: string } | null;
    return {
      id: c.id as string, source: c.source as string, status: c.status as string,
      ends_at: c.ends_at as string,
      vendor_ar: v?.store_name_ar ?? "", vendor_en: v?.store_name_en ?? "",
      pkg_ar: p?.name_ar ?? "", pkg_en: p?.name_en ?? "",
    };
  });
  return {
    lang, packages: JSON.parse(JSON.stringify(pkgs.data ?? [])) as PkgRow[],
    campaigns: JSON.parse(JSON.stringify(campRows)),
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "pkg_save") {
    const id = String(form.get("id") ?? "");
    const payload = {
      name_ar: String(form.get("name_ar") ?? "").trim(),
      name_en: String(form.get("name_en") ?? "").trim(),
      placement: String(form.get("placement") ?? "featured_product"),
      duration_days: Math.max(1, Math.trunc(Number(form.get("duration_days") ?? 7))),
      price_piastres: Math.max(0, Math.trunc(Number(form.get("price_piastres") ?? 0))),
      visibility: String(form.get("visibility") ?? "vendors"),
      slots: Math.max(1, Math.trunc(Number(form.get("slots") ?? 1))),
      is_active: form.get("is_active") === "on",
    };
    if (!payload.name_ar || !payload.name_en) return data({ ok: false, reason: "name_required" }, { status: 400 });
    if (id) {
      const { error } = await client.from("ad_packages").update(payload).eq("id", id);
      if (error) return data({ ok: false, reason: error.message }, { status: 400 });
      await client.rpc("fn_audit", { p_action: "ad_package.updated", p_entity: "ad_packages", p_entity_id: id, p_before: null, p_after: payload });
    } else {
      const { data: row, error } = await client.from("ad_packages").insert(payload).select("id").single();
      if (error) return data({ ok: false, reason: error.message }, { status: 400 });
      await client.rpc("fn_audit", { p_action: "ad_package.created", p_entity: "ad_packages", p_entity_id: (row as { id: string }).id, p_before: null, p_after: payload });
    }
    return { ok: true as const };
  }

  if (intent === "grant") {
    const res = await client.rpc("fn_admin_grant_ad", {
      p_vendor_id: String(form.get("vendor_id") ?? ""),
      p_package_id: String(form.get("package_id") ?? ""),
      p_days: Number(form.get("days") ?? 0) || null,
    });
    if (res.error) return data({ ok: false, reason: res.error.message }, { status: 500 });
    const r = res.data as { ok: boolean; reason?: string };
    return r.ok ? { ok: true as const } : data({ ok: false, reason: r.reason }, { status: 400 });
  }
  return data({ ok: false, reason: "bad_intent" }, { status: 400 });
}

const PLACEMENTS = ["hero_banner", "footer_banner", "featured_product"] as const;

export default function AdminAds({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const money = (p: number) => formatPiastres(p, en ? "en" : "ar");
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col gap-3 rounded-xl border border-border/80 bg-surface p-4 sm:p-6 shadow-sm md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-black text-text">{t("ad.title")}</h1>
            <Badge tone="featured" dot>{loaderData.packages.length} باقات</Badge>
            <Badge tone="neutral">{loaderData.campaigns.length} حملات نشطة</Badge>
          </div>
          <p className="text-xs text-text-muted">
            إدارة باقات الإعلانات المميزة وتخصيص الحملات والمنح الإدارية للتجار
          </p>
        </div>
      </div>

      {/* Packages Section */}
      <section className="space-y-4" aria-label={t("ad.packages")}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-extrabold text-text flex items-center gap-2">
            <TagIcon className="size-4 text-action" />
            <span>{t("ad.packages")}</span>
          </h2>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {(loaderData.packages as PkgRow[]).map((p) => (
            <div key={p.id} className="rounded-xl border border-border/80 bg-surface p-4 sm:p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-border/50 pb-3">
                <div>
                  <h3 className="text-sm font-black text-text">
                    {en ? p.name_en : p.name_ar}
                  </h3>
                  <span className="text-2xs font-mono text-text-muted">
                    {t(`ad.place_${p.placement}`)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-action text-sm" dir="ltr">
                    {money(p.price_piastres)}
                  </span>
                  <Badge tone={p.is_active ? "success" : "neutral"} dot>
                    {p.is_active ? t("pn.active") : t("cu.blocked")}
                  </Badge>
                </div>
              </div>

              <fetcher.Form method="post" className="space-y-3">
                <input type="hidden" name="intent" value="pkg_save" />
                <input type="hidden" name="id" value={p.id} />

                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 text-xs">
                  <label className="flex flex-col gap-1 font-bold text-text">
                    {t("pn.nameAr")}
                    <input
                      name="name_ar"
                      defaultValue={p.name_ar}
                      className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-text shadow-sm focus:border-action focus:outline-none"
                    />
                  </label>

                  <label className="flex flex-col gap-1 font-bold text-text">
                    {t("pn.nameEn")}
                    <input
                      name="name_en"
                      defaultValue={p.name_en}
                      dir="ltr"
                      className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-text shadow-sm focus:border-action focus:outline-none"
                    />
                  </label>

                  <label className="flex flex-col gap-1 font-bold text-text">
                    {t("ad.placement")}
                    <select
                      name="placement"
                      defaultValue={p.placement}
                      className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-text shadow-sm focus:border-action focus:outline-none"
                    >
                      {PLACEMENTS.map((pl) => (
                        <option key={pl} value={pl}>
                          {t(`ad.place_${pl}`)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="flex flex-col gap-1 font-bold text-text">
                    {t("ad.days")}
                    <input
                      name="duration_days"
                      type="number"
                      min={1}
                      defaultValue={p.duration_days}
                      dir="ltr"
                      className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-mono text-text shadow-sm focus:border-action focus:outline-none"
                    />
                  </label>

                  <label className="flex flex-col gap-1 font-bold text-text">
                    {t("ad.price")} (قروش)
                    <input
                      name="price_piastres"
                      type="number"
                      min={0}
                      defaultValue={p.price_piastres}
                      dir="ltr"
                      className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-mono text-text shadow-sm focus:border-action focus:outline-none"
                    />
                  </label>

                  <label className="flex flex-col gap-1 font-bold text-text">
                    {t("ad.slots")}
                    <input
                      name="slots"
                      type="number"
                      min={1}
                      defaultValue={p.slots}
                      dir="ltr"
                      className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-mono text-text shadow-sm focus:border-action focus:outline-none"
                    />
                  </label>
                </div>

                <div className="flex items-center justify-between border-t border-border/40 pt-3">
                  <label className="flex items-center gap-2 text-xs font-bold text-text cursor-pointer">
                    <input
                      type="checkbox"
                      name="is_active"
                      defaultChecked={p.is_active}
                      className="size-4 rounded border-border accent-action cursor-pointer"
                    />
                    {t("pn.active")}
                  </label>

                  <Button type="submit" size="sm" disabled={busy} className="cursor-pointer">
                    <CheckIcon className="size-3.5" />
                    {t("ve.save")}
                  </Button>
                </div>
              </fetcher.Form>
            </div>
          ))}
        </div>

        {/* New Package Card */}
        <details className="rounded-xl border border-border/80 bg-surface shadow-sm overflow-hidden">
          <summary className="cursor-pointer px-4 sm:px-6 py-3.5 text-xs font-bold text-action hover:bg-surface-tint/50 flex items-center gap-1.5">
            <PlusIcon className="size-4" />
            <span>{t("ad.newPkg")}</span>
          </summary>
          <div className="p-4 sm:p-6 border-t border-border/50 bg-surface-tint/10">
            <fetcher.Form method="post" className="space-y-4">
              <input type="hidden" name="intent" value="pkg_save" />

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 text-xs">
                <label className="flex flex-col gap-1 font-bold text-text">
                  {t("pn.nameAr")}
                  <input
                    name="name_ar"
                    required
                    className="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text shadow-sm focus:border-action focus:outline-none"
                  />
                </label>

                <label className="flex flex-col gap-1 font-bold text-text">
                  {t("pn.nameEn")}
                  <input
                    name="name_en"
                    required
                    dir="ltr"
                    className="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text shadow-sm focus:border-action focus:outline-none"
                  />
                </label>

                <label className="flex flex-col gap-1 font-bold text-text">
                  {t("ad.placement")}
                  <select
                    name="placement"
                    className="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text shadow-sm focus:border-action focus:outline-none"
                  >
                    {PLACEMENTS.map((pl) => (
                      <option key={pl} value={pl}>
                        {t(`ad.place_${pl}`)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1 font-bold text-text">
                  {t("ad.days")}
                  <input
                    name="duration_days"
                    type="number"
                    min={1}
                    defaultValue={7}
                    dir="ltr"
                    className="rounded-lg border border-border bg-surface px-3 py-2 text-xs font-mono text-text shadow-sm focus:border-action focus:outline-none"
                  />
                </label>

                <label className="flex flex-col gap-1 font-bold text-text">
                  {t("ad.price")} (قروش)
                  <input
                    name="price_piastres"
                    type="number"
                    min={0}
                    defaultValue={0}
                    dir="ltr"
                    className="rounded-lg border border-border bg-surface px-3 py-2 text-xs font-mono text-text shadow-sm focus:border-action focus:outline-none"
                  />
                </label>

                <input type="hidden" name="visibility" value="vendors" />
                <input type="hidden" name="slots" value="1" />
                <input type="hidden" name="is_active" value="on" />
              </div>

              <div className="flex justify-end">
                <Button type="submit" size="sm" disabled={busy} className="cursor-pointer">
                  {t("cp.create")}
                </Button>
              </div>
            </fetcher.Form>
          </div>
        </details>
      </section>

      {/* Admin Grant Section */}
      <section className="rounded-xl border border-border/80 border-t-4 border-t-primary bg-surface p-4 sm:p-6 shadow-sm space-y-4" aria-label={t("ad.grant")}>
        <div className="space-y-1">
          <h2 className="text-sm font-extrabold text-text flex items-center gap-2">
            <StoreIcon className="size-4 text-action" />
            <span>{t("ad.grant")}</span>
          </h2>
          <p className="text-xs text-text-muted">
            منح باقة إعلانية لمتجر تاجر مباشرة بدون دفع (حملة مصدرها admin_grant)
          </p>
        </div>

        <fetcher.Form method="post" className="flex flex-wrap items-end gap-3 text-xs">
          <input type="hidden" name="intent" value="grant" />

          <label className="flex flex-col gap-1 font-bold text-text min-w-[200px] flex-1">
            {t("lv.vendorId")} (معرف التاجر)
            <input
              name="vendor_id"
              required
              dir="ltr"
              placeholder="e.g. 550e8400-e29b-41d4-a716-446655440000"
              className="rounded-lg border border-border bg-surface px-3 py-2 text-xs font-mono text-text shadow-sm focus:border-action focus:outline-none"
            />
          </label>

          <label className="flex flex-col gap-1 font-bold text-text min-w-[160px]">
            {t("ad.pkg")}
            <select
              name="package_id"
              className="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text shadow-sm focus:border-action focus:outline-none"
            >
              {(loaderData.packages as PkgRow[]).filter((p) => p.is_active).map((p) => (
                <option key={p.id} value={p.id}>
                  {en ? p.name_en : p.name_ar}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 font-bold text-text w-24">
            {t("ad.days")}
            <input
              name="days"
              type="number"
              min={1}
              dir="ltr"
              placeholder="افتراضي"
              className="rounded-lg border border-border bg-surface px-3 py-2 text-xs font-mono text-text shadow-sm focus:border-action focus:outline-none"
            />
          </label>

          <Button type="submit" size="sm" disabled={busy} className="cursor-pointer shrink-0">
            {t("ad.grantBtn")}
          </Button>
        </fetcher.Form>

        {fetcher.data && !fetcher.data.ok ? (
          <p role="alert" className="text-xs font-bold text-danger">
            {String(fetcher.data.reason)}
          </p>
        ) : null}
      </section>

      {/* Campaigns List */}
      <section className="space-y-3" aria-label={t("ad.campaigns")}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-extrabold text-text flex items-center gap-2">
            <CashIcon className="size-4 text-action" />
            <span>{t("ad.campaigns")}</span>
          </h2>
          <Badge tone="neutral">{loaderData.campaigns.length}</Badge>
        </div>

        {loaderData.campaigns.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-surface p-8 text-center text-xs text-text-muted">
            {t("ve.none")}
          </div>
        ) : (
          <div className="rounded-xl border border-border/80 bg-surface shadow-sm overflow-hidden divide-y divide-border/50">
            {(loaderData.campaigns as CampRow[]).map((c) => (
              <div key={c.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 hover:bg-surface-tint/20 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-surface border border-border text-action font-black text-xs shadow-sm">
                    <StoreIcon className="size-4" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-text leading-tight">
                      {en ? c.vendor_en : c.vendor_ar}
                    </p>
                    <p className="text-2xs text-text-muted mt-0.5">
                      الباقة: {en ? c.pkg_en : c.pkg_ar}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge tone={c.source === "admin_grant" ? "info" : "success"} dot>
                    {t(`ads.source_${c.source}`)}
                  </Badge>

                  <Badge tone={c.status === "active" ? "success" : "neutral"} dot>
                    {t(`ad.camp_${c.status}`)}
                  </Badge>

                  <span className="text-2xs font-mono text-text-muted" dir="ltr">
                    ينتهي: {c.ends_at.slice(0, 10)}
                  </span>
                </div>
              </div>
            ))}
          </div>
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
  return <SkeletonTable />;
}

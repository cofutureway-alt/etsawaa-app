import { data, useFetcher } from "react-router";
import type { Route } from "./+types/zones";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { formatPiastres } from "~/lib/money";
import { Button } from "~/components/ui/Button";
import { Badge } from "~/components/ui/Badge";
import { Dialog } from "~/components/ui/Overlay";
import { EmptyState } from "~/components/ui/EmptyState";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonTable } from "~/components/ui/Skeleton";


/**
 * A-35/A-36 — Shipping zones (US-16/17/18/19): governorates CRUD +
 * per-governorate areas CRUD + CSV areas import (idempotent via
 * fn_admin_import_areas). Referenced rows are DISABLED, never hard-deleted
 * (US-17); existing orders keep their snapshots (US-19). Every change audited.
 */

interface GovRow {
  id: number; name_ar: string; name_en: string;
  shipping_fee_piastres: number; is_active: boolean; sort: number;
  areas_count: number;
}
interface AreaRow {
  id: number; name_ar: string; name_en: string;
  pickup_fee_piastres: number; is_active: boolean;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const govId = Number(new URL(request.url).searchParams.get("gov") ?? 0) || null;

  const [{ data: govs }, countsRes] = await Promise.all([
    client.from("governorates").select("*").order("sort"),
    client.from("areas").select("governorate_id"),
  ]);
  if (govs === null) throw new Error("governorates unavailable");
  const counts = new Map<number, number>();
  for (const a of (countsRes.data ?? []) as Array<{ governorate_id: number }>) {
    counts.set(a.governorate_id, (counts.get(a.governorate_id) ?? 0) + 1);
  }
  let areas: AreaRow[] = [];
  if (govId) {
    const { data: ar } = await client.from("areas").select("*").eq("governorate_id", govId).order("sort");
    areas = (ar ?? []) as unknown as AreaRow[];
  }
  const govRows: GovRow[] = (govs as unknown as Array<Record<string, unknown>>).map((g) => ({
    id: g.id as number, name_ar: g.name_ar as string, name_en: g.name_en as string,
    shipping_fee_piastres: g.shipping_fee_piastres as number,
    is_active: g.is_active as boolean, sort: g.sort as number,
    areas_count: counts.get(g.id as number) ?? 0,
  }));
  return {
    lang, govs: JSON.parse(JSON.stringify(govRows)),
    govId, areas: JSON.parse(JSON.stringify(areas)),
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const audit = (act: string, id: string, after: unknown) =>
    client.rpc("fn_audit", { p_action: act, p_entity: "geo", p_entity_id: id, p_before: null, p_after: after });

  if (intent === "gov_save") {
    const id = Number(form.get("id") ?? 0) || null;
    const fee = Math.max(0, Math.trunc(Number(form.get("fee_piastres") ?? 0)));
    if (fee < 0) return data({ ok: false, reason: "bad_fee" }, { status: 400 });
    const payload = {
      shipping_fee_piastres: fee,
      is_active: form.get("is_active") === "on",
      sort: Math.max(0, Math.trunc(Number(form.get("sort") ?? 0))),
    };
    const { error } = id
      ? await client.from("governorates").update(payload).eq("id", id)
      : await client.from("governorates").insert({
          ...payload,
          id: Number(form.get("new_id") ?? 0) || undefined,
          name_ar: String(form.get("name_ar") ?? "").trim(),
          name_en: String(form.get("name_en") ?? "").trim(),
        });
    if (error) return data({ ok: false, reason: error.message }, { status: 400 });
    await audit("gov.updated", String(id ?? form.get("new_id")), payload);
    return { ok: true as const };
  }

  if (intent === "area_save") {
    const govId = Number(form.get("governorate_id") ?? 0);
    const id = Number(form.get("id") ?? 0) || null;
    const feeRaw = String(form.get("pickup_fee_piastres") ?? "");
    const payload: Record<string, unknown> = {
      name_ar: String(form.get("name_ar") ?? "").trim(),
      name_en: String(form.get("name_en") ?? "").trim(),
      is_active: form.get("is_active") === "on",
    };
    if (feeRaw !== "") {
      const fee = Math.trunc(Number(feeRaw));
      if (Number.isNaN(fee) || fee < 0) return data({ ok: false, reason: "bad_fee" }, { status: 400 });
      payload.pickup_fee_piastres = fee;
    }
    if (id) {
      const { error } = await client.from("areas").update(payload).eq("id", id);
      if (error) return data({ ok: false, reason: error.message }, { status: 400 });
      await audit("area.updated", String(id), payload);
    } else {
      const { data: maxSort } = await client.from("areas").select("sort").eq("governorate_id", govId).order("sort", { ascending: false }).limit(1);
      const { error } = await client.from("areas").insert({
        governorate_id: govId,
        sort: (((maxSort?.[0] as { sort: number } | undefined)?.sort) ?? 0) + 1,
        ...payload,
      });
      if (error) return data({ ok: false, reason: error.message }, { status: 400 });
      await audit("area.created", String(govId), payload);
    }
    return { ok: true as const };
  }

  if (intent === "area_disable" || intent === "area_enable") {
    const id = Number(form.get("id") ?? 0);
    // US-17: rows referenced by vendors/orders are DISABLED, never deleted
    const { error } = await client.from("areas").update({ is_active: intent === "area_enable" }).eq("id", id);
    if (error) return data({ ok: false, reason: error.message }, { status: 400 });
    await audit(intent === "area_disable" ? "area.disabled" : "area.enabled", String(id), {});
    return { ok: true as const };
  }

  if (intent === "import") {
    // CSV rows: governorate_id,name_ar,name_en,pickup_fee_piastres
    const csv = String(form.get("csv") ?? "").trim();
    if (!csv) return data({ ok: false, reason: "empty" }, { status: 400 });
    const rows: Array<Record<string, string>> = [];
    for (const line of csv.split(/\r?\n/).filter(Boolean)) {
      const parts = line.split(",").map((x) => x.trim());
      rows.push({
        governorate_id: parts[0] ?? "",
        name_ar: parts[1] ?? "",
        name_en: parts[2] ?? "",
        pickup_fee_piastres: parts[3] ?? "",
      });
    }
    const res = await client.rpc("fn_admin_import_areas", { p_rows: rows });
    if (res.error) return data({ ok: false, reason: res.error.message }, { status: 500 });
    const r = res.data as { ok: boolean; created?: number; updated?: number; errors?: unknown[] };
    return { ok: true as const, created: r.created, updated: r.updated, errors: r.errors?.length ?? 0 };
  }

  return data({ ok: false, reason: "bad_intent" }, { status: 400 });
}

export default function AdminZones({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const money = (p: number) => formatPiastres(p, en ? "en" : "ar");
  const fetcher = useFetcher<typeof action>();
  const [importOpen, setImportOpen] = useState(false);
  const [csv, setCsv] = useState("");
  const busy = fetcher.state !== "idle";
  const [creatingGov, setCreatingGov] = useState(false);
  const nextGovId = Math.max(0, ...(loaderData.govs as GovRow[]).map((g) => g.id)) + 1;
  const selected = (loaderData.govs as GovRow[]).find((g) => g.id === loaderData.govId);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-extrabold text-text">{t("z.title")}</h1>
        <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>{t("z.import")}</Button>
      </div>

      {/* governorates — inline edit (fee ≥ 0, audited) */}
      <section className="mt-3" aria-label={t("z.governorates")}>
        <div className="flex items-center justify-between gap-2">
          {/* heading used to hardcode "(27)" — it now reflects the real count */}
          <h2 className="text-sm font-extrabold text-text">
            {t("z.governorates")} ({(loaderData.govs as GovRow[]).length})
          </h2>
          <Button type="button" size="sm" onClick={() => setCreatingGov((v) => !v)}>
            {creatingGov ? t("common.cancel") : t("z.newGov")}
          </Button>
        </div>

        {creatingGov ? (
          <fetcher.Form method="post" className="mt-2 flex flex-wrap items-end gap-2 rounded-md border border-action/40 bg-surface-tint p-3 text-[13px]">
            <input type="hidden" name="intent" value="gov_save" />
            <label className="flex flex-col gap-1 text-xs font-bold text-text">
              {t("z.id")}
              <input name="new_id" type="number" required min={1} dir="ltr" defaultValue={nextGovId}
                className="w-16 rounded-md border border-border bg-surface px-2 py-1.5" />
            </label>
            <label className="flex flex-col gap-1 text-xs font-bold text-text">
              {t("z.nameAr")}
              <input name="name_ar" required className="w-32 rounded-md border border-border bg-surface px-2 py-1.5" />
            </label>
            <label className="flex flex-col gap-1 text-xs font-bold text-text">
              {t("z.nameEn")}
              <input name="name_en" required dir="ltr" className="w-32 rounded-md border border-border bg-surface px-2 py-1.5" />
            </label>
            <label className="flex flex-col gap-1 text-xs font-bold text-text">
              {t("z.shippingFee")}
              <input name="fee_piastres" type="number" min={0} defaultValue={0} dir="ltr" className="w-24 rounded-md border border-border bg-surface px-2 py-1.5" />
            </label>
            <Button type="submit" size="sm" disabled={busy}>{t("z.createGov")}</Button>
          </fetcher.Form>
        ) : null}
        <div className="mt-2 overflow-x-auto rounded-md border border-border">
          <table className="w-full text-[13px]">
            <thead className="bg-surface-tint">
              <tr>
                <th className="p-2 text-start font-bold">#</th>
                <th className="p-2 text-start font-bold">{t("z.nameAr")} / {t("z.nameEn")}</th>
                <th className="p-2 text-start font-bold">{t("z.shippingFee")}</th>
                <th className="p-2 text-start font-bold">{t("z.areas")}</th>
                <th className="p-2 text-start font-bold">{t("wd.status")}</th>
              </tr>
            </thead>
            <tbody>
              {(loaderData.govs as GovRow[]).map((g) => (
                <tr key={g.id} className="border-t border-border/60">
                  <td className="p-2 num" dir="ltr">{g.id}</td>
                  <td className="p-1.5">
                    <fetcher.Form method="post" className="flex flex-wrap items-center gap-1.5">
                      <input type="hidden" name="intent" value="gov_save" />
                      <input type="hidden" name="id" value={g.id} />
                      <input name="name_ar" aria-label={t("z.nameAr")} defaultValue={g.name_ar} className="w-28 rounded-md border border-border bg-surface px-2 py-1" />
                      <input name="name_en" aria-label={t("z.nameEn")} defaultValue={g.name_en} dir="ltr" className="w-28 rounded-md border border-border bg-surface px-2 py-1" />
                      <input name="fee_piastres" type="number" min={0} aria-label={t("z.shippingFee")} defaultValue={g.shipping_fee_piastres} dir="ltr" className="w-20 rounded-md border border-border bg-surface px-2 py-1 num" />
                      <input name="sort" type="number" aria-label={t("bn.order")} defaultValue={g.sort} dir="ltr" className="w-14 rounded-md border border-border bg-surface px-2 py-1 num" />
                      <label className="flex items-center gap-1 text-xs font-bold text-text">
                        <input type="checkbox" name="is_active" defaultChecked={g.is_active} className="size-4 accent-[var(--color-action)]" />
                        {t("pn.active")}
                      </label>
                      <button type="submit" className="cursor-pointer rounded-md border border-border px-2.5 py-1 font-bold text-text hover:bg-surface-tint">{t("ve.save")}</button>
                      <span className="num tabular-nums text-xs text-text-muted" dir="ltr">{money(g.shipping_fee_piastres)}</span>
                    </fetcher.Form>
                  </td>
                  <td className="p-2" />
                  <td className="p-2">
                    <a href={`?gov=${g.id}`} className="font-bold text-primary hover:underline num" dir="ltr">{g.areas_count}</a>
                  </td>
                  <td className="p-2"><Badge tone={g.is_active ? "success" : "neutral"}>{g.is_active ? t("cu.active") : t("cu.blocked")}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-xs text-text-muted">{t("z.disableOnly")} · {t("z.snapshotNote")}</p>
      </section>

      {/* areas of the selected governorate */}
      {selected ? (
        <section className="mt-5" aria-label={t("z.areasOf", { name: en ? selected.name_en : selected.name_ar })}>
          <h2 className="text-sm font-extrabold text-text">{t("z.areasOf", { name: en ? selected.name_en : selected.name_ar })}</h2>
          {loaderData.areas.length === 0 ? (
            <div className="mt-2"><EmptyState title={t("z.noAreas")} body={t("z.importHint")} /></div>
          ) : (
            <ul className="mt-2 flex flex-col divide-y divide-border rounded-md border border-border bg-surface">
              {(loaderData.areas as AreaRow[]).map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-2 p-2.5 text-[13px]">
                  <fetcher.Form method="post" className="flex flex-wrap items-center gap-1.5">
                    <input type="hidden" name="intent" value="area_save" />
                    <input type="hidden" name="id" value={a.id} />
                    <input type="hidden" name="governorate_id" value={selected.id} />
                    <input name="name_ar" aria-label={t("z.nameAr")} defaultValue={a.name_ar} className="w-36 rounded-md border border-border bg-surface px-2 py-1" />
                    <input name="name_en" aria-label={t("z.nameEn")} defaultValue={a.name_en} dir="ltr" className="w-36 rounded-md border border-border bg-surface px-2 py-1" />
                    <input name="pickup_fee_piastres" type="number" min={0} aria-label={t("rf.amount")} defaultValue={a.pickup_fee_piastres} dir="ltr" className="w-20 rounded-md border border-border bg-surface px-2 py-1 num" />
                    <label className="flex items-center gap-1 text-xs font-bold text-text">
                      <input type="checkbox" name="is_active" defaultChecked={a.is_active} className="size-4 accent-[var(--color-action)]" />
                      {t("pn.active")}
                    </label>
                    <button type="submit" className="cursor-pointer rounded-md border border-border px-2.5 py-1 font-bold text-text hover:bg-surface-tint">{t("ve.save")}</button>
                  </fetcher.Form>
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value={a.is_active ? "area_disable" : "area_enable"} />
                    <input type="hidden" name="id" value={a.id} />
                    <button type="submit" className="cursor-pointer rounded-md border border-border px-2.5 py-1 font-bold text-text hover:bg-surface-tint">
                      {a.is_active ? t("z.disable") : t("z.enable")}
                    </button>
                  </fetcher.Form>
                  <Badge tone={a.is_active ? "success" : "neutral"}>{a.is_active ? t("cu.active") : t("cu.blocked")}</Badge>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {/* CSV import dialog — idempotent via fn_admin_import_areas */}
      <Dialog open={importOpen} onClose={() => setImportOpen(false)} title={t("z.importTitle")}>
        <fetcher.Form method="post" onSubmit={(e) => { if (!csv.trim()) e.preventDefault(); }}>
          <input type="hidden" name="intent" value="import" />
          <label htmlFor="z-csv" className="text-[13px] font-bold text-text">{t("z.csvLabel")}</label>
          <textarea id="z-csv" rows={8} value={csv} onChange={(e) => setCsv(e.target.value)} dir="ltr"
            placeholder={"1,مدينة نصر,Nasr City,700\n1,العجوزة,Agouza,600"}
            className="mt-1 w-full rounded-md border border-border bg-surface p-2.5 font-mono text-xs text-text" />
          <p className="mt-1 text-xs text-text-muted">{t("z.importRules")}</p>
          {fetcher.data && fetcher.data.ok ? (
            <p className="mt-1 text-xs font-bold text-success-strong">
              {t("z.importDone", {
                created: ("created" in fetcher.data ? fetcher.data.created : 0) ?? 0,
                updated: ("updated" in fetcher.data ? fetcher.data.updated : 0) ?? 0,
                errors: ("errors" in fetcher.data ? fetcher.data.errors : 0) ?? 0,
              })}
            </p>
          ) : null}
          {fetcher.data && !fetcher.data.ok ? (
            <p role="alert" className="mt-1 text-xs font-bold text-danger">{String(fetcher.data.reason)}</p>
          ) : null}
          <div className="mt-3 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setImportOpen(false)}>{t("common.cancel")}</Button>
            <Button type="submit" disabled={busy || !csv.trim()}>{t("z.importRun")}</Button>
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

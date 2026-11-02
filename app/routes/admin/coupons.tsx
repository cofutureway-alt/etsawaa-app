import { data, useFetcher } from "react-router";
import type { Route } from "./+types/coupons";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { formatPiastres } from "~/lib/money";
import { Button } from "~/components/ui/Button";
import { Dialog } from "~/components/ui/Overlay";
import { Badge } from "~/components/ui/Badge";
import { EmptyState } from "~/components/ui/EmptyState";
import { DataTable } from "~/components/ui/DataTable";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonTable } from "~/components/ui/Skeleton";
import { parseScopes, scopeConflict, type CouponScope } from "~/features/settings/coupon-scopes";


/**
 * A-12 — Coupons (US-07): list + full form. Types: percent | fixed |
 * commission_percent (AGENT §31) + stackable + pairs_with + free shipping +
 * limits/scopes/validity. Scopes are kept simple here: free_shipping +
 * global scope (targeted scopes arrive with the marketing pass — the engine
 * already reads them from coupon_scopes).
 */

interface CouponRow {
  id: string; code: string; type: string; value: number;
  free_shipping: boolean; stackable: boolean; exclude_sale_items: boolean;
  min_subtotal_piastres: number; max_discount_piastres: number | null;
  max_uses_per_user: number | null;
  status: string; max_uses_total: number | null; used: number;
  starts_at: string | null; ends_at: string | null;
  pairs_with: string | null;
  scopes: CouponScope[];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  // RLS: coupons_admin_all (ALL for admins). count uses coupon_redemptions.
  const { data: rows, error } = await client
    .from("coupons")
    .select("id, code, type, value, free_shipping, stackable, exclude_sale_items, min_subtotal_piastres, max_discount_piastres, max_uses_per_user, pairs_with, status, max_uses_total, starts_at, ends_at, coupon_scopes(mode, scope, ref_id), coupon_redemptions(count)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  const coupons: CouponRow[] = ((rows ?? []) as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string, code: r.code as string, type: r.type as string, value: r.value as number,
    free_shipping: (r.free_shipping as boolean) ?? false,
    stackable: (r.stackable as boolean) ?? false,
    status: r.status as string,
    max_uses_total: (r.max_uses_total as number | null) ?? null,
    used: ((r.coupon_redemptions as Array<{ count: number }> | null) ?? []).reduce((s, x) => s + (x.count ?? 0), 0),
    starts_at: (r.starts_at as string | null) ?? null,
    ends_at: (r.ends_at as string | null) ?? null,
    exclude_sale_items: (r.exclude_sale_items as boolean) ?? false,
    min_subtotal_piastres: (r.min_subtotal_piastres as number) ?? 0,
    max_discount_piastres: (r.max_discount_piastres as number | null) ?? null,
    max_uses_per_user: (r.max_uses_per_user as number | null) ?? null,
    pairs_with: (r.pairs_with as string | null) ?? null,
    scopes: ((r.coupon_scopes as Array<{ mode: string; scope: string; ref_id: string }> | null) ?? [])
      .map((x) => ({ mode: x.mode as CouponScope["mode"], scope: x.scope as CouponScope["scope"], ref_id: x.ref_id })),
  }));
  return { lang, coupons: JSON.parse(JSON.stringify(coupons)) };
}

function genCode() {
  return `ETS-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  // Shared field reader for create + update.
  const readFields = () => {
    const type = String(form.get("type") ?? "percent");
    const value = Math.trunc(Number(form.get("value") ?? 0)) || 0;
    const code = String(form.get("code") ?? "").trim().toUpperCase();
    const pairsWith = String(form.get("pairs_with") ?? "").trim().toUpperCase();
    const maxDiscount = Math.trunc(Number(form.get("max_discount_piastres") ?? 0)) || null;
    const minSubtotal = Math.trunc(Number(form.get("min_subtotal_piastres") ?? 0)) || 0;
    const maxTotal = Math.trunc(Number(form.get("max_uses_total") ?? 0)) || null;
    const maxUser = Math.trunc(Number(form.get("max_uses_per_user") ?? 0)) || null;
    const endsAt = String(form.get("ends_at") ?? "").trim();
    return {
      code, type, value, pairsWith, maxDiscount, minSubtotal, maxTotal, maxUser,
      endsAt,
      free_shipping: form.get("free_shipping") === "on",
      stackable: form.get("stackable") === "on",
      exclude_sale_items: form.get("exclude_sale") === "on",
    };
  };

  /** Rejects invalid combinations before anything is written (A-12 DoD). */
  const validate = (f: ReturnType<typeof readFields>) => {
    if (!["percent", "fixed", "commission_percent"].includes(f.type)) return "bad_type";
    if (f.value <= 0 || (f.type !== "fixed" && f.value > 100)) return "bad_value";
    if (f.code.length < 3) return "bad_code";
    if (f.minSubtotal > 0 && f.maxDiscount !== null && f.maxDiscount > f.minSubtotal) return "bad_max_discount";
    if (f.endsAt && Number.isNaN(new Date(f.endsAt).getTime())) return "bad_date";
    return null;
  };

  const writeScopes = async (couponId: string, scopes: CouponScope[]) => {
    await client.from("coupon_scopes").delete().eq("coupon_id", couponId);
    if (scopes.length === 0) return;
    await client.from("coupon_scopes").insert(
      scopes.map((sc) => ({ coupon_id: couponId, mode: sc.mode, scope: sc.scope, ref_id: sc.ref_id })),
    );
  };

  const parsedScopes = parseScopes(form);
  if (scopeConflict(parsedScopes)) {
    return data({ ok: false, reason: "scope_mixed" }, { status: 400 });
  }

  if (intent === "create") {
    const f = readFields();
    const invalid = validate(f);
    if (invalid) return data({ ok: false, reason: invalid }, { status: 400 });

    const { data: res, error } = await client.from("coupons").insert({
      code: f.code, type: f.type, value: f.value,
      free_shipping: f.free_shipping,
      stackable: f.stackable,
      pairs_with: f.type === "commission_percent" && f.pairsWith ? f.pairsWith : null,
      min_subtotal_piastres: f.minSubtotal,
      max_discount_piastres: f.maxDiscount,
      max_uses_total: f.maxTotal,
      max_uses_per_user: f.maxUser,
      exclude_sale_items: f.exclude_sale_items,
      status: "active",
      starts_at: new Date().toISOString(),
      ends_at: f.endsAt ? new Date(f.endsAt).toISOString() : null,
      created_by: (await client.auth.getUser()).data.user?.id ?? null,
    }).select("id").single();
    if (error) {
      return data({ ok: false, reason: error.code === "23505" ? "dup_code" : error.message }, { status: 400 });
    }
    const newId = (res as { id: string }).id;
    await writeScopes(newId, parsedScopes);
    await client.rpc("fn_audit", {
      p_action: "coupon.created", p_entity: "coupons", p_entity_id: newId,
      p_before: null,
      p_after: { code: f.code, type: f.type, value: f.value, stackable: f.stackable, scopes: parsedScopes },
    });
    return { ok: true as const };
  }

  if (intent === "update") {
    const id = String(form.get("id") ?? "");
    if (!id) return data({ ok: false, reason: "bad_id" }, { status: 400 });
    const f = readFields();
    const invalid = validate(f);
    if (invalid) return data({ ok: false, reason: invalid }, { status: 400 });

    // Redemptions already issued keep their recorded discount; only future
    // applications use the new numbers (A-12: used coupons don't rewrite history).
    const { error } = await client.from("coupons").update({
      code: f.code, type: f.type, value: f.value,
      free_shipping: f.free_shipping,
      stackable: f.stackable,
      pairs_with: f.type === "commission_percent" && f.pairsWith ? f.pairsWith : null,
      min_subtotal_piastres: f.minSubtotal,
      max_discount_piastres: f.maxDiscount,
      max_uses_total: f.maxTotal,
      max_uses_per_user: f.maxUser,
      exclude_sale_items: f.exclude_sale_items,
      ends_at: f.endsAt ? new Date(f.endsAt).toISOString() : null,
    }).eq("id", id);
    if (error) {
      return data({ ok: false, reason: error.code === "23505" ? "dup_code" : error.message }, { status: 400 });
    }
    await writeScopes(id, parsedScopes);
    await client.rpc("fn_audit", {
      p_action: "coupon.updated", p_entity: "coupons", p_entity_id: id,
      p_before: null,
      p_after: { code: f.code, type: f.type, value: f.value, stackable: f.stackable, scopes: parsedScopes },
    });
    return { ok: true as const };
  }

  if (intent === "toggle") {
    const id = String(form.get("id") ?? "");
    const status = String(form.get("status") ?? "") === "active" ? "disabled" : "active";
    const { error } = await client.from("coupons").update({ status }).eq("id", id);
    if (error) return data({ ok: false, reason: error.message }, { status: 400 });
    await client.rpc("fn_audit", {
      p_action: "coupon.status", p_entity: "coupons", p_entity_id: id, p_before: null, p_after: { status },
    });
    return { ok: true as const };
  }

  if (intent === "delete") {
    const id = String(form.get("id") ?? "");
    if (!id) return data({ ok: false, reason: "bad_id" }, { status: 400 });
    // Soft delete: coupons are referenced by coupon_redemptions and orders.
    const { error } = await client.from("coupons").update({ status: "disabled" }).eq("id", id);
    if (error) return data({ ok: false, reason: error.message }, { status: 400 });
    await client.rpc("fn_audit", {
      p_action: "coupon.deleted", p_entity: "coupons", p_entity_id: id, p_before: null, p_after: { status: "disabled" },
    });
    return { ok: true as const };
  }

  return data({ ok: false, reason: "bad_intent" }, { status: 400 });
}

export default function AdminCoupons({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const money = (p: number) => formatPiastres(p, en ? "en" : "ar");
  const fetcher = useFetcher<typeof action>();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CouponRow | null>(null);
  const [type, setType] = useState("percent");
  const [code, setCode] = useState("");
  const [scopes, setScopes] = useState<CouponScope[]>([]);
  const [confirmDelete, setConfirmDelete] = useState<CouponRow | null>(null);
  const busy = fetcher.state !== "idle";

  const openCreate = () => {
    setEditing(null);
    setCode(genCode());
    setType("percent");
    setScopes([]);
    setFormOpen(true);
  };
  const openEdit = (row: CouponRow) => {
    setEditing(row);
    setCode(row.code);
    setType(row.type);
    setScopes(row.scopes);
    setFormOpen(true);
  };

  return (
    <div>
      <div className="flex flex-col gap-3 rounded-xl border border-border/80 bg-surface p-4 sm:p-6 shadow-sm md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-black text-text">{t("cp.title")}</h1>
            <Badge tone="neutral" dot>{loaderData.coupons.length}</Badge>
          </div>
          <p className="text-xs text-text-muted">
            إدارة كوبونات الخصم وقسائم الشحن المجاني والتسويق
          </p>
        </div>
        <Button size="sm" onClick={openCreate} className="cursor-pointer shrink-0">
          {t("cp.new")}
        </Button>
      </div>

      {loaderData.coupons.length === 0 ? (
        <div className="mt-4"><EmptyState title={t("cp.empty")} body={t("cp.emptyHint")} /></div>
      ) : (
        <div className="mt-3">
          <DataTable<CouponRow>
            columns={[
              { key: "code", header: t("cp.code"), text: (r) => r.code, render: (r) => <span className="font-extrabold" dir="ltr">{r.code}</span> },
              { key: "type", header: t("cp.type"), text: (r) => r.type,
                render: (r) => <Badge tone={r.type === "commission_percent" ? "info" : "neutral"}>{t(`cp.type_${r.type}`)}</Badge> },
              { key: "value", header: t("cp.value"), text: (r) => String(r.value),
                render: (r) => <span dir="ltr">{r.type === "fixed" ? money(r.value) : `${r.value}%`}</span> },
              { key: "flags", header: t("cp.flags"), text: (r) => `${r.free_shipping ? "S" : ""}${r.stackable ? "+" : ""}`,
                render: (r) => (
                  <span className="flex gap-1">
                    {r.free_shipping ? <Badge tone="neutral">{t("cp.freeShip")}</Badge> : null}
                    {r.stackable ? <Badge tone="info">{t("cp.stackable")}</Badge> : null}
                  </span>
                ) },
              { key: "used", header: t("cp.used"), text: (r) => String(r.used),
                render: (r) => <span className="tabular-nums" dir="ltr">{r.used}{r.max_uses_total ? ` / ${r.max_uses_total}` : ""}</span> },
              { key: "actions", header: t("cp.actions"), text: () => "",
                render: (r) => (
                  <span className="flex items-center gap-2">
                    <button type="button" onClick={() => openEdit(r)} className="cursor-pointer text-xs font-bold text-action hover:underline">
                      {t("common.edit")}
                    </button>
                    <button type="button" onClick={() => setConfirmDelete(r)} className="cursor-pointer text-xs font-bold text-danger hover:underline">
                      {t("common.delete")}
                    </button>
                  </span>
                ) },
              { key: "status", header: t("wd.status"), text: (r) => r.status,
                render: (r) => (
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="toggle" />
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="status" value={r.status} />
                    <button type="submit" className={`cursor-pointer text-sm font-bold hover:underline ${r.status === "active" ? "text-success-strong" : "text-text-muted"}`}>
                      {t(`cp.status_${r.status}`)}
                    </button>
                  </fetcher.Form>
                ) },
            ]}
            rows={loaderData.coupons}
            searchPlaceholder={t("cp.search")}
            emptyTitle={t("cp.empty")}
            emptyBody={t("cp.emptyHint")}
            rowKey={(r) => r.id}
            cardTitle={(r) => <span dir="ltr">{r.code}</span>}
          />
        </div>
      )}

      {/* create dialog — invalid combinations blocked before save */}
      <Dialog open={formOpen} onClose={() => setFormOpen(false)} title={editing ? t("cp.editTitle") : t("cp.newTitle")}>
        <fetcher.Form method="post" onSubmit={(e) => { if (code.trim().length < 3) e.preventDefault(); }}>
          <input type="hidden" name="intent" value={editing ? "update" : "create"} />
          {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
          <label htmlFor="cp-code" className="text-sm font-bold text-text">{t("cp.code")}</label>
          <div className="mt-1 flex gap-2">
            <input id="cp-code" name="code" value={code} onChange={(e) => setCode(e.target.value)} dir="ltr" required
              className="w-40 rounded-md border border-border bg-surface p-2.5 text-sm text-text" />
            <Button type="button" size="sm" variant="ghost" onClick={() => setCode(genCode())}>{t("cp.generate")}</Button>
          </div>

          <label htmlFor="cp-type" className="mt-3 block text-sm font-bold text-text">{t("cp.type")}</label>
          <select id="cp-type" name="type" value={type} onChange={(e) => setType(e.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-surface p-2.5 text-sm text-text">
            <option value="percent">{t("cp.type_percent")}</option>
            <option value="fixed">{t("cp.type_fixed")}</option>
            <option value="commission_percent">{t("cp.type_commission_percent")}</option>
          </select>
          <p className="mt-1 text-xs text-text-muted">{t(`cp.typeHint_${type}`)}</p>

          <label htmlFor="cp-value" className="mt-3 block text-sm font-bold text-text">
            {type === "fixed" ? t("cp.valueFixed") : t("cp.valuePercent")}
          </label>
          <input id="cp-value" name="value" type="number" min={1} max={type === "fixed" ? 100000000 : 100} required dir="ltr"
            defaultValue={editing?.value}
            className="mt-1 w-32 rounded-md border border-border bg-surface p-2.5 text-sm text-text" />

          {type === "commission_percent" ? (
            <>
              <label htmlFor="cp-pairs" className="mt-3 block text-sm font-bold text-text">{t("cp.pairsWith")}</label>
              <input id="cp-pairs" name="pairs_with" dir="ltr" placeholder={t("cp.pairsPlaceholder")}
                className="mt-1 w-40 rounded-md border border-border bg-surface p-2.5 text-sm text-text" />
            </>
          ) : null}

          <fieldset className="mt-3 flex flex-col gap-1.5 text-sm text-text">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="free_shipping" defaultChecked={editing?.free_shipping} className="size-4 accent-[var(--color-action)]" />
              {t("cp.freeShip")} <span className="text-xs text-text-muted">({t("cp.adminOnly")})</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="stackable" defaultChecked={editing?.stackable} className="size-4 accent-[var(--color-action)]" />
              {t("cp.stackable")}
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="exclude_sale" defaultChecked={editing?.exclude_sale_items} className="size-4 accent-[var(--color-action)]" />
              {t("cp.excludeSale")}
            </label>
          </fieldset>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <label htmlFor="cp-min" className="text-sm font-bold text-text">{t("cp.minSubtotal")}
              <input id="cp-min" name="min_subtotal_piastres" type="number" min={0} dir="ltr" defaultValue={editing?.min_subtotal_piastres}
                className="mt-1 w-full rounded-md border border-border bg-surface p-2.5 text-sm" />
            </label>
            <label htmlFor="cp-maxd" className="text-sm font-bold text-text">{t("cp.maxDiscount")}
              <input id="cp-maxd" name="max_discount_piastres" type="number" min={1} dir="ltr" defaultValue={editing?.max_discount_piastres ?? undefined}
                className="mt-1 w-full rounded-md border border-border bg-surface p-2.5 text-sm" />
            </label>
            <label htmlFor="cp-maxt" className="text-sm font-bold text-text">{t("cp.maxTotal")}
              <input id="cp-maxt" name="max_uses_total" type="number" min={1} dir="ltr" defaultValue={editing?.max_uses_total ?? undefined}
                className="mt-1 w-full rounded-md border border-border bg-surface p-2.5 text-sm" />
            </label>
            <label htmlFor="cp-maxu" className="text-sm font-bold text-text">{t("cp.maxPerUser")}
              <input id="cp-maxu" name="max_uses_per_user" type="number" min={1} dir="ltr" defaultValue={editing?.max_uses_per_user ?? undefined}
                className="mt-1 w-full rounded-md border border-border bg-surface p-2.5 text-sm" />
            </label>
          </div>
          <label htmlFor="cp-ends" className="mt-2 block text-sm font-bold text-text">{t("cp.endsAt")}</label>
          <input id="cp-ends" name="ends_at" type="date" dir="ltr" defaultValue={editing?.ends_at?.slice(0, 10)}
            className="mt-1 w-40 rounded-md border border-border bg-surface p-2.5 text-sm text-text" />

          {/* scopes — written to coupon_scopes, which c_scope_ok reads in fn_apply_coupon */}
          <fieldset className="mt-3 rounded-md border border-border p-2.5">
            <legend className="px-1 text-sm font-bold text-text">{t("cp.scopes")}</legend>
            <p className="mb-2 text-xs text-text-muted">{t("cp.scopesHint")}</p>
            <div className="flex flex-col gap-1.5">
              {scopes.map((sc, i) => (
                <div key={`${sc.mode}-${sc.scope}-${sc.ref_id}-${i}`} className="flex items-center gap-1.5">
                  <input type="hidden" name="scope_mode" value={sc.mode} />
                  <input type="hidden" name="scope_kind" value={sc.scope} />
                  <span className="text-xs font-bold text-text">{t(`cp.mode_${sc.mode}`)}</span>
                  <span className="text-xs text-text-muted">{t(`cp.scope_${sc.scope}`)}</span>
                  <span className="flex-1 truncate font-mono text-2xs text-text-muted" dir="ltr">{sc.ref_id}</span>
                  <button type="button" onClick={() => setScopes(scopes.filter((_, j) => j !== i))}
                    className="cursor-pointer text-2xs font-bold text-danger hover:underline">{t("common.delete")}</button>
                </div>
              ))}
            </div>
            <ScopeAdder onAdd={(sc) => !scopeConflict([...scopes, sc]) && setScopes([...scopes, sc])} />
            {scopes.length > 0 && scopeConflict(scopes) ? (
              <p role="alert" className="mt-1 text-xs font-bold text-danger">{t("cp.scopeMixed")}</p>
            ) : null}
          </fieldset>

          {fetcher.data && !fetcher.data.ok ? (
            <p role="alert" className="mt-2 text-xs font-bold text-danger">
              {fetcher.data.reason === "dup_code" ? t("cp.dupCode") : String(fetcher.data.reason)}
            </p>
          ) : null}
          <div className="mt-3 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setFormOpen(false)}>{t("common.cancel")}</Button>
            <Button type="submit" disabled={busy}>{editing ? t("common.save") : t("cp.create")}</Button>
          </div>
        </fetcher.Form>
      </Dialog>

      {/* soft delete: coupons are referenced by redemptions and orders */}
      <Dialog open={confirmDelete !== null} onClose={() => setConfirmDelete(null)} title={t("cp.deleteTitle")}>
        <p className="text-sm text-text">{t("cp.deleteBody")}</p>
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDelete(null)}>{t("common.cancel")}</Button>
          <fetcher.Form method="post" onSubmit={() => setConfirmDelete(null)}>
            <input type="hidden" name="intent" value="delete" />
            <input type="hidden" name="id" value={confirmDelete?.id ?? ""} />
            <Button type="submit" disabled={busy}>{t("common.delete")}</Button>
          </fetcher.Form>
        </div>
      </Dialog>
    </div>
  );
}


/** Inline row adder for coupon scopes — keeps the form simple, no new dialog. */
function ScopeAdder({ onAdd }: { onAdd: (sc: CouponScope) => void }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<CouponScope["mode"]>("include");
  const [kind, setKind] = useState<CouponScope["scope"]>("category");
  const [ref, setRef] = useState("");
  return (
    <div className="mt-2 flex flex-wrap items-end gap-1.5">
      <select value={mode} onChange={(e) => setMode(e.target.value as CouponScope["mode"])}
        aria-label={t("cp.mode")} className="rounded-md border border-border bg-surface p-1.5 text-xs">
        <option value="include">{t("cp.mode_include")}</option>
        <option value="exclude">{t("cp.mode_exclude")}</option>
      </select>
      <select value={kind} onChange={(e) => setKind(e.target.value as CouponScope["scope"])}
        aria-label={t("cp.scope")} className="rounded-md border border-border bg-surface p-1.5 text-xs">
        {(["category", "brand", "product", "vendor"] as const).map((k) => (
          <option key={k} value={k}>{t(`cp.scope_${k}`)}</option>
        ))}
      </select>
      <input value={ref} onChange={(e) => setRef(e.target.value)} dir="ltr" placeholder={t("cp.scopeRef")}
        aria-label={t("cp.scopeRef")}
        className="w-64 rounded-md border border-border bg-surface p-1.5 font-mono text-2xs" />
      <Button type="button" size="sm" variant="ghost"
        onClick={() => { onAdd({ mode, scope: kind, ref_id: ref.trim() }); setRef(""); }}>
        {t("common.add")}
      </Button>
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

import { data, useFetcher } from "react-router";
import { useState } from "react";
import type { Route } from "./+types/penalties";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { formatPiastres } from "~/lib/money";
import { Button } from "~/components/ui/Button";
import { Badge } from "~/components/ui/Badge";
import { EmptyState } from "~/components/ui/EmptyState";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonTable } from "~/components/ui/Skeleton";
// Surfaces the action result: these pages used to discard {ok:false} and
// render nothing, so a failed write looked like a dead button.
import { useActionToast } from "~/components/layout/ActionFeedback";


/**
 * A-18 — Penalties (US-06 / AGENT §18): rules CRUD (soft delete) +
 * applications list with waive (reason required → distinct credit tx).
 * Manual apply lives on the vendor page (A-04 row action).
 */

interface RuleRow {
  id: string; key: string; name_ar: string; name_en: string; trigger_type: string;
  threshold: number; amount_piastres: number; is_active: boolean; deleted_at: string | null;
}
interface PenRow {
  id: string; amount_piastres: number; reason: string; status: string; source: string;
  created_at: string; vendor_ar: string; vendor_en: string;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const [rules, pens] = await Promise.all([
    client.from("penalty_rules").select("*").order("created_at"),
    client.from("vendor_penalties").select(`id, amount_piastres, reason, status, source, created_at,
      vendors(store_name_ar, store_name_en)`).order("created_at", { ascending: false }).limit(100),
  ]);
  if (rules.error) throw new Error(rules.error.message);
  const penRows: PenRow[] = ((pens.data ?? []) as unknown as Array<Record<string, unknown>>).map((p) => {
    const v = p.vendors as { store_name_ar: string; store_name_en: string } | null;
    return {
      id: p.id as string, amount_piastres: p.amount_piastres as number,
      reason: p.reason as string, status: p.status as string, source: p.source as string,
      created_at: p.created_at as string,
      vendor_ar: v?.store_name_ar ?? "", vendor_en: v?.store_name_en ?? "",
    };
  });
  return {
    lang,
    rules: JSON.parse(JSON.stringify(rules.data ?? [])) as RuleRow[],
    applications: JSON.parse(JSON.stringify(penRows)),
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "rule_save") {
    const id = String(form.get("id") ?? "");
    const payload = {
      name_ar: String(form.get("name_ar") ?? "").trim(),
      name_en: String(form.get("name_en") ?? "").trim(),
      trigger_type: String(form.get("trigger_type") ?? "manual"),
      threshold: Math.max(1, Math.trunc(Number(form.get("threshold") ?? 1)) || 1),
      amount_piastres: Math.max(1, Math.trunc(Number(form.get("amount_piastres") ?? 0)) || 1),
      is_active: form.get("is_active") === "on",
    };
    if (!payload.name_ar || !payload.name_en) return data({ ok: false, reason: "name_required" }, { status: 400 });
    const { error } = id
      ? await client.from("penalty_rules").update(payload).eq("id", id)
      : await client.from("penalty_rules").insert({
          ...payload,
          key: `rule_${Date.now().toString(36)}`,
        });
    if (error) return data({ ok: false, reason: error.message }, { status: 400 });
    await client.rpc("fn_audit", {
      p_action: id ? "penalty_rule.updated" : "penalty_rule.created",
      p_entity: "penalty_rules", p_entity_id: id || null, p_before: null, p_after: payload,
    });
    return { ok: true as const };
  }

  if (intent === "rule_soft_delete") {
    const id = String(form.get("id") ?? "");
    // SOFT delete — history preserved (AGENT §18)
    const { error } = await client.from("penalty_rules").update({ deleted_at: new Date().toISOString(), is_active: false }).eq("id", id);
    if (error) return data({ ok: false, reason: error.message }, { status: 400 });
    await client.rpc("fn_audit", { p_action: "penalty_rule.deleted", p_entity: "penalty_rules", p_entity_id: id, p_before: null, p_after: { soft: true } });
    return { ok: true as const };
  }

  if (intent === "waive") {
    const res = await client.rpc("fn_admin_waive_penalty", {
      p_penalty_id: String(form.get("id") ?? ""),
      p_reason: String(form.get("reason") ?? ""),
    });
    if (res.error) return data({ ok: false, reason: res.error.message }, { status: 500 });
    const r = res.data as { ok: boolean; reason?: string };
    return r.ok ? { ok: true as const } : data({ ok: false, reason: r.reason }, { status: 400 });
  }

  return data({ ok: false, reason: "bad_intent" }, { status: 400 });
}

export default function AdminPenalties({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const money = (p: number) => formatPiastres(p, en ? "en" : "ar");
  const fetcher = useFetcher<typeof action>();
  useActionToast(fetcher);
  const busy = fetcher.state !== "idle";
  const [creating, setCreating] = useState(false);

  return (
    <div>
      <h1 className="text-lg font-extrabold text-text">{t("pn.title")}</h1>

      {/* rules */}
      <section className="mt-3" aria-label={t("pn.rules")}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-extrabold text-text">{t("pn.rules")}</h2>
          {/* rule_save inserts when id is empty, but no form ever sent one. */}
          <Button type="button" size="sm" onClick={() => setCreating((v) => !v)}>
            {creating ? t("common.cancel") : t("pn.newRule")}
          </Button>
        </div>

        {creating ? (
          <fetcher.Form method="post" className="mt-2 flex flex-wrap items-end gap-2 rounded-md border border-action/40 bg-surface-tint p-3 text-[13px]">
            <input type="hidden" name="intent" value="rule_save" />
            <input type="hidden" name="id" value="" />
            <label className="flex flex-col gap-1 text-xs font-bold text-text">
              {t("pn.nameAr")}
              <input name="name_ar" required className="w-36 rounded-md border border-border bg-surface px-2 py-1.5" />
            </label>
            <label className="flex flex-col gap-1 text-xs font-bold text-text">
              {t("pn.nameEn")}
              <input name="name_en" required dir="ltr" className="w-36 rounded-md border border-border bg-surface px-2 py-1.5" />
            </label>
            <label className="flex flex-col gap-1 text-xs font-bold text-text">
              {t("pn.amount")}
              <input name="amount_piastres" type="number" min={1} defaultValue={5000} dir="ltr" className="w-24 rounded-md border border-border bg-surface px-2 py-1.5" />
            </label>
            <label className="flex items-center gap-1.5 text-xs font-bold text-text">
              <input type="checkbox" name="is_active" defaultChecked className="size-4 accent-[var(--color-action)]" />
              {t("pn.active")}
            </label>
            <Button type="submit" size="sm" disabled={busy}>{t("pn.createRule")}</Button>
          </fetcher.Form>
        ) : null}

        {(loaderData.rules as RuleRow[]).length === 0 ? (
          <div className="mt-3">
            <EmptyState title={t("pn.noRules")} body={t("pn.noRulesHint")} />
          </div>
        ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {(loaderData.rules as RuleRow[]).map((r) => (
            <li key={r.id} className={`rounded-md border border-border bg-surface p-3 text-[13px] ${r.deleted_at ? "opacity-60" : ""}`}>
              <fetcher.Form method="post" className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="intent" value="rule_save" />
                <input type="hidden" name="id" value={r.id} />
                <label className="flex flex-col gap-1 text-xs font-bold text-text">
                  {t("pn.nameAr")}
                  <input name="name_ar" defaultValue={r.name_ar} className="w-40 rounded-md border border-border bg-surface px-2 py-1.5" />
                </label>
                <label className="flex flex-col gap-1 text-xs font-bold text-text">
                  {t("pn.nameEn")}
                  <input name="name_en" defaultValue={r.name_en} dir="ltr" className="w-40 rounded-md border border-border bg-surface px-2 py-1.5" />
                </label>
                <label className="flex flex-col gap-1 text-xs font-bold text-text">
                  {t("pn.trigger")}
                  <select name="trigger_type" defaultValue={r.trigger_type} className="rounded-md border border-border bg-surface px-2 py-1.5">
                    {["manual", "returns_count", "defect_order", "low_rating", "packaging"].map((tt) => (
                      <option key={tt} value={tt}>{t(`pn.trigger_${tt}`)}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs font-bold text-text">
                  {t("pn.threshold")}
                  <input name="threshold" type="number" min={1} defaultValue={r.threshold} dir="ltr" className="w-16 rounded-md border border-border bg-surface px-2 py-1.5" />
                </label>
                <label className="flex flex-col gap-1 text-xs font-bold text-text">
                  {t("pn.amount")}
                  <input name="amount_piastres" type="number" min={1} defaultValue={r.amount_piastres} dir="ltr" className="w-24 rounded-md border border-border bg-surface px-2 py-1.5" />
                </label>
                <label className="flex items-center gap-1.5 text-xs font-bold text-text">
                  <input type="checkbox" name="is_active" defaultChecked={r.is_active} className="size-4 accent-[var(--color-action)]" />
                  {t("pn.active")}
                </label>
                <Button type="submit" size="sm" disabled={busy}>{t("ve.save")}</Button>
                {!r.deleted_at ? (
                  <button type="submit" name="intent" value="rule_soft_delete"
                    className="cursor-pointer rounded-md border border-danger/50 px-3 py-1.5 text-[13px] font-bold text-danger hover:bg-danger-soft">
                    {t("pn.softDelete")}
                  </button>
                ) : <Badge tone="neutral">{t("pn.deleted")}</Badge>}
              </fetcher.Form>
            </li>
          ))}
        </ul>
        )}
      </section>

      {/* applications */}
      <section className="mt-5" aria-label={t("pn.applications")}>
        <h2 className="text-sm font-extrabold text-text">{t("pn.applications")}</h2>
        {loaderData.applications.length === 0 ? (
          <div className="mt-2"><EmptyState title={t("pn.empty")} body={t("pn.emptyHint")} /></div>
        ) : (
          <ul className="mt-2 flex flex-col divide-y divide-border rounded-md border border-border bg-surface">
            {(loaderData.applications as PenRow[]).map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-[13px]">
                <span className="font-bold text-text">{en ? p.vendor_en : p.vendor_ar}</span>
                <span className="min-w-0 flex-1 truncate text-text-muted">{p.reason}</span>
                <Badge tone={p.source === "rule" ? "neutral" : "info"}>{t(`pn.source_${p.source}`)}</Badge>
                <Badge tone={p.status === "waived" ? "neutral" : "danger"}>{t(`pen.status_${p.status}`)}</Badge>
                <span className="tabular-nums" dir="ltr">{money(p.amount_piastres)}</span>
                {p.status === "applied" ? (
                  <fetcher.Form method="post" className="flex items-center gap-1.5">
                    <input type="hidden" name="intent" value="waive" />
                    <input type="hidden" name="id" value={p.id} />
                    <input name="reason" required minLength={3} placeholder={t("pn.waiveReason")}
                      className="w-40 rounded-md border border-border bg-surface px-2 py-1.5 text-[13px]" />
                    <Button type="submit" size="sm" variant="outline" disabled={busy}>{t("pn.waive")}</Button>
                  </fetcher.Form>
                ) : null}
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
  return <SkeletonTable />;
}

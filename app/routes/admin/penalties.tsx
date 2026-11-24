import { data, useFetcher } from "react-router";
import { useEffect, useState } from "react";
import type { Route } from "./+types/penalties";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { egpToPiastres, formatPiastres, piastresToEgp } from "~/lib/money";
import { Button } from "~/components/ui/Button";
import { Badge } from "~/components/ui/Badge";
import { Dialog } from "~/components/ui/Overlay";
import { Input } from "~/components/ui/Input";
import { EmptyState } from "~/components/ui/EmptyState";
import { PencilIcon, PlusIcon, TrashIcon } from "~/components/ui/icons";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonTable } from "~/components/ui/Skeleton";
// Surfaces the action result: these pages used to discard {ok:false} and
// render nothing, so a failed write looked like a dead button.
import { useActionToast } from "~/components/layout/ActionFeedback";
import { PageHeader } from "~/components/layout/PageHeader";
import { UserAvatar } from "~/components/admin/UserAvatar";


/**
 * A-18 — Penalties (US-06 / AGENT §18): rules CRUD (soft delete) with the
 * fine's reason, amount (EGP) and the team member responsible for it, plus
 * the applications list with waive (reason required → distinct credit tx).
 * Manual apply lives on the vendor page (A-04 row action).
 */

const REASONS = ["manual", "returns_count", "defect_order", "low_rating", "packaging"] as const;

interface RuleRow {
  id: string; key: string; name_ar: string; name_en: string; trigger_type: string;
  threshold: number; amount_piastres: number; is_active: boolean; deleted_at: string | null;
  responsible_id: string | null;
}
interface PenRow {
  id: string; amount_piastres: number; reason: string; status: string; source: string;
  created_at: string; vendor_ar: string; vendor_en: string;
}
interface StaffRow { id: string; full_name: string; avatar_url: string | null; role: string }

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const [rules, pens, staff] = await Promise.all([
    client.from("penalty_rules").select("*").order("created_at"),
    client.from("vendor_penalties").select(`id, amount_piastres, reason, status, source, created_at,
      vendors(store_name_ar, store_name_en)`).order("created_at", { ascending: false }).limit(100),
    client.from("profiles").select("id, full_name, avatar_url, role").in("role", ["admin", "staff"]).order("full_name"),
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
    applications: JSON.parse(JSON.stringify(penRows)) as PenRow[],
    staff: (staff.data ?? []) as StaffRow[],
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
    const trigger = String(form.get("trigger_type") ?? "manual");
    const amount = egpToPiastres(form.get("amount_egp"));
    if (amount == null || amount <= 0) return data({ ok: false, reason: "bad_amount" }, { status: 400 });
    const payload = {
      name_ar: String(form.get("name_ar") ?? "").trim(),
      name_en: String(form.get("name_en") ?? "").trim(),
      trigger_type: (REASONS as readonly string[]).includes(trigger) ? trigger : "manual",
      threshold: Math.max(1, Math.trunc(Number(form.get("threshold") ?? 1)) || 1),
      amount_piastres: amount,
      responsible_id: String(form.get("responsible_id") ?? "") || null,
      is_active: form.get("is_active") === "on",
    };
    if (!payload.name_ar || !payload.name_en) return data({ ok: false, reason: "name_required" }, { status: 400 });
    const { error } = id
      ? await client.from("penalty_rules").update(payload).eq("id", id)
      : await client.from("penalty_rules").insert({
          ...payload,
          key: `rule_${Date.now().toString(36)}`,
        });
    if (error) {
      return data({ ok: false, reason: error.message.includes("responsible_not_staff") ? "responsible_not_staff" : error.message }, { status: 400 });
    }
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

const FIELD = "w-full rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-text focus:border-action focus:outline-none";
const TH = "px-4 py-3 text-start text-xs font-bold text-text-muted";
const TD = "px-4 py-3 align-middle";

export default function AdminPenalties({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const money = (p: number) => formatPiastres(p, en ? "en" : "ar");
  const fetcher = useFetcher<typeof action>();
  useActionToast(fetcher);
  const busy = fetcher.state !== "idle";
  const { rules, applications, staff } = loaderData;
  const staffById = new Map(staff.map((s) => [s.id, s]));
  const liveRules = rules.filter((r) => !r.deleted_at);
  const deletedRules = rules.filter((r) => r.deleted_at);

  // one popup per flow; null = closed
  const [editing, setEditing] = useState<RuleRow | "new" | null>(null);
  const [deleting, setDeleting] = useState<RuleRow | null>(null);
  const [waiving, setWaiving] = useState<PenRow | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const current = editing && editing !== "new" ? editing : null;

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      setEditing(null);
      setDeleting(null);
      setWaiving(null);
    }
  }, [fetcher.state, fetcher.data]);

  const applied = applications.filter((p) => p.status === "applied");
  const stats = [
    { label: t("pn.statActiveRules"), value: String(liveRules.filter((r) => r.is_active).length) },
    { label: t("pn.statApplied"), value: String(applied.length) },
    { label: t("pn.statAppliedTotal"), value: money(applied.reduce((sum, p) => sum + p.amount_piastres, 0)) },
    { label: t("pn.statWaived"), value: String(applications.length - applied.length) },
  ];

  const ruleRow = (r: RuleRow) => {
    const owner = r.responsible_id ? staffById.get(r.responsible_id) : undefined;
    return (
      <tr key={r.id} className={`border-t border-border ${r.deleted_at ? "opacity-60" : ""}`}>
        <td className={TD}>
          <p className="font-bold text-text">{en ? r.name_en : r.name_ar}</p>
          <p className="text-xs text-text-muted">{en ? r.name_ar : r.name_en}</p>
        </td>
        <td className={TD}>
          <Badge tone="info">{t(`pn.trigger_${r.trigger_type}`)}</Badge>
          {r.trigger_type !== "manual" ? (
            <p className="mt-1 text-xs text-text-muted">{t("pn.thresholdShort", { count: r.threshold })}</p>
          ) : null}
        </td>
        <td className={`${TD} num whitespace-nowrap font-black text-danger`} dir="ltr">{money(r.amount_piastres)}</td>
        <td className={TD}>
          {owner ? (
            <span className="flex items-center gap-2">
              <UserAvatar name={owner.full_name} path={owner.avatar_url} size="sm" />
              <span className="text-sm text-text">{owner.full_name}</span>
            </span>
          ) : (
            <span className="text-xs text-text-faint">{t("pn.noResponsible")}</span>
          )}
        </td>
        <td className={TD}>
          {r.deleted_at
            ? <Badge tone="neutral">{t("pn.deleted")}</Badge>
            : <Badge tone={r.is_active ? "success" : "neutral"} dot>{r.is_active ? t("pn.active") : t("pn.paused")}</Badge>}
        </td>
        <td className={`${TD} text-end`}>
          {!r.deleted_at ? (
            <span className="inline-flex gap-1">
              <button type="button" onClick={() => setEditing(r)} aria-label={t("pn.editRule")}
                className="flex size-8 cursor-pointer items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-tint hover:text-action">
                <PencilIcon className="size-4" />
              </button>
              <button type="button" onClick={() => setDeleting(r)} aria-label={t("pn.softDelete")}
                className="flex size-8 cursor-pointer items-center justify-center rounded-md text-text-muted transition-colors hover:bg-danger-soft hover:text-danger">
                <TrashIcon className="size-4" />
              </button>
            </span>
          ) : null}
        </td>
      </tr>
    );
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("pn.title")}
        subtitle={t("pn.subtitle")}
        count={liveRules.length}
        actions={
          <Button size="sm" onClick={() => setEditing("new")}>
            <PlusIcon className="size-4" />
            {t("pn.newRuleBtn")}
          </Button>
        }
      />

      {/* summary */}
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg border border-border bg-surface p-4 shadow-1">
            <dt className="text-xs font-bold text-text-muted">{s.label}</dt>
            <dd className="num mt-1 text-xl font-black text-text" dir="ltr">{s.value}</dd>
          </div>
        ))}
      </dl>

      {/* rules */}
      <section aria-label={t("pn.rules")} className="overflow-hidden rounded-lg border border-border bg-surface shadow-1">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-extrabold text-text">{t("pn.rules")}</h2>
          {deletedRules.length > 0 ? (
            <label className="flex items-center gap-2 text-xs font-bold text-text-muted">
              <input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} className="size-4 accent-[var(--color-action)]" />
              {t("pn.showDeleted", { count: deletedRules.length })}
            </label>
          ) : null}
        </div>
        {liveRules.length === 0 && !showDeleted ? (
          <div className="p-6">
            <EmptyState title={t("pn.noRules")} body={t("pn.noRulesHint")}
              action={<Button size="sm" onClick={() => setEditing("new")}>{t("pn.newRuleBtn")}</Button>} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-surface-tint/40">
                <tr>
                  <th className={TH}>{t("pn.ruleName")}</th>
                  <th className={TH}>{t("pn.trigger")}</th>
                  <th className={TH}>{t("pn.amount")}</th>
                  <th className={TH}>{t("pn.responsible")}</th>
                  <th className={TH}>{t("pn.status")}</th>
                  <th className={TH}><span className="sr-only">{t("pn.actions")}</span></th>
                </tr>
              </thead>
              <tbody>
                {liveRules.map(ruleRow)}
                {showDeleted ? deletedRules.map(ruleRow) : null}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* applications */}
      <section aria-label={t("pn.applications")} className="overflow-hidden rounded-lg border border-border bg-surface shadow-1">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-extrabold text-text">{t("pn.applications")}</h2>
        </div>
        {applications.length === 0 ? (
          <div className="p-6"><EmptyState title={t("pn.empty")} body={t("pn.emptyHint")} /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-surface-tint/40">
                <tr>
                  <th className={TH}>{t("pn.store")}</th>
                  <th className={TH}>{t("pn.fineReason")}</th>
                  <th className={TH}>{t("pn.amount")}</th>
                  <th className={TH}>{t("pn.date")}</th>
                  <th className={TH}>{t("pn.status")}</th>
                  <th className={TH}><span className="sr-only">{t("pn.actions")}</span></th>
                </tr>
              </thead>
              <tbody>
                {applications.map((p) => (
                  <tr key={p.id} className="border-t border-border">
                    <td className={`${TD} font-bold text-text`}>{en ? p.vendor_en || p.vendor_ar : p.vendor_ar}</td>
                    <td className={TD}>
                      <p className="max-w-xs truncate text-text">{p.reason}</p>
                      <p className="text-xs text-text-muted">{t(`pn.source_${p.source}`)}</p>
                    </td>
                    <td className={`${TD} num whitespace-nowrap font-bold`} dir="ltr">{money(p.amount_piastres)}</td>
                    <td className={`${TD} num whitespace-nowrap text-xs text-text-muted`} dir="ltr">{p.created_at.slice(0, 10)}</td>
                    <td className={TD}>
                      <Badge tone={p.status === "waived" ? "neutral" : "danger"} dot>{t(`pen.status_${p.status}`)}</Badge>
                    </td>
                    <td className={`${TD} text-end`}>
                      {p.status === "applied" ? (
                        <Button size="sm" variant="outline" onClick={() => setWaiving(p)}>{t("pn.waive")}</Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* create / edit rule */}
      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={current ? t("pn.editRule") : t("pn.newRuleBtn")} size="lg">
        <fetcher.Form method="post" key={current?.id ?? "new"} className="flex flex-col gap-4 p-1">
          <input type="hidden" name="intent" value="rule_save" />
          <input type="hidden" name="id" value={current?.id ?? ""} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input id="pn-name-ar" name="name_ar" required label={t("pn.nameAr")} defaultValue={current?.name_ar} />
            <Input id="pn-name-en" name="name_en" required dir="ltr" label={t("pn.nameEn")} defaultValue={current?.name_en} />
            <label className="flex flex-col gap-1.5 text-sm font-bold text-text">
              {t("pn.trigger")}
              <select name="trigger_type" defaultValue={current?.trigger_type ?? "manual"} className={FIELD}>
                {REASONS.map((r) => <option key={r} value={r}>{t(`pn.trigger_${r}`)}</option>)}
              </select>
            </label>
            <Input id="pn-threshold" name="threshold" type="number" min={1} dir="ltr" label={t("pn.threshold")}
              hint={t("pn.thresholdHint")} defaultValue={current?.threshold ?? 1} />
            <Input id="pn-amount" name="amount_egp" type="number" min={0.01} step="0.01" inputMode="decimal" required dir="ltr"
              label={t("pn.amount")}
              defaultValue={current ? piastresToEgp(current.amount_piastres) : "50"} />
            <label className="flex flex-col gap-1.5 text-sm font-bold text-text">
              {t("pn.responsible")}
              <select name="responsible_id" defaultValue={current?.responsible_id ?? ""} className={FIELD}>
                <option value="">{t("pn.noResponsible")}</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>{s.full_name} · {t(`roles.${s.role}`)}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm font-bold text-text">
            <input type="checkbox" name="is_active" defaultChecked={current?.is_active ?? true} className="size-4 accent-[var(--color-action)]" />
            {t("pn.active")}
          </label>
          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>{t("common.cancel")}</Button>
            <Button type="submit" loading={busy}>{current ? t("ve.save") : t("pn.createRule")}</Button>
          </div>
        </fetcher.Form>
      </Dialog>

      {/* soft delete */}
      <Dialog open={deleting !== null} onClose={() => setDeleting(null)} title={t("pn.softDelete")}>
        {deleting ? (
          <fetcher.Form method="post" className="flex flex-col gap-4 p-1">
            <input type="hidden" name="intent" value="rule_soft_delete" />
            <input type="hidden" name="id" value={deleting.id} />
            <p className="text-sm text-text">{t("pn.deleteConfirm", { name: en ? deleting.name_en : deleting.name_ar })}</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setDeleting(null)}>{t("common.cancel")}</Button>
              <Button type="submit" loading={busy} className="bg-danger hover:bg-danger">{t("pn.softDelete")}</Button>
            </div>
          </fetcher.Form>
        ) : null}
      </Dialog>

      {/* waive */}
      <Dialog open={waiving !== null} onClose={() => setWaiving(null)} title={t("pn.waive")}>
        {waiving ? (
          <fetcher.Form method="post" className="flex flex-col gap-4 p-1">
            <input type="hidden" name="intent" value="waive" />
            <input type="hidden" name="id" value={waiving.id} />
            <p className="text-sm text-text">
              {t("pn.waiveConfirm", { store: en ? waiving.vendor_en || waiving.vendor_ar : waiving.vendor_ar, amount: money(waiving.amount_piastres) })}
            </p>
            <Input id="pn-waive-reason" name="reason" required minLength={3} label={t("pn.waiveReason")} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setWaiving(null)}>{t("common.cancel")}</Button>
              <Button type="submit" loading={busy}>{t("pn.waive")}</Button>
            </div>
          </fetcher.Form>
        ) : null}
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

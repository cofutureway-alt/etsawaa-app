import { data, useFetcher } from "react-router";
import { useEffect, useState } from "react";
import type { Route } from "./+types/levels";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { Button } from "~/components/ui/Button";
import { Badge } from "~/components/ui/Badge";
import { Dialog } from "~/components/ui/Overlay";
import { Input } from "~/components/ui/Input";
import { EmptyState } from "~/components/ui/EmptyState";
import { PencilIcon, PlusIcon, TrashIcon } from "~/components/ui/icons";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonTable } from "~/components/ui/Skeleton";
import { PageHeader } from "~/components/layout/PageHeader";
import { useActionToast } from "~/components/layout/ActionFeedback";
import { AchievementIcon, AchievementIconPicker } from "~/components/achievements/AchievementIcon";
import {
  GoalsEditor, RewardsEditor, describeGoal, describeReward,
  type GoalDraft, type PackageOption, type RewardDraft,
} from "~/components/achievements/AchievementEditor";

/**
 * A-19 — Levels: an ordered ladder of store levels. Each level has goals
 * (all must be met), rewards (ad package, home-featured product slots,
 * commission reduction) and an icon. fn_evaluate_vendor_achievements moves
 * stores up automatically (hourly + "Recalculate now"); badges live on their
 * own page (/admin/badges).
 */

interface LevelRow {
  id: string; name_ar: string; name_en: string; description_ar: string; description_en: string;
  icon: string; color: string; sort: number; is_active: boolean;
  base_commission_percent: number | null; hold_days: number | null;
  goals: GoalDraft[]; rewards: RewardDraft[]; vendors_count: number;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const [levels, goals, rewards, vendors, packages, history] = await Promise.all([
    client.from("vendor_levels").select("*").order("sort").order("created_at"),
    client.from("achievement_goals").select("*").not("level_id", "is", null).order("sort"),
    client.from("level_rewards").select("*").order("sort"),
    client.from("vendors").select("level_id").not("level_id", "is", null),
    client.from("ad_packages").select("id, name_ar, name_en, duration_days, visibility").eq("is_active", true).order("name_ar"),
    client.from("vendor_level_history")
      .select("id, reason, created_at, actor, vendors(store_name_ar, store_name_en), to:vendor_levels!vendor_level_history_to_level_fkey(name_ar, name_en)")
      .order("created_at", { ascending: false }).limit(15),
  ]);
  if (levels.error) throw new Error(levels.error.message);
  const count = new Map<string, number>();
  for (const v of (vendors.data ?? []) as Array<{ level_id: string }>) count.set(v.level_id, (count.get(v.level_id) ?? 0) + 1);
  const goalRows = (goals.data ?? []) as Array<GoalDraft & { level_id: string }>;
  const rewardRows = (rewards.data ?? []) as Array<RewardDraft & { level_id: string }>;
  const rows: LevelRow[] = ((levels.data ?? []) as Array<Record<string, unknown>>).map((l) => {
    const r = (l.rewards ?? {}) as { commission_percent?: number; hold_days?: number };
    const id = l.id as string;
    return {
      id, name_ar: l.name_ar as string, name_en: l.name_en as string,
      description_ar: (l.description_ar as string) ?? "", description_en: (l.description_en as string) ?? "",
      icon: (l.icon as string) || "award", color: (l.color as string) || "#C8102E",
      sort: l.sort as number, is_active: l.is_active as boolean,
      base_commission_percent: r.commission_percent ?? null, hold_days: r.hold_days ?? null,
      goals: goalRows.filter((g) => g.level_id === id).map(({ goal_type, target, min_rating, duration_unit }) =>
        ({ goal_type, target, min_rating: min_rating == null ? null : Number(min_rating), duration_unit })),
      rewards: rewardRows.filter((x) => x.level_id === id).map(({ reward_type, ad_package_id, featured_count, commission_reduction }) =>
        ({ reward_type, ad_package_id, featured_count, commission_reduction: commission_reduction == null ? null : Number(commission_reduction) })),
      vendors_count: count.get(id) ?? 0,
    };
  });
  return {
    lang,
    levels: rows,
    packages: (packages.data ?? []) as PackageOption[],
    history: (history.data ?? []) as unknown as Array<{
      id: string; reason: string | null; created_at: string; actor: string | null;
      vendors: { store_name_ar: string; store_name_en: string } | null;
      to: { name_ar: string; name_en: string } | null;
    }>,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "save") {
    let payload: unknown;
    try { payload = JSON.parse(String(form.get("payload") ?? "{}")); } catch { return data({ ok: false, reason: "invalid" }, { status: 400 }); }
    const res = await client.rpc("fn_admin_save_achievement", { p_kind: "level", p: payload });
    if (res.error) return data({ ok: false, reason: res.error.message }, { status: 500 });
    const r = res.data as { ok: boolean; reason?: string };
    return r.ok ? { ok: true as const } : data({ ok: false, reason: r.reason }, { status: 400 });
  }

  if (intent === "delete") {
    const id = String(form.get("id") ?? "");
    const { count } = await client.from("vendors").select("id", { count: "exact", head: true }).eq("level_id", id);
    if ((count ?? 0) > 0) return data({ ok: false, reason: "level_in_use" }, { status: 400 });
    const { error } = await client.from("vendor_levels").delete().eq("id", id);
    // a level that stores passed through stays in their history — archive it instead
    if (error) {
      await client.from("vendor_levels").update({ is_active: false }).eq("id", id);
      return { ok: true as const, archived: true };
    }
    return { ok: true as const };
  }

  if (intent === "evaluate") {
    const res = await client.rpc("fn_admin_evaluate_achievements");
    if (res.error) return data({ ok: false, reason: res.error.message }, { status: 500 });
    const r = res.data as { ok: boolean; stores?: number; promoted?: number; badges?: number; reason?: string };
    return r.ok ? { ok: true as const, stores: r.stores, promoted: r.promoted, badges: r.badges } : data({ ok: false, reason: r.reason }, { status: 400 });
  }

  return data({ ok: false, reason: "bad_intent" }, { status: 400 });
}

interface Draft {
  id: string | null; name_ar: string; name_en: string; description_ar: string; description_en: string;
  icon: string; color: string; sort: number; is_active: boolean;
  base_commission_percent: string; hold_days: string;
  goals: GoalDraft[]; rewards: RewardDraft[];
}

function draftOf(row: LevelRow | null, nextSort: number): Draft {
  return {
    id: row?.id ?? null,
    name_ar: row?.name_ar ?? "", name_en: row?.name_en ?? "",
    description_ar: row?.description_ar ?? "", description_en: row?.description_en ?? "",
    icon: row?.icon ?? "award", color: row?.color ?? "#D4A017",
    sort: row?.sort ?? nextSort, is_active: row?.is_active ?? true,
    base_commission_percent: row?.base_commission_percent != null ? String(row.base_commission_percent) : "",
    hold_days: row?.hold_days != null ? String(row.hold_days) : "",
    goals: row?.goals ?? [], rewards: row?.rewards ?? [],
  };
}

export default function AdminLevels({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const fetcher = useFetcher<typeof action>();
  const evaluator = useFetcher<typeof action>();
  useActionToast(fetcher);
  useActionToast(evaluator, {
    success: evaluator.data && "stores" in evaluator.data
      ? t("ach.evaluated", { stores: evaluator.data.stores ?? 0, promoted: evaluator.data.promoted ?? 0, badges: evaluator.data.badges ?? 0 })
      : undefined,
  });
  const busy = fetcher.state !== "idle";
  const { levels, packages, history } = loaderData;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<LevelRow | null>(null);
  const nextSort = (levels.at(-1)?.sort ?? 0) + 10;

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) { setDraft(null); setDeleting(null); }
  }, [fetcher.state, fetcher.data]);

  const patch = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const payload = draft ? JSON.stringify({
    ...draft,
    base_commission_percent: draft.base_commission_percent === "" ? null : Number(draft.base_commission_percent),
    hold_days: draft.hold_days === "" ? null : Math.trunc(Number(draft.hold_days)),
  }) : "";

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("lv.title")}
        subtitle={t("lv.subtitle")}
        count={levels.length}
        actions={
          <>
            <evaluator.Form method="post">
              <input type="hidden" name="intent" value="evaluate" />
              <Button type="submit" size="sm" variant="outline" loading={evaluator.state !== "idle"}>{t("ach.evaluateNow")}</Button>
            </evaluator.Form>
            <Button size="sm" onClick={() => setDraft(draftOf(null, nextSort))}>
              <PlusIcon className="size-4" />{t("lv.newLevel")}
            </Button>
          </>
        }
      />

      {levels.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-6 shadow-1">
          <EmptyState title={t("lv.empty")} body={t("lv.emptyHint")} />
        </div>
      ) : (
        <ol className="flex flex-col gap-3">
          {levels.map((l, index) => (
            <li key={l.id} className={`relative flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 shadow-1 sm:flex-row sm:items-start sm:p-5 ${l.is_active ? "" : "opacity-60"}`}>
              <div className="flex items-center gap-3 sm:w-64 sm:shrink-0">
                <AchievementIcon icon={l.icon} color={l.color} size="lg" />
                <div className="min-w-0">
                  <p className="text-2xs font-bold uppercase tracking-wide text-text-muted">{t("lv.rank", { n: index + 1 })}</p>
                  <h3 className="truncate text-base font-black text-text">{en ? l.name_en : l.name_ar}</h3>
                  <p className="text-xs text-text-muted">{t("lv.storesAtLevel", { count: l.vendors_count })}</p>
                  {!l.is_active ? <Badge tone="neutral">{t("lv.inactive")}</Badge> : null}
                </div>
              </div>
              <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
                <div>
                  <p className="mb-1.5 text-xs font-bold text-text-muted">{t("ach.goals")}</p>
                  {l.goals.length === 0 ? (
                    <p className="text-sm text-text-muted">{t("lv.entryLevel")}</p>
                  ) : (
                    <ul className="flex flex-wrap gap-1.5">
                      {l.goals.map((g, i) => <li key={i} className="rounded-full bg-surface-tint px-2.5 py-1 text-xs font-bold text-text">{describeGoal(t, g)}</li>)}
                    </ul>
                  )}
                </div>
                <div>
                  <p className="mb-1.5 text-xs font-bold text-text-muted">{t("ach.rewards")}</p>
                  {/* only real rewards here — the level's base commission is a setting, not a reward */}
                  {l.rewards.length === 0 ? (
                    <p className="text-sm text-text-muted">{t("lv.noRewards")}</p>
                  ) : (
                    <ul className="flex flex-wrap gap-1.5">
                      {l.rewards.map((r, i) => <li key={i} className="rounded-full bg-success-soft px-2.5 py-1 text-xs font-bold text-success-strong">{describeReward(t, r, packages, Boolean(en))}</li>)}
                    </ul>
                  )}
                </div>
              </div>
              <div className="flex gap-1 sm:flex-col">
                <button type="button" onClick={() => setDraft(draftOf(l, nextSort))} aria-label={t("lv.edit")}
                  className="flex size-9 cursor-pointer items-center justify-center rounded-md text-text-muted hover:bg-surface-tint hover:text-action">
                  <PencilIcon className="size-4" />
                </button>
                <button type="button" onClick={() => setDeleting(l)} aria-label={t("lv.delete")}
                  className="flex size-9 cursor-pointer items-center justify-center rounded-md text-text-muted hover:bg-danger-soft hover:text-danger">
                  <TrashIcon className="size-4" />
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}

      {history.length > 0 ? (
        <section className="rounded-lg border border-border bg-surface shadow-1" aria-label={t("lv.history")}>
          <h2 className="border-b border-border px-4 py-3 text-sm font-extrabold text-text">{t("lv.history")}</h2>
          <ul className="divide-y divide-border">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <span className="font-bold text-text">{h.vendors ? (en ? h.vendors.store_name_en || h.vendors.store_name_ar : h.vendors.store_name_ar) : "—"}</span>
                <span className="text-text-muted">→ {h.to ? (en ? h.to.name_en : h.to.name_ar) : "—"}</span>
                <span className="text-xs text-text-muted">{h.actor ? t("lv.byAdmin") : t("lv.automatic")}{h.reason && h.actor ? ` · ${h.reason}` : ""}</span>
                <span className="num text-xs text-text-faint" dir="ltr">{h.created_at.slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* editor */}
      <Dialog open={draft !== null} onClose={() => setDraft(null)} title={draft?.id ? t("lv.edit") : t("lv.newLevel")} size="xl">
        {draft ? (
          <fetcher.Form method="post" className="flex flex-col gap-5 p-1">
            <input type="hidden" name="intent" value="save" />
            <input type="hidden" name="payload" value={payload} />
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-3 rounded-md bg-surface-tint/40 p-3">
                  <AchievementIcon icon={draft.icon} color={draft.color} size="lg" />
                  <div className="min-w-0">
                    <p className="truncate font-black text-text">{(en ? draft.name_en : draft.name_ar) || t("lv.preview")}</p>
                    <p className="text-xs text-text-muted">{t("lv.previewHint")}</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Input id="lv-name-ar" required label={t("pn.nameAr")} value={draft.name_ar} onChange={(e) => patch({ name_ar: e.target.value })} />
                  <Input id="lv-name-en" required dir="ltr" label={t("pn.nameEn")} value={draft.name_en} onChange={(e) => patch({ name_en: e.target.value })} />
                  <Input id="lv-desc-ar" label={t("ach.descAr")} value={draft.description_ar} onChange={(e) => patch({ description_ar: e.target.value })} />
                  <Input id="lv-desc-en" dir="ltr" label={t("ach.descEn")} value={draft.description_en} onChange={(e) => patch({ description_en: e.target.value })} />
                  <Input id="lv-sort" type="number" dir="ltr" label={t("lv.order")} hint={t("lv.orderHint")} value={draft.sort}
                    onChange={(e) => patch({ sort: Math.trunc(Number(e.target.value)) || 0 })} />
                  <label className="flex items-center gap-2 self-end pb-2.5 text-sm font-bold text-text">
                    <input type="checkbox" checked={draft.is_active} onChange={(e) => patch({ is_active: e.target.checked })} className="size-4 accent-[var(--color-action)]" />
                    {t("pn.active")}
                  </label>
                  <Input id="lv-base" type="number" min={0} max={100} step="0.01" dir="ltr" label={t("lv.baseCommission")} hint={t("lv.baseCommissionHint")}
                    value={draft.base_commission_percent} onChange={(e) => patch({ base_commission_percent: e.target.value })} />
                  <Input id="lv-hold" type="number" min={0} dir="ltr" label={t("lv.holdDays")} hint={t("lv.holdDaysHint")}
                    value={draft.hold_days} onChange={(e) => patch({ hold_days: e.target.value })} />
                </div>
                <AchievementIconPicker icon={draft.icon} color={draft.color} onIcon={(icon) => patch({ icon })} onColor={(color) => patch({ color })}
                  iconLabel={t("ach.icon")} colorLabel={t("ach.color")} />
              </div>
              <div className="flex flex-col gap-5">
                <GoalsEditor goals={draft.goals} onChange={(goals) => patch({ goals })} />
                <RewardsEditor rewards={draft.rewards} onChange={(rewards) => patch({ rewards })} packages={packages} />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-border pt-3">
              <Button type="button" variant="ghost" onClick={() => setDraft(null)}>{t("common.cancel")}</Button>
              <Button type="submit" loading={busy}>{draft.id ? t("ve.save") : t("lv.create")}</Button>
            </div>
          </fetcher.Form>
        ) : null}
      </Dialog>

      <Dialog open={deleting !== null} onClose={() => setDeleting(null)} title={t("lv.delete")}>
        {deleting ? (
          <fetcher.Form method="post" className="flex flex-col gap-4 p-1">
            <input type="hidden" name="intent" value="delete" />
            <input type="hidden" name="id" value={deleting.id} />
            <p className="text-sm text-text">
              {deleting.vendors_count > 0 ? t("lv.deleteBlocked", { count: deleting.vendors_count }) : t("lv.deleteConfirm", { name: en ? deleting.name_en : deleting.name_ar })}
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setDeleting(null)}>{t("common.cancel")}</Button>
              {deleting.vendors_count === 0 ? (
                <Button type="submit" loading={busy} className="bg-danger hover:bg-danger">{t("lv.delete")}</Button>
              ) : null}
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

import { data, useFetcher } from "react-router";
import { useEffect, useState } from "react";
import type { Route } from "./+types/badges";
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
import { GoalsEditor, describeGoal, newGoal, type GoalDraft } from "~/components/achievements/AchievementEditor";

/**
 * Badges: achievements with the same goals as levels but no rewards. Earned
 * badges show as compact icons on the seller's public store page. Awarded by
 * fn_evaluate_vendor_achievements (hourly + "Recalculate now").
 */

interface BadgeRow {
  id: string; name_ar: string; name_en: string; description_ar: string; description_en: string;
  icon: string; color: string; sort: number; is_active: boolean; goals: GoalDraft[]; holders: number;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const [badges, goals, holders] = await Promise.all([
    client.from("badges").select("*").order("sort").order("created_at"),
    client.from("achievement_goals").select("*").not("badge_id", "is", null).order("sort"),
    client.from("vendor_badges").select("badge_id"),
  ]);
  if (badges.error) throw new Error(badges.error.message);
  const count = new Map<string, number>();
  for (const h of (holders.data ?? []) as Array<{ badge_id: string }>) count.set(h.badge_id, (count.get(h.badge_id) ?? 0) + 1);
  const goalRows = (goals.data ?? []) as Array<GoalDraft & { badge_id: string }>;
  const rows: BadgeRow[] = ((badges.data ?? []) as Array<Omit<BadgeRow, "goals" | "holders">>).map((b) => ({
    ...b,
    goals: goalRows.filter((g) => g.badge_id === b.id).map(({ goal_type, target, min_rating, duration_unit }) =>
      ({ goal_type, target, min_rating: min_rating == null ? null : Number(min_rating), duration_unit })),
    holders: count.get(b.id) ?? 0,
  }));
  return { lang, badges: rows };
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
    const res = await client.rpc("fn_admin_save_achievement", { p_kind: "badge", p: payload });
    if (res.error) return data({ ok: false, reason: res.error.message }, { status: 500 });
    const r = res.data as { ok: boolean; reason?: string };
    return r.ok ? { ok: true as const } : data({ ok: false, reason: r.reason }, { status: 400 });
  }
  if (intent === "delete") {
    // removing a badge also removes it from every store that earned it
    const { error } = await client.from("badges").delete().eq("id", String(form.get("id") ?? ""));
    if (error) return data({ ok: false, reason: error.message }, { status: 400 });
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
  icon: string; color: string; sort: number; is_active: boolean; goals: GoalDraft[];
}

export default function AdminBadges({ loaderData }: Route.ComponentProps) {
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
  const { badges } = loaderData;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<BadgeRow | null>(null);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) { setDraft(null); setDeleting(null); }
  }, [fetcher.state, fetcher.data]);

  const open = (b: BadgeRow | null) => setDraft({
    id: b?.id ?? null, name_ar: b?.name_ar ?? "", name_en: b?.name_en ?? "",
    description_ar: b?.description_ar ?? "", description_en: b?.description_en ?? "",
    icon: b?.icon ?? "award", color: b?.color ?? "#1D5FBF",
    sort: b?.sort ?? badges.length * 10, is_active: b?.is_active ?? true,
    goals: b?.goals ?? [newGoal()],
  });
  const patch = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("bd.title")}
        subtitle={t("bd.subtitle")}
        count={badges.length}
        actions={
          <>
            <evaluator.Form method="post">
              <input type="hidden" name="intent" value="evaluate" />
              <Button type="submit" size="sm" variant="outline" loading={evaluator.state !== "idle"}>{t("ach.evaluateNow")}</Button>
            </evaluator.Form>
            <Button size="sm" onClick={() => open(null)}><PlusIcon className="size-4" />{t("bd.newBadge")}</Button>
          </>
        }
      />

      {badges.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-6 shadow-1">
          <EmptyState title={t("bd.empty")} body={t("bd.emptyHint")} />
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {badges.map((b) => (
            <li key={b.id} className={`flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-1 ${b.is_active ? "" : "opacity-60"}`}>
              <div className="flex items-start gap-3">
                <AchievementIcon icon={b.icon} color={b.color} size="md" />
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-black text-text">{en ? b.name_en : b.name_ar}</h3>
                  <p className="line-clamp-2 text-xs text-text-muted">{(en ? b.description_en : b.description_ar) || t("bd.noDescription")}</p>
                </div>
                {!b.is_active ? <Badge tone="neutral">{t("lv.inactive")}</Badge> : null}
              </div>
              <ul className="flex flex-wrap gap-1.5">
                {b.goals.map((g, i) => <li key={i} className="rounded-full bg-surface-tint px-2.5 py-1 text-xs font-bold text-text">{describeGoal(t, g)}</li>)}
              </ul>
              <div className="mt-auto flex items-center justify-between border-t border-border pt-3">
                <span className="text-xs text-text-muted">{t("bd.holders", { count: b.holders })}</span>
                <span className="flex gap-1">
                  <button type="button" onClick={() => open(b)} aria-label={t("bd.edit")}
                    className="flex size-8 cursor-pointer items-center justify-center rounded-md text-text-muted hover:bg-surface-tint hover:text-action">
                    <PencilIcon className="size-4" />
                  </button>
                  <button type="button" onClick={() => setDeleting(b)} aria-label={t("bd.delete")}
                    className="flex size-8 cursor-pointer items-center justify-center rounded-md text-text-muted hover:bg-danger-soft hover:text-danger">
                    <TrashIcon className="size-4" />
                  </button>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={draft !== null} onClose={() => setDraft(null)} title={draft?.id ? t("bd.edit") : t("bd.newBadge")} size="xl">
        {draft ? (
          <fetcher.Form method="post" className="flex flex-col gap-5 p-1">
            <input type="hidden" name="intent" value="save" />
            <input type="hidden" name="payload" value={JSON.stringify(draft)} />
            <div className="grid gap-5 lg:grid-cols-2">
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-3 rounded-md bg-surface-tint/40 p-3">
                  <AchievementIcon icon={draft.icon} color={draft.color} size="lg" />
                  <div className="min-w-0">
                    <p className="truncate font-black text-text">{(en ? draft.name_en : draft.name_ar) || t("lv.preview")}</p>
                    <p className="text-xs text-text-muted">{t("bd.previewHint")}</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Input id="bd-name-ar" required label={t("pn.nameAr")} value={draft.name_ar} onChange={(e) => patch({ name_ar: e.target.value })} />
                  <Input id="bd-name-en" required dir="ltr" label={t("pn.nameEn")} value={draft.name_en} onChange={(e) => patch({ name_en: e.target.value })} />
                  <Input id="bd-desc-ar" label={t("ach.descAr")} value={draft.description_ar} onChange={(e) => patch({ description_ar: e.target.value })} />
                  <Input id="bd-desc-en" dir="ltr" label={t("ach.descEn")} value={draft.description_en} onChange={(e) => patch({ description_en: e.target.value })} />
                  <Input id="bd-sort" type="number" dir="ltr" label={t("lv.order")} value={draft.sort}
                    onChange={(e) => patch({ sort: Math.trunc(Number(e.target.value)) || 0 })} />
                  <label className="flex items-center gap-2 self-end pb-2.5 text-sm font-bold text-text">
                    <input type="checkbox" checked={draft.is_active} onChange={(e) => patch({ is_active: e.target.checked })} className="size-4 accent-[var(--color-action)]" />
                    {t("pn.active")}
                  </label>
                </div>
                <AchievementIconPicker icon={draft.icon} color={draft.color} onIcon={(icon) => patch({ icon })} onColor={(color) => patch({ color })}
                  iconLabel={t("ach.icon")} colorLabel={t("ach.color")} />
              </div>
              <GoalsEditor goals={draft.goals} onChange={(goals) => patch({ goals })} />
            </div>
            <div className="flex justify-end gap-2 border-t border-border pt-3">
              <Button type="button" variant="ghost" onClick={() => setDraft(null)}>{t("common.cancel")}</Button>
              <Button type="submit" loading={busy} disabled={draft.goals.length === 0}>{draft.id ? t("ve.save") : t("bd.create")}</Button>
            </div>
          </fetcher.Form>
        ) : null}
      </Dialog>

      <Dialog open={deleting !== null} onClose={() => setDeleting(null)} title={t("bd.delete")}>
        {deleting ? (
          <fetcher.Form method="post" className="flex flex-col gap-4 p-1">
            <input type="hidden" name="intent" value="delete" />
            <input type="hidden" name="id" value={deleting.id} />
            <p className="text-sm text-text">{t("bd.deleteConfirm", { name: en ? deleting.name_en : deleting.name_ar, count: deleting.holders })}</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setDeleting(null)}>{t("common.cancel")}</Button>
              <Button type="submit" loading={busy} className="bg-danger hover:bg-danger">{t("bd.delete")}</Button>
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

import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { PlusIcon, TrashIcon } from "~/components/ui/icons";

/**
 * Goal and reward editors shared by Admin → Levels and Admin → Badges.
 * State is plain arrays; the page posts them as JSON to
 * fn_admin_save_achievement, which replaces the rows in one transaction.
 */

export const GOAL_TYPES = ["successful_orders", "ratings", "withdrawals", "products", "membership"] as const;
export const REWARD_TYPES = ["ad_package", "featured_products", "commission_reduction"] as const;
export type GoalType = (typeof GOAL_TYPES)[number];
export type RewardType = (typeof REWARD_TYPES)[number];

export interface GoalDraft {
  goal_type: GoalType;
  target: number;
  min_rating: number | null;
  duration_unit: "days" | "months" | "years" | null;
}
export interface RewardDraft {
  reward_type: RewardType;
  ad_package_id: string | null;
  featured_count: number | null;
  commission_reduction: number | null;
}
export interface PackageOption { id: string; name_ar: string; name_en: string; duration_days: number; visibility: string }

const FIELD = "w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-text focus:border-action focus:outline-none";

export function newGoal(type: GoalType = "successful_orders"): GoalDraft {
  return { goal_type: type, target: type === "membership" ? 3 : 10, min_rating: type === "ratings" ? 4 : null, duration_unit: type === "membership" ? "months" : null };
}
export function newReward(type: RewardType = "commission_reduction", packages: PackageOption[] = []): RewardDraft {
  return {
    reward_type: type,
    ad_package_id: type === "ad_package" ? (packages[0]?.id ?? null) : null,
    featured_count: type === "featured_products" ? 3 : null,
    commission_reduction: type === "commission_reduction" ? 1 : null,
  };
}

/** One-line human text for a goal (cards, chips). */
export function describeGoal(t: TFunction, g: GoalDraft): string {
  if (g.goal_type === "ratings") return t("ach.goalText_ratings", { count: g.target, rating: g.min_rating ?? 1 });
  if (g.goal_type === "membership") return t(`ach.goalText_membership_${g.duration_unit ?? "days"}`, { count: g.target });
  return t(`ach.goalText_${g.goal_type}`, { count: g.target });
}

export function describeReward(t: TFunction, r: RewardDraft, packages: PackageOption[], en: boolean): string {
  if (r.reward_type === "ad_package") {
    const pkg = packages.find((p) => p.id === r.ad_package_id);
    return t("ach.rewardText_ad_package", { name: pkg ? (en ? pkg.name_en : pkg.name_ar) : "—" });
  }
  if (r.reward_type === "featured_products") return t("ach.rewardText_featured_products", { count: r.featured_count ?? 0 });
  return t("ach.rewardText_commission_reduction", { value: r.commission_reduction ?? 0 });
}

export function GoalsEditor({ goals, onChange }: { goals: GoalDraft[]; onChange: (goals: GoalDraft[]) => void }) {
  const { t } = useTranslation();
  const set = (i: number, patch: Partial<GoalDraft>) => onChange(goals.map((g, j) => (j === i ? { ...g, ...patch } : g)));
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-bold text-text">{t("ach.goals")}</legend>
      <p className="-mt-1 text-xs text-text-muted">{t("ach.goalsHint")}</p>
      {goals.map((g, i) => (
        <div key={i} className="grid grid-cols-[1fr_auto] items-end gap-2 rounded-md border border-border bg-surface-tint/30 p-2.5 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
          <label className="col-span-2 flex flex-col gap-1 text-xs font-bold text-text sm:col-span-1">
            {t("ach.goalType")}
            <select value={g.goal_type} className={FIELD}
              onChange={(e) => { const next = newGoal(e.target.value as GoalType); set(i, next); }}>
              {GOAL_TYPES.map((type) => <option key={type} value={type}>{t(`ach.goal_${type}`)}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-bold text-text">
            {g.goal_type === "membership" ? t("ach.duration") : t("ach.count")}
            <input type="number" min={1} required dir="ltr" value={g.target} className={FIELD}
              onChange={(e) => set(i, { target: Math.max(1, Math.trunc(Number(e.target.value)) || 1) })} />
          </label>
          {g.goal_type === "ratings" ? (
            <label className="flex flex-col gap-1 text-xs font-bold text-text">
              {t("ach.minRating")}
              <select value={g.min_rating ?? 4} className={FIELD} onChange={(e) => set(i, { min_rating: Number(e.target.value) })}>
                {[1, 2, 3, 3.5, 4, 4.5, 5].map((v) => <option key={v} value={v}>{t("ach.starsAtLeast", { value: v })}</option>)}
              </select>
            </label>
          ) : g.goal_type === "membership" ? (
            <label className="flex flex-col gap-1 text-xs font-bold text-text">
              {t("ach.unit")}
              <select value={g.duration_unit ?? "days"} className={FIELD}
                onChange={(e) => set(i, { duration_unit: e.target.value as GoalDraft["duration_unit"] })}>
                {(["days", "months", "years"] as const).map((u) => <option key={u} value={u}>{t(`ach.unit_${u}`)}</option>)}
              </select>
            </label>
          ) : <span className="hidden sm:block" />}
          <button type="button" onClick={() => onChange(goals.filter((_, j) => j !== i))} aria-label={t("ach.removeGoal")}
            className="flex size-9 cursor-pointer items-center justify-center rounded-md text-text-muted hover:bg-danger-soft hover:text-danger">
            <TrashIcon className="size-4" />
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...goals, newGoal()])}
        className="flex cursor-pointer items-center justify-center gap-1.5 rounded-md border border-dashed border-border py-2 text-sm font-bold text-action hover:border-action">
        <PlusIcon className="size-4" />{t("ach.addGoal")}
      </button>
    </fieldset>
  );
}

export function RewardsEditor({ rewards, onChange, packages }: {
  rewards: RewardDraft[];
  onChange: (rewards: RewardDraft[]) => void;
  packages: PackageOption[];
}) {
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const set = (i: number, patch: Partial<RewardDraft>) => onChange(rewards.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-bold text-text">{t("ach.rewards")}</legend>
      <p className="-mt-1 text-xs text-text-muted">{t("ach.rewardsHint")}</p>
      {rewards.map((r, i) => (
        <div key={i} className="grid grid-cols-[1fr_auto] items-end gap-2 rounded-md border border-border bg-surface-tint/30 p-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <label className="col-span-2 flex flex-col gap-1 text-xs font-bold text-text sm:col-span-1">
            {t("ach.rewardType")}
            <select value={r.reward_type} className={FIELD}
              onChange={(e) => set(i, newReward(e.target.value as RewardType, packages))}>
              {REWARD_TYPES.map((type) => <option key={type} value={type}>{t(`ach.reward_${type}`)}</option>)}
            </select>
          </label>
          {r.reward_type === "ad_package" ? (
            <label className="flex flex-col gap-1 text-xs font-bold text-text">
              {t("ach.package")}
              {packages.length === 0 ? (
                <span className="py-2 text-xs font-normal text-danger">{t("ach.noPackages")}</span>
              ) : (
                <select value={r.ad_package_id ?? ""} className={FIELD} onChange={(e) => set(i, { ad_package_id: e.target.value })}>
                  {packages.map((p) => (
                    <option key={p.id} value={p.id}>
                      {en ? p.name_en : p.name_ar} · {t("ach.days", { count: p.duration_days })}{p.visibility === "rewards" ? ` · ${t("ach.rewardOnly")}` : ""}
                    </option>
                  ))}
                </select>
              )}
            </label>
          ) : r.reward_type === "featured_products" ? (
            <label className="flex flex-col gap-1 text-xs font-bold text-text">
              {t("ach.featuredCount")}
              <input type="number" min={1} max={50} dir="ltr" value={r.featured_count ?? 1} className={FIELD}
                onChange={(e) => set(i, { featured_count: Math.min(50, Math.max(1, Math.trunc(Number(e.target.value)) || 1)) })} />
            </label>
          ) : (
            <label className="flex flex-col gap-1 text-xs font-bold text-text">
              {t("ach.reductionPoints")}
              <input type="number" min={0.01} max={100} step="0.01" dir="ltr" value={r.commission_reduction ?? 1} className={FIELD}
                onChange={(e) => set(i, { commission_reduction: Math.max(0.01, Number(e.target.value) || 0.01) })} />
            </label>
          )}
          <button type="button" onClick={() => onChange(rewards.filter((_, j) => j !== i))} aria-label={t("ach.removeReward")}
            className="flex size-9 cursor-pointer items-center justify-center rounded-md text-text-muted hover:bg-danger-soft hover:text-danger">
            <TrashIcon className="size-4" />
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...rewards, newReward("commission_reduction", packages)])}
        className="flex cursor-pointer items-center justify-center gap-1.5 rounded-md border border-dashed border-border py-2 text-sm font-bold text-action hover:border-action">
        <PlusIcon className="size-4" />{t("ach.addReward")}
      </button>
    </fieldset>
  );
}

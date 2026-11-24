import { useTranslation } from "react-i18next";
import { Card, CardBody } from "~/components/ui";
import { AchievementIcon } from "./AchievementIcon";
import { BadgeStrip, type EarnedBadge } from "./BadgeStrip";
import { describeGoal, type GoalDraft } from "./AchievementEditor";

interface LevelBrief { id: string; name_ar: string; name_en: string; icon: string; color: string }
export interface MyAchievements {
  ok: boolean;
  level: LevelBrief | null;
  next: (LevelBrief & { goals: Array<GoalDraft & { progress: number; required: number }> }) | null;
  badges: EarnedBadge[];
  commission_reduction: number;
  featured_slots: number;
  featured_used: number;
}

/** Seller dashboard card: current level, progress to the next one, badges, active rewards. */
export function SellerAchievements({ data }: { data: MyAchievements }) {
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const name = (l: LevelBrief) => (en ? l.name_en : l.name_ar);
  return (
    <Card>
      <CardBody className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {data.level ? <AchievementIcon icon={data.level.icon} color={data.level.color} size="lg" /> : null}
            <div>
              <p className="text-xs font-bold text-text-muted">{t("sellerAch.yourLevel")}</p>
              <p className="text-lg font-black text-text">{data.level ? name(data.level) : t("sellerAch.noLevel")}</p>
            </div>
          </div>
          <BadgeStrip badges={data.badges} max={8} />
        </div>

        {data.commission_reduction > 0 || data.featured_slots > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {data.commission_reduction > 0 ? (
              <li className="rounded-full bg-success-soft px-3 py-1 text-xs font-bold text-success-strong">
                {t("ach.rewardText_commission_reduction", { value: Number(data.commission_reduction) })}
              </li>
            ) : null}
            {data.featured_slots > 0 ? (
              <li className="rounded-full bg-success-soft px-3 py-1 text-xs font-bold text-success-strong">
                {t("sellerAch.featuredUse", { used: data.featured_used, total: data.featured_slots })}
              </li>
            ) : null}
          </ul>
        ) : null}

        {data.next ? (
          <div className="flex flex-col gap-2.5 rounded-md bg-surface-tint/40 p-3">
            <p className="flex items-center gap-2 text-sm font-bold text-text">
              <AchievementIcon icon={data.next.icon} color={data.next.color} size="xs" />
              {t("sellerAch.nextLevel", { name: name(data.next) })}
            </p>
            {data.next.goals.map((g, i) => {
              const pct = Math.min(100, Math.round((g.progress / Math.max(1, g.required)) * 100));
              return (
                <div key={i} className="flex flex-col gap-1">
                  <div className="flex justify-between gap-2 text-xs">
                    <span className="text-text">{describeGoal(t, g)}</span>
                    <span className="num font-bold text-text-muted" dir="ltr">{Math.min(g.progress, g.required)} / {g.required}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-border" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                    <div className="h-full rounded-full bg-action transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        ) : data.level ? (
          <p className="text-xs text-text-muted">{t("sellerAch.topLevel")}</p>
        ) : null}
      </CardBody>
    </Card>
  );
}

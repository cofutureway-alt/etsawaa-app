import { data } from "react-router";
import type { Route } from "./+types/levels";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { PageHeader } from "~/components/layout/PageHeader";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonPage } from "~/components/ui/Skeleton";
import { CheckIcon } from "~/components/ui/icons";

/**
 * Vendor → Levels & badges: every level with what it takes (successful
 * orders) and what it gives (commission, payout hold, extra rewards), where
 * this store stands, and every badge with what it means and whether the
 * store holds it.
 */

interface Level {
  id: string; name_ar: string; name_en: string; description_ar: string | null; description_en: string | null;
  icon: string | null; color: string | null; min_successful_orders: number; sort: number;
  rewards: { commission_percent?: number; hold_days?: number } | null;
}
interface Reward { level_id: string; reward_type: string; featured_count: number | null; commission_reduction: number | null; ad_package_id: string | null }
interface BadgeRow { id: string; name_ar: string; name_en: string; description_ar: string | null; description_en: string | null; icon: string | null; color: string | null }

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  const viewer = await requirePanelAccess(client, lang, "vendor", request);
  const { data: vendor } = await client.from("vendors").select("id, level_id").eq("owner_id", viewer.user.id).maybeSingle();
  const [levels, rewards, badges, mine, wallet] = await Promise.all([
    client.from("vendor_levels").select("id, name_ar, name_en, description_ar, description_en, icon, color, min_successful_orders, sort, rewards").eq("is_active", true).order("min_successful_orders"),
    client.from("level_rewards").select("level_id, reward_type, featured_count, commission_reduction, ad_package_id").order("sort"),
    client.from("badges").select("id, name_ar, name_en, description_ar, description_en, icon, color").eq("is_active", true).order("sort"),
    vendor ? client.from("vendor_badges").select("badge_id").eq("vendor_id", vendor.id) : Promise.resolve({ data: [] as Array<{ badge_id: string }> }),
    client.rpc("fn_vendor_wallet_view"),
  ]);
  const view = (wallet.data ?? {}) as { successful_orders?: number };
  return {
    lang,
    levels: (levels.data ?? []) as Level[],
    rewards: (rewards.data ?? []) as Reward[],
    badges: (badges.data ?? []) as BadgeRow[],
    myBadges: ((mine.data ?? []) as Array<{ badge_id: string }>).map((b) => b.badge_id),
    currentLevel: (vendor?.level_id as string | null) ?? null,
    orders: Number(view.successful_orders ?? 0),
  };
}

export default function VendorLevels({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { lang, levels, rewards, badges, myBadges, currentLevel, orders } = loaderData;
  const en = lang === "en";
  const pick = (ar: string | null, enV: string | null) => (en ? enV || ar : ar || enV) ?? "";
  const currentIdx = levels.findIndex((l) => l.id === currentLevel);
  const next = levels.find((l) => l.min_successful_orders > orders && levels.indexOf(l) > currentIdx) ?? null;
  const pct = next ? Math.min(100, Math.round((orders / Math.max(1, next.min_successful_orders)) * 100)) : 100;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("vlv.title")} subtitle={t("vlv.hint")} />

      <section className="rounded-lg border border-border bg-surface p-5 shadow-1">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-bold text-text-muted">{t("vlv.yourLevel")}</p>
            <p className="mt-1 text-xl font-black text-text">{currentIdx >= 0 ? pick(levels[currentIdx]!.name_ar, levels[currentIdx]!.name_en) : "—"}</p>
          </div>
          <p className="num text-sm text-text-muted">{t("vlv.ordersDone", { count: orders })}</p>
        </div>
        <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-surface-tint">
          <div className="h-full rounded-full bg-action" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-2 text-sm text-text">
          {next
            ? t("vlv.toNext", { count: Math.max(0, next.min_successful_orders - orders), name: pick(next.name_ar, next.name_en) })
            : t("vlv.top")}
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-extrabold text-text">{t("vlv.levels")}</h2>
        <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {levels.map((l, i) => {
            const mine = l.id === currentLevel;
            const extra = rewards.filter((r) => r.level_id === l.id);
            return (
              <li key={l.id} className={`flex flex-col gap-3 rounded-lg border bg-surface p-4 shadow-1 ${mine ? "border-action ring-2 ring-action/20" : "border-border"}`}>
                <div className="flex items-center gap-2">
                  <span className="grid size-9 place-items-center rounded-full text-sm font-black text-white" style={{ background: l.color || "var(--color-action)" }}>{i + 1}</span>
                  <h3 className="min-w-0 flex-1 truncate text-base font-extrabold text-text">{pick(l.name_ar, l.name_en)}</h3>
                  {mine ? <span className="rounded-full bg-action px-2 py-0.5 text-2xs font-black text-on-action">{t("vlv.current")}</span> : null}
                </div>
                {pick(l.description_ar, l.description_en) ? <p className="text-sm leading-relaxed text-text-muted">{pick(l.description_ar, l.description_en)}</p> : null}
                <div className="rounded-md bg-surface-tint/60 p-3 text-sm">
                  <p className="mb-1 text-xs font-extrabold text-text-muted">{t("vlv.requirement")}</p>
                  <p className="text-text">{l.min_successful_orders > 0 ? t("vlv.minOrders", { count: l.min_successful_orders }) : t("vlv.noRequirement")}</p>
                </div>
                <div className="text-sm">
                  <p className="mb-1 text-xs font-extrabold text-text-muted">{t("vlv.benefits")}</p>
                  <ul className="flex flex-col gap-1 text-text">
                    {l.rewards?.commission_percent != null ? <li className="flex gap-1.5"><CheckIcon className="mt-0.5 size-4 shrink-0 text-success" />{t("vlv.commission", { pct: l.rewards.commission_percent })}</li> : null}
                    {l.rewards?.hold_days != null ? <li className="flex gap-1.5"><CheckIcon className="mt-0.5 size-4 shrink-0 text-success" />{t("vlv.hold", { days: l.rewards.hold_days })}</li> : null}
                    {extra.map((r, j) => (
                      <li key={j} className="flex gap-1.5"><CheckIcon className="mt-0.5 size-4 shrink-0 text-success" />
                        {r.commission_reduction ? t("vlv.reduction", { pct: r.commission_reduction })
                          : r.featured_count ? t("vlv.featured", { count: r.featured_count })
                          : r.ad_package_id ? t("vlv.adPackage")
                          : t(`vlv.reward_${r.reward_type}`, { defaultValue: r.reward_type })}
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-extrabold text-text">{t("vlv.badges")}</h2>
        {badges.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-5 text-center text-sm text-text-muted">{t("vlv.noBadges")}</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {badges.map((b) => {
              const has = myBadges.includes(b.id);
              return (
                <li key={b.id} className={`flex gap-3 rounded-lg border bg-surface p-4 shadow-1 ${has ? "border-success" : "border-border"}`}>
                  <span className="grid size-10 shrink-0 place-items-center rounded-full text-lg text-white" style={{ background: b.color || "var(--color-action)" }} aria-hidden="true">★</span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-extrabold text-text">
                      {pick(b.name_ar, b.name_en)}
                      {has ? <span className="rounded-full bg-success-soft px-2 py-0.5 text-2xs font-black text-success-strong">{t("vlv.earned")}</span> : null}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-text-muted">{pick(b.description_ar, b.description_en) || t("vlv.badgeNoDesc")}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}
export function HydrateFallback() {
  return <SkeletonPage />;
}

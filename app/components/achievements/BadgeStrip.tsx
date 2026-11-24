import { useTranslation } from "react-i18next";
import { AchievementIcon } from "./AchievementIcon";

export interface EarnedBadge {
  id: string; name_ar: string; name_en: string; description_ar: string; description_en: string;
  icon: string; color: string;
}

/**
 * A store's earned badges as a compact icon row (no text labels). The name
 * and description show on hover/focus; past `max` icons a "+N" chip opens the
 * full set, so a store with many badges keeps a one-line header.
 */
export function BadgeStrip({ badges, max = 6 }: { badges: EarnedBadge[]; max?: number }) {
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  if (badges.length === 0) return null;
  const label = (b: EarnedBadge) => {
    const name = en ? b.name_en : b.name_ar;
    const desc = en ? b.description_en : b.description_ar;
    return desc ? `${name} — ${desc}` : name;
  };
  const shown = badges.slice(0, max);
  const rest = badges.slice(max);
  return (
    <div className="flex items-center gap-1" aria-label={t("store.badges", { count: badges.length })} role="list">
      {shown.map((b) => (
        <span key={b.id} role="listitem" tabIndex={0} className="rounded-full focus:outline-none focus-visible:shadow-focus">
          <AchievementIcon icon={b.icon} color={b.color} size="sm" title={label(b)} />
        </span>
      ))}
      {rest.length > 0 ? (
        <details className="relative">
          <summary className="flex size-8 cursor-pointer list-none items-center justify-center rounded-full border border-border bg-surface text-2xs font-black text-text-muted hover:text-action [&::-webkit-details-marker]:hidden">
            +{rest.length}
          </summary>
          <div className="absolute end-0 top-10 z-20 flex w-64 flex-col gap-2 rounded-lg border border-border bg-surface p-3 shadow-2">
            {badges.map((b) => (
              <span key={b.id} className="flex items-center gap-2">
                <AchievementIcon icon={b.icon} color={b.color} size="xs" />
                <span className="min-w-0 text-xs">
                  <span className="block truncate font-bold text-text">{en ? b.name_en : b.name_ar}</span>
                  {(en ? b.description_en : b.description_ar) ? (
                    <span className="block truncate text-text-muted">{en ? b.description_en : b.description_ar}</span>
                  ) : null}
                </span>
              </span>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

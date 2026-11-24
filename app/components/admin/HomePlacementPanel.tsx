/**
 * Admin product review → "Home page visibility": the reviewer picks the home
 * sections the product leads (no ad package needed), marks it featured, and
 * optionally limits it to a period. Saved with the approval decision, or on
 * its own for a product that is already live (fn_admin_set_home_picks).
 */
import { useTranslation } from "react-i18next";

export const HOME_PICK_SECTIONS = ["featured", "best", "discounts", "best_selling", "top_rated", "recent"] as const;
export type HomePickSection = (typeof HOME_PICK_SECTIONS)[number];
export interface HomePickRow { section: string; starts_at: string | null; ends_at: string | null }
export interface HomePickState { sections: string[]; from: string; to: string }

const LABEL: Record<HomePickSection, string> = {
  featured: "productReview.home.featured",
  best: "home.sections.best",
  discounts: "home.sections.discounts",
  best_selling: "home.sections.bestSellers",
  top_rated: "home.sections.topRated",
  recent: "home.sections.recent",
};

const pad = (n: number) => String(n).padStart(2, "0");
const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Saved rows → the form (the end day is shown inclusive). */
export function pickStateFrom(rows: HomePickRow[]): HomePickState {
  const first = rows[0];
  const end = first?.ends_at ? new Date(new Date(first.ends_at).getTime() - 86_400_000) : null;
  return {
    sections: rows.map((r) => r.section),
    from: first?.starts_at ? localDay(new Date(first.starts_at)) : "",
    to: end ? localDay(end) : "",
  };
}

/** The form → fields for the action: local start of the first day, start of the day after the last one. */
export function pickFields(s: HomePickState): Record<string, string> {
  const at = (day: string, addDays = 0) => {
    const d = new Date(`${day}T00:00`);
    d.setDate(d.getDate() + addDays);
    return d.toISOString();
  };
  return {
    home_sections: JSON.stringify(s.sections),
    home_from: s.from ? at(s.from) : "",
    home_to: s.to ? at(s.to, 1) : "",
  };
}

export function HomePlacementPanel({ value, onChange, disabled, onSave, saving, live }: {
  value: HomePickState;
  onChange: (next: HomePickState) => void;
  disabled?: boolean;
  /** shown for a product that is already approved: save without a decision */
  onSave?: () => void;
  saving?: boolean;
  /** currently visible on the home page */
  live: boolean;
}) {
  const { t } = useTranslation();
  const toggle = (s: string) => onChange({ ...value, sections: value.sections.includes(s) ? value.sections.filter((x) => x !== s) : [...value.sections, s] });
  const badPeriod = Boolean(value.from && value.to && value.to < value.from);

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-1" aria-labelledby="home-pick-title">
      <div className="flex items-center justify-between gap-2">
        <h2 id="home-pick-title" className="text-base font-extrabold text-text">{t("productReview.home.title")}</h2>
        {live ? <span className="rounded-full bg-success-soft px-2 py-0.5 text-2xs font-extrabold text-success">{t("productReview.home.live")}</span> : null}
      </div>
      <p className="-mt-1 text-xs text-text-muted">{t("productReview.home.hint")}</p>

      <fieldset disabled={disabled} className="flex flex-col gap-1.5">
        <legend className="sr-only">{t("productReview.home.sections")}</legend>
        {HOME_PICK_SECTIONS.map((s) => (
          <label key={s} className={`flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 text-sm font-bold transition-colors ${
            value.sections.includes(s) ? "border-action bg-surface-tint text-action" : "border-border text-text hover:border-action/50"}`}>
            <input type="checkbox" className="size-4 accent-[var(--color-action)]" checked={value.sections.includes(s)} onChange={() => toggle(s)} />
            <span className="flex-1">{t(LABEL[s])}</span>
            {s === "featured" ? <span className="text-2xs font-semibold text-text-muted">{t("productReview.home.featuredHint")}</span> : null}
          </label>
        ))}
      </fieldset>

      <fieldset disabled={disabled || value.sections.length === 0} className="flex flex-col gap-2 disabled:opacity-60">
        <legend className="mb-1 text-sm font-bold text-text">{t("productReview.home.period")}</legend>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs font-bold text-text-muted">
            {t("productReview.home.from")}
            <input type="date" value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })}
              className="h-10 rounded-md border border-border bg-surface px-2 text-sm text-text" dir="ltr" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-bold text-text-muted">
            {t("productReview.home.to")}
            <input type="date" value={value.to} min={value.from || undefined} onChange={(e) => onChange({ ...value, to: e.target.value })}
              aria-invalid={badPeriod || undefined}
              className={`h-10 rounded-md border bg-surface px-2 text-sm text-text ${badPeriod ? "border-danger" : "border-border"}`} dir="ltr" />
          </label>
        </div>
        <span className={`text-xs ${badPeriod ? "text-danger" : "text-text-muted"}`}>{t(badPeriod ? "productReview.home.badPeriod" : "productReview.home.periodHint")}</span>
      </fieldset>

      {onSave ? (
        <button type="button" onClick={onSave} disabled={disabled || saving || badPeriod}
          className="h-10 cursor-pointer rounded-md border border-action px-3 text-sm font-bold text-action transition-colors hover:bg-surface-tint disabled:cursor-not-allowed disabled:opacity-50">
          {t("productReview.home.save")}
        </button>
      ) : <p className="text-xs text-text-muted">{t("productReview.home.withDecision")}</p>}
    </section>
  );
}

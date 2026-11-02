import type { ReactNode } from "react";

/**
 * One page header for every admin/vendor screen.
 *
 * There were three competing patterns — a hero card (coupons, ads, events,
 * banners, customers, catalog), a bare `text-lg` heading (levels, penalties,
 * zones, reviews, users, products), and `text-xl sm:text-2xl` (catalog
 * categories) — so no two admin pages opened the same way. This keeps the
 * incumbent hero look (surface card, soft border, count chip, muted subtitle,
 * action on the far side) and makes it the only one.
 *
 * The count chip is opt-in via `count`: pages that list nothing (settings
 * forms) omit it rather than showing "0".
 */
export interface PageHeaderProps {
  title: string;
  /** Short line under the title. Keep it to what the page is for. */
  subtitle?: string;
  /** Row count / entity count rendered as a chip next to the title. */
  count?: number | string;
  /** Right-aligned controls (usually a primary action). */
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, count, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-1 sm:p-6 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-black text-text sm:text-2xl">{title}</h1>
          {count !== undefined && count !== "" ? (
            <span className="num shrink-0 rounded-full bg-surface-tint px-2 py-0.5 text-2xs font-bold text-action" dir="ltr">
              {count}
            </span>
          ) : null}
        </div>
        {subtitle ? <p className="text-xs text-text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

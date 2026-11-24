import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { PERMISSION_GROUPS, permKey } from "~/lib/permissions";
import {
  ChartIcon, FileIcon, GridIcon, ListIcon, MegaphoneIcon, PackageIcon, SearchIcon, SettingsIcon,
  StarIcon, StoreIcon, TagIcon, UsersIcon,
} from "~/components/ui/icons";

const GROUP_ICONS: Record<string, ReactNode> = {
  dashboard: <ChartIcon />, orders: <ListIcon />, vendors: <StoreIcon />, users: <UsersIcon />,
  products: <TagIcon />, packaging: <PackageIcon />, marketing: <MegaphoneIcon />, catalog: <GridIcon />,
  trust: <StarIcon />, reports: <ChartIcon />, content: <FileIcon />, platform: <SettingsIcon />, support: <UsersIcon />,
};

/** Accessible on/off switch (a styled checkbox with role="switch"). */
export function Switch({ checked, onChange, label, disabled }: {
  checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-action)] disabled:opacity-50 ${
        checked ? "border-action bg-action" : "border-border bg-surface-alt"
      }`}
    >
      <span
        aria-hidden
        className={`absolute top-0.5 size-[18px] rounded-full bg-white shadow-sm transition-[inset-inline-start] duration-150 ${
          checked ? "start-[22px]" : "start-0.5"
        }`}
      />
    </button>
  );
}

/**
 * Grouped permission editor: one card per area with a "select all" switch,
 * a switch per permission with its plain-language hint, and search.
 * `baseline` (the role's defaults) marks each difference as Added/Removed —
 * used for per-person overrides on a staff profile.
 */
export function PermissionMatrix({ value, onChange, baseline, disabled }: {
  value: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  baseline?: ReadonlySet<string>;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const term = q.trim().toLowerCase();

  const groups = useMemo(() => PERMISSION_GROUPS.map((g) => ({
    ...g,
    perms: g.perms.filter((p) => !term
      || t(`perm.${permKey(p)}`).toLowerCase().includes(term)
      || t(`permHint.${permKey(p)}`).toLowerCase().includes(term)
      || t(`permGroup.${g.id}`).toLowerCase().includes(term)),
  })).filter((g) => g.perms.length > 0), [term, t]);

  function set(perm: string, on: boolean) {
    const next = new Set(value);
    if (on) next.add(perm); else next.delete(perm);
    onChange(next);
  }
  function setGroup(perms: readonly string[], on: boolean) {
    const next = new Set(value);
    for (const p of perms) if (on) next.add(p); else next.delete(p);
    onChange(next);
  }

  return (
    <div>
      <label className="relative block max-w-sm">
        <span className="sr-only">{t("ro.search")}</span>
        <SearchIcon className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("ro.search")}
          className="h-10 w-full rounded-md border border-border bg-surface ps-9 pe-3 text-sm text-text placeholder:text-text-muted focus:border-action focus:outline-none"
        />
      </label>

      {groups.length === 0 ? (
        <p className="mt-4 text-sm text-text-muted">{t("ro.noMatch")}</p>
      ) : (
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {groups.map((g) => {
            const full = PERMISSION_GROUPS.find((x) => x.id === g.id)?.perms ?? g.perms;
            const on = full.filter((p) => value.has(p)).length;
            return (
              <section key={g.id} className="rounded-lg border border-border bg-surface">
                <header className="flex items-center gap-3 border-b border-border px-4 py-3">
                  <span aria-hidden className="grid size-8 place-items-center rounded-md bg-surface-alt text-text-muted">
                    {GROUP_ICONS[g.id]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-extrabold text-text">{t(`permGroup.${g.id}`)}</h3>
                    <p className="num text-xs text-text-muted">{t("ro.countOn", { on, total: full.length })}</p>
                  </div>
                  <Switch
                    checked={on === full.length}
                    onChange={(next) => setGroup(full, next)}
                    label={t("ro.selectAll", { group: t(`permGroup.${g.id}`) })}
                    disabled={disabled}
                  />
                </header>
                <ul className="divide-y divide-border">
                  {g.perms.map((p) => {
                    const checked = value.has(p);
                    const diff = baseline ? (checked && !baseline.has(p) ? "added" : !checked && baseline.has(p) ? "removed" : null) : null;
                    return (
                      <li key={p} className="flex items-start gap-3 px-4 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-text">
                            {t(`perm.${permKey(p)}`)}
                            {diff ? (
                              <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                                diff === "added" ? "bg-success-soft text-success-strong" : "bg-danger-soft text-danger"
                              }`}>
                                {t(diff === "added" ? "ro.added" : "ro.removed")}
                              </span>
                            ) : null}
                          </p>
                          <p className="mt-0.5 text-xs text-text-muted">{t(`permHint.${permKey(p)}`)}</p>
                        </div>
                        <Switch checked={checked} onChange={(next) => set(p, next)} label={t(`perm.${permKey(p)}`)} disabled={disabled} />
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

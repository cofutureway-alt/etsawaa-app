import type { ReactNode } from "react";
import { NavLink } from "react-router";

export interface SidebarItem {
  to: string;
  label: string;
  end?: boolean;
  icon?: ReactNode;
  /** Optional counter pill (e.g. pending approvals) — reference `badge-nav`. */
  badge?: number;
  /** Upcoming-phase item: rendered as non-interactive with its phase number. */
  disabled?: boolean;
  phase?: string;
}

export interface SidebarGroup {
  /** Section caption (reference `side-label`). */
  label?: string;
  items: SidebarItem[];
}

/**
 * Panel navigation matching the reference sidebar: dark shell, grouped
 * sections, icon + label rows, active row filled with brand red, optional
 * counter badge, and a collapsed rail (icons only, label via title/aria).
 */
export function SidebarNav({
  groups,
  label,
  collapsed = false,
}: {
  groups: SidebarGroup[];
  label: string;
  collapsed?: boolean;
}) {
  return (
    <nav aria-label={label} className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2.5">
      {groups.map((group, groupIndex) => (
        <div key={group.label ?? groupIndex} className="flex flex-col gap-0.5">
          {group.label ? (
            <p
              className={`px-2.5 pb-1 pt-3 text-2xs font-extrabold uppercase tracking-[1.5px] text-side-muted ${
                collapsed ? "sr-only" : ""
              }`}
            >
              {group.label}
            </p>
          ) : null}
          {group.items.map((item) =>
            item.disabled ? (
              <span
                key={item.to}
                aria-disabled="true"
                title={collapsed ? item.label : item.phase}
                className={`flex cursor-not-allowed items-center gap-2.5 rounded-sm border-s-[3px] border-transparent px-2.5 py-2.5 text-sm font-semibold text-side-muted ${
                  collapsed ? "justify-center" : ""
                }`}
              >
                <span aria-hidden="true" className="shrink-0 text-lg leading-none">
                  {item.icon}
                </span>
                <span className={collapsed ? "sr-only" : "truncate"}>{item.label}</span>
                {item.phase ? (
                  <span
                    className={`ms-auto rounded-full bg-featured px-1.5 text-2xs font-extrabold text-ink ${
                      collapsed ? "hidden" : ""
                    }`}
                  >
                    {item.phase}
                  </span>
                ) : null}
              </span>
            ) : (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                title={collapsed ? item.label : undefined}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 rounded-sm border-s-[3px] py-2.5 text-sm font-semibold transition-colors duration-150 ${
                    collapsed ? "justify-center px-2.5" : "px-2.5"
                  } ${
                    isActive
                      ? "border-action bg-action text-white"
                      : "border-transparent text-side-text hover:bg-side-hover hover:text-white"
                  }`
                }
              >
                <span aria-hidden="true" className="shrink-0 text-lg leading-none">
                  {item.icon}
                </span>
                <span className={collapsed ? "sr-only" : "truncate"}>{item.label}</span>
                {item.badge !== undefined && item.badge > 0 ? (
                  <span
                    className={`num ms-auto rounded-full bg-featured px-1.5 text-2xs font-extrabold text-ink ${
                      collapsed ? "hidden" : ""
                    }`}
                  >
                    {item.badge}
                  </span>
                ) : null}
              </NavLink>
            ),
          )}
        </div>
      ))}
    </nav>
  );
}

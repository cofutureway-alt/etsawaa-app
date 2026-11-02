import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Drawer } from "~/components/ui";
import { MenuIcon, PanelLeftIcon, StoreIcon, XIcon } from "~/components/ui/icons";
import { SidebarNav, type SidebarGroup } from "./SidebarNav";

export interface PanelShellProps {
  lang: string;
  siteName: string;
  panelTitle: string;
  subtitle: string;
  groups: SidebarGroup[];
  /** Topbar right-side actions (language switch, notifications…). */
  actions?: ReactNode;
  children: ReactNode;
}

/**
 * Dashboard shell per the reference: deep-red sticky sidebar (240px, rail
 * 64px when collapsed) + topbar with collapse button, page title and actions.
 * Mobile: the sidebar becomes a drawer opened from the topbar hamburger.
 */
export function PanelShell({
  lang,
  siteName,
  panelTitle,
  subtitle,
  groups,
  actions,
  children,
}: PanelShellProps) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const sidebarInner = (
    <>
      <div
        className={`flex min-h-[72px] items-center gap-2.5 border-b border-side-line px-3.5 ${
          collapsed ? "justify-center px-2" : ""
        }`}
      >
        <Link to={`/${lang}`} aria-label={siteName} className="shrink-0">
          {collapsed ? (
            <img src="/logo-symbol.webp" alt={siteName} width={200} height={245} className="h-8 w-auto" />
          ) : (
            <img src="/logo-mark.webp" alt={siteName} width={548} height={245} className="h-9 w-auto" />
          )}
        </Link>
        <span className={`truncate text-sm font-black text-white ${collapsed ? "hidden" : ""}`}>
          {panelTitle}
        </span>
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          aria-label={t("nav.menu")}
          aria-pressed={collapsed}
          className="ms-auto hidden size-8 cursor-pointer items-center justify-center rounded-sm text-side-text transition-colors duration-150 hover:bg-side-hover hover:text-white lg:flex"
        >
          <PanelLeftIcon />
        </button>
      </div>
      <SidebarNav groups={groups} label={panelTitle} collapsed={collapsed} />
      <div className="border-t border-side-line p-2.5">
        <Link
          to={`/${lang}`}
          title={collapsed ? subtitle : undefined}
          className={`flex items-center gap-2.5 rounded-sm bg-white/5 px-2.5 py-2.5 text-[12.5px] font-bold text-white transition-colors duration-150 hover:bg-white/10 ${
            collapsed ? "justify-center" : ""
          }`}
        >
          <StoreIcon aria-hidden="true" className="size-4" />
          <span className={collapsed ? "sr-only" : "truncate"}>{t("nav.home")}</span>
        </Link>
      </div>
    </>
  );

  return (
    <div className="min-h-dvh bg-surface-alt">
      <meta name="robots" content="noindex, nofollow" />
      <div className="flex min-h-dvh">
        {/* Desktop sidebar: sticky, deep brand shell */}
        <aside
          className="sticky top-0 hidden h-dvh shrink-0 flex-col bg-side text-side-text transition-[width] duration-200 lg:flex"
          style={{ width: collapsed ? "var(--sidebar-w-collapsed)" : "var(--sidebar-w)" }}
        >
          {sidebarInner}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Topbar — on phones it carries the brand mark, page title and menu */}
          <header className="sticky top-0 z-40 flex min-h-[64px] items-center gap-3 border-b border-border bg-surface px-4 sm:px-6 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label={t("nav.menu")}
              aria-haspopup="dialog"
              className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-md text-text transition-colors duration-150 hover:bg-surface-tint lg:hidden"
            >
              <MenuIcon />
            </button>
            <Link to={`/${lang}`} aria-label={siteName} className="shrink-0 lg:hidden">
              <img src="/logo-symbol.webp" alt="" width={200} height={245} className="h-7 w-auto" />
            </Link>
            <div className="min-w-0">
              <p className="truncate text-sm font-black text-text">{panelTitle}</p>
              <p className="truncate text-xs text-text-muted max-sm:hidden">{subtitle}</p>
            </div>
            <div className="ms-auto flex shrink-0 items-center gap-2.5">{actions}</div>
          </header>

          <main className="min-w-0 flex-1 px-3 sm:px-6 py-6">
            <div className="mx-auto w-full max-w-[1440px]">{children}</div>
          </main>
        </div>
      </div>

      {/* Mobile drawer: the same dark sidebar, brand header included */}
      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={panelTitle}
        header={
          <div className="flex min-h-[64px] items-center gap-2.5 border-b border-side-line bg-side px-3.5">
            <img src="/logo-mark.webp" alt={siteName} width={548} height={245} className="h-9 w-auto" />
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label={t("common.close")}
              className="ms-auto flex size-9 cursor-pointer items-center justify-center rounded-sm text-side-text transition-colors duration-150 hover:bg-side-hover hover:text-white"
            >
              <XIcon aria-hidden="true" />
            </button>
          </div>
        }
      >
        <div className="-m-4 flex h-[calc(100%_+_2rem)] flex-col bg-side">
          <SidebarNav groups={groups} label={panelTitle} />
        </div>
      </Drawer>
    </div>
  );
}

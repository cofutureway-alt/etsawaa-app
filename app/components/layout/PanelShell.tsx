import { useEffect, useId, useState, type ReactNode } from "react";
import { Link, useLocation, useRouteLoaderData } from "react-router";
import type { RootLoaderData } from "~/features/settings/api";
import { useTranslation } from "react-i18next";
import { Drawer } from "~/components/ui";
import { CheckIcon, ChevronDownIcon, GridIcon, HomeIcon, MailIcon, MenuIcon, PanelLeftIcon, StoreIcon, UsersIcon, XIcon } from "~/components/ui/icons";
import { SidebarNav, type SidebarGroup } from "./SidebarNav";

/** One dashboard the signed-in user can open (label stays an i18n key). */
export interface PanelLink {
  to: string;
  labelKey: string;
  current?: boolean;
}

export interface PanelShellProps {
  lang: string;
  siteName: string;
  panelTitle: string;
  subtitle: string;
  groups: SidebarGroup[];
  /** dashboards this user can switch between (admin / seller / account) */
  panels: PanelLink[];
  /** Topbar right-side actions (language switch, notifications…). */
  actions?: ReactNode;
  /** Phone-only bottom navigation (MobileBottomNav). */
  bottomNav?: ReactNode;
  children: ReactNode;
}

/** Full-width dark "home" row — drawer top and desktop sidebar footer. */
function HomeRow({ lang, onNavigate }: { lang: string; onNavigate?: () => void }) {
  const { t } = useTranslation();
  return (
    <Link
      to={`/${lang}`}
      onClick={onNavigate}
      className="flex min-h-11 items-center gap-2.5 rounded-sm bg-white/5 px-2.5 py-2.5 text-xs font-bold text-white transition-colors duration-150 hover:bg-white/10"
    >
      <HomeIcon aria-hidden="true" className="size-4 shrink-0" />
      <span className="truncate">{t("nav.goHome")}</span>
    </Link>
  );
}

/** Accessible disclosure (button + list of links) over the panels this user can open. */
function PanelSwitcher({ panels, onNavigate }: { panels: PanelLink[]; onNavigate?: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const listId = useId();
  const root = useRouteLoaderData("root") as RootLoaderData | undefined;
  const site = root?.site;
  // the staff portal is for the team only: shown when this person can open the admin panel (admin / staff)
  const isTeam = panels.some((panel) => panel.to.endsWith("/admin"));
  const portal = isTeam && site?.portal_url ? { url: site.portal_url, label: root?.locale === "en" ? site.portal_label_en : site.portal_label_ar } : null;
  if (panels.length < 2 && !portal && !isTeam) return null;
  return (
    <div className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-sm bg-white/5 px-2.5 py-2.5 text-xs font-bold text-white transition-colors duration-150 hover:bg-white/10"
      >
        <GridIcon aria-hidden="true" className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-start">{t("nav.switchDashboard")}</span>
        <ChevronDownIcon aria-hidden="true" className={`size-4 shrink-0 transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>
      <ul id={listId} hidden={!open} className="flex flex-col gap-0.5 pt-1 ps-2">
        {panels.map((panel) => (
          <li key={panel.to}>
            <Link
              to={panel.to}
              onClick={onNavigate}
              aria-current={panel.current ? "page" : undefined}
              className={`flex min-h-10 items-center gap-2 rounded-sm px-2.5 py-2 text-xs transition-colors duration-150 ${
                panel.current ? "bg-white/10 font-black text-white" : "font-bold text-side-text hover:bg-white/10 hover:text-white"
              }`}
            >
              {panel.current ? <CheckIcon aria-hidden="true" className="size-3.5 shrink-0" /> : <span aria-hidden="true" className="size-3.5 shrink-0" />}
              <span className="truncate">{t(panel.labelKey)}</span>
            </Link>
          </li>
        ))}
        {portal ? (
          <li>
            <a href={portal.url} target="_blank" rel="noopener noreferrer"
              className="flex min-h-10 items-center gap-2 rounded-sm px-2.5 py-2 text-xs font-bold text-side-text transition-colors duration-150 hover:bg-white/10 hover:text-white">
              <UsersIcon aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="truncate">{portal.label}</span>
              <span aria-hidden="true" className="ms-auto text-2xs opacity-70">↗</span>
            </a>
          </li>
        ) : null}
        {/* company mail: the team only (same rule as the staff portal) */}
        {isTeam && root?.teamMailUrl ? (
          <li>
            <a href={root.teamMailUrl} target="_blank" rel="noopener noreferrer"
              className="flex min-h-10 items-center gap-2 rounded-sm px-2.5 py-2 text-xs font-bold text-side-text transition-colors duration-150 hover:bg-white/10 hover:text-white">
              <MailIcon aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="truncate">{t("nav.teamMail")}</span>
              <span aria-hidden="true" className="ms-auto text-2xs opacity-70">↗</span>
            </a>
          </li>
        ) : null}
      </ul>
    </div>
  );
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
  panels,
  actions,
  bottomNav,
  children,
}: PanelShellProps) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // safety net: any navigation (link, history, redirect) closes the phone menu
  const { pathname } = useLocation();
  useEffect(() => setDrawerOpen(false), [pathname]);
  // a page may ask for the rail (the product wizard needs the width); it
  // hands the previous state back when it unmounts
  useEffect(() => {
    const onRequest = (event: Event) => {
      const want = (event as CustomEvent<{ collapsed: boolean }>).detail?.collapsed;
      if (typeof want === "boolean") setCollapsed(want);
    };
    window.addEventListener("etsawaa:sidebar", onRequest);
    return () => window.removeEventListener("etsawaa:sidebar", onRequest);
  }, []);

  const sidebarInner = (
    <>
      <div
        className={`flex min-h-[72px] items-center gap-2 border-b border-side-line px-3 ${
          collapsed ? "justify-center px-2" : ""
        }`}
      >
        {/* The wordmark already carries the brand name, so the panel title sits
            beneath it rather than competing for the same line — the two
            overlapped at every width once the title was long (Arabic). */}
        <div className={`flex min-w-0 flex-1 flex-col gap-0.5 ${collapsed ? "hidden" : ""}`}>
          <Link to={`/${lang}`} aria-label={siteName} className="shrink-0 self-start">
            <img src="/logo-mark.webp" alt="" width={548} height={245} className="h-7 w-auto" />
          </Link>
          <span className="truncate text-2xs font-bold text-side-muted">{panelTitle}</span>
        </div>
        {collapsed ? (
          <Link to={`/${lang}`} aria-label={siteName} className="shrink-0">
            <img src="/logo-symbol.webp" alt="" width={200} height={245} className="h-8 w-auto" />
          </Link>
        ) : null}
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          aria-label={t("nav.menu")}
          aria-pressed={collapsed}
          className="hidden size-8 shrink-0 cursor-pointer items-center justify-center rounded-sm text-side-text transition-colors duration-150 hover:bg-side-hover hover:text-white lg:flex"
        >
          <PanelLeftIcon />
        </button>
      </div>
      <SidebarNav groups={groups} label={panelTitle} collapsed={collapsed} />
      <div className="flex flex-col gap-1 border-t border-side-line p-2.5">
        {collapsed ? (
          <Link
            to={`/${lang}`}
            title={subtitle}
            className="flex items-center justify-center rounded-sm bg-white/5 px-2.5 py-2.5 text-white transition-colors duration-150 hover:bg-white/10"
          >
            <StoreIcon aria-hidden="true" className="size-4" />
            <span className="sr-only">{t("nav.goHome")}</span>
          </Link>
        ) : (
          <>
            <HomeRow lang={lang} />
            <PanelSwitcher panels={panels} />
          </>
        )}
      </div>
    </>
  );

  return (
    // relative + overflow-x-clip: nothing inside (a hidden label left in a
    // wide table, a long word) can make the page wider than the phone; clip
    // (not hidden) keeps the sticky header working
    <div className="relative min-h-dvh overflow-x-clip bg-surface-alt">
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
          <header className="sticky top-0 z-40 flex min-h-[64px] items-center gap-3 border-b border-border bg-surface px-4 sm:px-6 shadow-1">
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

      {bottomNav}

      {/* Mobile drawer: the same dark sidebar, brand header included */}
      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={panelTitle}
        header={
          <div className="flex min-h-[64px] items-center gap-2.5 border-b border-side-line bg-side px-3.5">
            <Link to={`/${lang}`} onClick={() => setDrawerOpen(false)} aria-label={siteName} className="shrink-0">
              <img src="/logo-mark.webp" alt="" width={548} height={245} className="h-9 w-auto" />
            </Link>
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
          <SidebarNav
            groups={groups}
            label={panelTitle}
            onNavigate={() => setDrawerOpen(false)}
          />
          {/* pinned footer (desktop parity): homes + panel switcher stay put,
              the nav above scrolls. Grows upward when the switcher opens. */}
          <div className="flex shrink-0 flex-col gap-1 border-t border-side-line p-2.5">
            <HomeRow lang={lang} onNavigate={() => setDrawerOpen(false)} />
            <PanelSwitcher panels={panels} onNavigate={() => setDrawerOpen(false)} />
          </div>
        </div>
      </Drawer>
    </div>
  );
}

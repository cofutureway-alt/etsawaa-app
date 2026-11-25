import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import type { Route } from "./+types/account";
import { useTranslation } from "react-i18next";
import { requireLang } from "~/lib/lang.server";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { getViewerContext, requirePanelAccess } from "~/lib/auth/guards";
import { IdentityCard } from "~/features/account/IdentityCard";
import { RoutePending } from "~/components/layout/RoutePending";
import {
  BellIcon,
  ChartIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  HeartIcon,
  PackageIcon,
  ReceiptIcon,
  RotateIcon,
  StarIcon,
  TruckIcon,
  UserIcon,
  WalletIcon,
} from "~/components/ui/icons";

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) {
    // No database: cannot verify a session — redirect to login with a reason.
    throw Response.redirect(new URL(`/${lang}/auth/login?error=db`, request.url).toString(), 302);
  }
  const viewer = await requirePanelAccess(client, lang, "account", request);
  // unread count comes with the request's viewer context — no extra query
  const { ctx } = await getViewerContext(client);
  return { lang, viewer, unread: ctx?.unread ?? 0 };
}

/**
 * H-01 redesign — Account panel (professional, identity-first):
 *  - identity banner uses the brand side tokens (same DNA as the panel sidebars)
 *  - desktop: persistent right-hand (RTL-aware) sidebar with per-tab icons and
 *    a colored active edge; mobile: horizontally scrollable hotbar with the
 *    same active state (aria-current announced)
 *  - breadcrumbs on top so the storefront frame stays discoverable
 *  - logout/language/notifications keep their real behavior
 * Flat tokens only; no gradients; RTL-first; WCAG AA contrast pairs.
 */
export default function AccountLayout({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { lang, viewer, unread } = loaderData;

  const nav = [
    { to: `/${lang}/account`, label: t("account.overview"), end: true, Icon: ChartIcon },
    { to: `/${lang}/account/orders`, label: t("account.ordersTab"), end: false, Icon: PackageIcon },
    { to: `/${lang}/account/returns`, label: t("account.returnsTab"), end: false, Icon: RotateIcon },
    { to: `/${lang}/account/wallet`, label: t("wallet.title"), end: false, Icon: WalletIcon },
    { to: `/${lang}/account/addresses`, label: t("account.addressesTab"), end: false, Icon: TruckIcon },
    { to: `/${lang}/account/reviews`, label: t("account.reviewsTab"), end: false, Icon: StarIcon },
    { to: `/${lang}/account/wishlist`, label: t("account.wishlistTab"), end: false, Icon: HeartIcon },
    { to: `/${lang}/account/recent`, label: t("account.recentTab"), end: false, Icon: ReceiptIcon },
    { to: `/${lang}/account/notifications`, label: t("account.notifications"), end: false, Icon: BellIcon },
    { to: `/${lang}/account/profile`, label: t("account.profile"), end: false, Icon: UserIcon },
  ].filter((n) => n.to);

  return (
    <div className="mx-auto w-full max-w-page px-4 py-6">
      <meta name="robots" content="noindex, nofollow" />
      {/* breadcrumbs (storefront frame context) */}
      <nav aria-label="breadcrumb" className="mb-4 flex items-center gap-1.5 text-xs text-text-muted">
        <a href={`/${lang}`} className="hover:text-action">{t("nav.home")}</a>
        <ChevronLeftIcon aria-hidden="true" width={12} height={12} className="text-text-faint rtl:rotate-0 ltr:rotate-180" />
        <span aria-current="page" className="font-bold text-text">{t("account.title")}</span>
      </nav>

      <IdentityCard
        lang={lang}
        fullName={viewer.profile.full_name}
        phone={viewer.profile.phone}
        avatarPath={viewer.profile.avatar_url}
        bannerPath={viewer.profile.banner_url ?? null}
        unread={unread}
      />

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:gap-6">
        {/* desktop sidebar */}
        <aside className="hidden w-60 shrink-0 lg:block" aria-label={t("account.title")}>
          <nav className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-2">
            {nav.map(({ to, label, end, Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-md border-s-[3px] px-3 py-2.5 text-sm font-bold transition-colors duration-150 ${
                    isActive
                      ? "border-action bg-surface-tint text-action"
                      : "border-transparent text-text-muted hover:bg-surface-tint/60 hover:text-text"
                  }`
                }
              >
                <Icon aria-hidden="true" width={17} height={17} />
                <span className="truncate">{label}</span>
              </NavLink>
            ))}
          </nav>
          <p className="mt-3 px-2 text-2xs leading-relaxed text-text-faint">{t("account.signedInAs")}: {viewer.profile.role}</p>
        </aside>

        {/* content + mobile tab hotbar */}
        <div className="min-w-0 flex-1">
          {/* mobile: account-sections DROPDOWN — one button opens the whole
              menu; picking an entry closes it (owner rule). Desktop (≥lg)
              keeps the persistent sidebar untouched. */}
          <MobileTabsDropdown nav={nav} />

          <RoutePending>
            <Outlet />
          </RoutePending>
        </div>
      </div>
    </div>
  );
}

/**
 * Mobile account menu (owner round 4): collapse ALL account sections into one
 * dropdown. The trigger shows the CURRENT section (icon + label) with a
 * chevron; the list opens under it and any selection navigates + closes
 * (including the current page — the user expects a close-on-pick behavior).
 * Rendered below lg only; the desktop sidebar remains the primary nav there.
 */
function MobileTabsDropdown({ nav }: { nav: Array<{ to: string; label: string; end: boolean; Icon: (p: { width: number; height: number; "aria-hidden"?: boolean | "true" | "false"; className?: string }) => React.ReactNode }> }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const location = useLocation();
  const current = nav.find((n) => (n.end ? location.pathname === n.to : location.pathname.startsWith(n.to)))
    ?? nav.find((n) => n.end)
    ?? nav[0];
  const CurrentIcon = current?.Icon ?? ChartIcon;

  return (
    <div ref={boxRef} className="relative mb-4 lg:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t("account.title")}
        className="flex min-h-12 w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm font-extrabold text-text shadow-1 transition-colors duration-150 hover:bg-surface-tint"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-action/10 text-action">
            <CurrentIcon width={15} height={15} />
          </span>
          <span className="truncate">{current?.label ?? t("account.title")}</span>
        </span>
        <ChevronDownIcon aria-hidden="true" width={16} height={16} className={`shrink-0 text-text-muted transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div role="menu" aria-label={t("account.title")}
          className="absolute top-[calc(100%+6px)] inset-x-0 z-40 overflow-hidden rounded-lg border border-border bg-surface shadow-2">
          <ul className="p-2">
            {nav.map(({ to, label, end, Icon }) => (
              <li key={to}>
                <DropdownItem to={to} end={end} label={label} Icon={Icon} onPick={() => setOpen(false)} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** One dropdown row: tinted icon disc (filled brand style when active) + label. */
function DropdownItem({ to, end, label, Icon, onPick }: {
  to: string; end: boolean; label: string;
  Icon: (p: { width: number; height: number }) => React.ReactNode;
  onPick: () => void;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      role="menuitem"
      onClick={onPick}
      className={({ isActive }) =>
        `flex min-h-12 items-center gap-3 rounded-md px-2.5 text-sm font-bold transition-colors duration-150 ${
          isActive ? "bg-action text-on-action" : "text-text hover:bg-surface-tint hover:text-action"
        }`
      }
    >
      {({ isActive }: { isActive: boolean }) => (
        <>
          <span aria-hidden="true" className={`flex size-8 shrink-0 items-center justify-center rounded-full ${isActive ? "bg-white/25 text-on-action" : "bg-surface-tint text-action"}`}>
            <Icon width={15} height={15} />
          </span>
          <span className="truncate">{label}</span>
        </>
      )}
    </NavLink>
  );
}

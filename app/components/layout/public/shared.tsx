/**
 * Shared small bits for the public storefront layout units (header, footer,
 * mobile drawer): the prop types passed down from app/layouts/public.tsx,
 * the header icon-link tile and the localized href builders used by the
 * category strip, the categories mega-menu, the mobile drawer and the footer
 * page row.
 *
 * Extracted from app/layouts/public.tsx — pure structural refactor, no
 * behavior change.
 */
import type { ReactNode } from "react";
import { NavLink } from "react-router";

/** Static page (from the DB) linked in the mobile drawer + footer row. */
export interface HeaderPage {
  slug_ar: string;
  slug_en: string;
  title_ar: string;
  title_en: string;
}

/** Viewer fields the header actions/dropdown/drawer need (profile subset). */
export interface ViewerProfile {
  full_name: string;
  role: string;
  avatar_url: string | null;
}

/** One main-nav entry, built once in the layout for desktop nav + drawer. */
export interface NavItem {
  to: string;
  label: string;
  end: boolean;
}

/**
 * Category link href. The slug follows the UI language with a fallback to
 * the other language when one is empty (the expression the layout used
 * inline in three places, now shared).
 */
export function categoryHref(
  lang: string,
  node: { slug_ar: string; slug_en: string },
): string {
  return `/${lang}/category/${encodeURIComponent(lang === "en" ? node.slug_en || node.slug_ar : node.slug_ar || node.slug_en)}`;
}

/** Static page href, identical shape in the drawer list and footer row. */
export function headerPageHref(lang: string, page: HeaderPage): string {
  return `/${lang}/p/${encodeURIComponent(lang === "en" ? page.slug_en : page.slug_ar)}`;
}

/** 40px rounded icon tile in the header action row (labeled NavLink). */
export function IconLink({
  to,
  label,
  children,
  className = "",
}: {
  to: string;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <NavLink
      to={to}
      aria-label={label}
      className={`flex size-10 shrink-0 items-center justify-center rounded-md text-text transition-colors duration-150 hover:bg-surface-tint hover:text-action sm:size-11 ${className}`}
    >
      {children}
    </NavLink>
  );
}

/** Company mail is for the team only: administrators and staff (supervisors are staff roles). */
export function canOpenTeamMail(role: string | null | undefined): boolean {
  return role === "admin" || role === "staff";
}

/**
 * Every dashboard a signed-in person can jump to from the avatar menu:
 * admin → admin · seller · customer; staff → staff · seller · customer (a staff
 * member without a store lands on seller onboarding and can open one);
 * seller → seller · customer; customer → their account only.
 */
export function panelLinks(lang: string, role: string | null | undefined): Array<{ to: string; labelKey: string; kind: "admin" | "vendor" | "account" }> {
  const account = { to: `/${lang}/account`, labelKey: "nav.customerPanel", kind: "account" as const };
  const vendor = { to: `/${lang}/vendor`, labelKey: "nav.vendorPanel", kind: "vendor" as const };
  if (role === "admin") return [{ to: `/${lang}/admin`, labelKey: "nav.adminPanel", kind: "admin" }, vendor, account];
  if (role === "staff") return [{ to: `/${lang}/admin`, labelKey: "nav.staffPanel", kind: "admin" }, vendor, account];
  if (role === "vendor") return [vendor, account];
  return [];
}

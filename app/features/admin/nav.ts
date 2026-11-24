/**
 * Admin/staff panel map — ONE table drives both the sidebar (ordered by how
 * often each page is used) and the route guard in layouts/admin.tsx, so the
 * menu and the 403 checks cannot drift apart.
 */
import { canAny, type Role } from "~/lib/permissions";

export type AdminNavIcon =
  | "chart" | "list" | "rotate" | "truck" | "package" | "store" | "wallet" | "alert"
  | "tag" | "star" | "users" | "shield" | "megaphone" | "grid" | "scale" | "file"
  | "upload" | "settings" | "user" | "mail" | "map" | "camera";

export interface AdminNavItem {
  /** path below /:lang/admin ("" = dashboard) */
  path: string;
  label: string;
  icon: AdminNavIcon;
  /** any of these grants access; empty = every panel user */
  perms: readonly string[];
  /** money / earnings: admins only, no matter what staff were granted */
  adminOnly?: boolean;
  end?: boolean;
}

export interface AdminNavGroup {
  label: string;
  items: AdminNavItem[];
}

export const ADMIN_NAV: readonly AdminNavGroup[] = [
  { label: "adminNav.group.overview", items: [
    { path: "", label: "admin.dashboard", icon: "chart", perms: ["dashboard.view"], end: true },
  ] },
  { label: "adminNav.group.orders", items: [
    { path: "orders", label: "adminNav.orders", icon: "list", perms: ["orders.view"] },
    { path: "refunds", label: "rf.title", icon: "rotate", perms: ["refunds.view"] },
    { path: "shipping", label: "adminNav.shipping", icon: "truck", perms: ["shipping.manage"] },
    { path: "packaging/orders", label: "pkg.opsTitle", icon: "package", perms: ["packaging.view"] },
  ] },
  { label: "adminNav.group.sellers", items: [
    { path: "vendors", label: "nav.vendors", icon: "store", perms: ["vendors.view"] },
    { path: "store-changes", label: "storeChange.adminTitle", icon: "file", perms: ["store_changes.review"] },
    { path: "withdrawals", label: "wd.title", icon: "wallet", perms: ["withdrawals.view"], adminOnly: true },
    { path: "penalties", label: "pn.title", icon: "alert", perms: ["penalties.manage"] },
  ] },
  { label: "adminNav.group.products", items: [
    { path: "products", label: "adminProducts.title", icon: "tag", perms: ["products.view"] },
    { path: "reviews", label: "rv.title", icon: "star", perms: ["reviews.moderate"] },
  ] },
  { label: "adminNav.group.users", items: [
    { path: "users", label: "admin.users", icon: "users", perms: ["users.view"] },
    { path: "roles", label: "ro.title", icon: "shield", perms: ["staff.manage"] },
  ] },
  { label: "adminNav.group.support", items: [
    { path: "contact", label: "inbox.title", icon: "mail", perms: ["contact.manage"] },
  ] },
  { label: "adminNav.group.marketing", items: [
    { path: "coupons", label: "cp.title", icon: "tag", perms: ["coupons.manage"] },
    { path: "ads", label: "ad.title", icon: "megaphone", perms: ["ads.manage"] },
    { path: "services", label: "asv.title", icon: "camera", perms: ["services.manage"] },
    { path: "events", label: "ev.title", icon: "megaphone", perms: ["events.manage"] },
    { path: "banners", label: "bn.title", icon: "megaphone", perms: ["banners.manage"] },
  ] },
  { label: "adminNav.group.catalog", items: [
    { path: "catalog/categories", label: "catalog.categories", icon: "grid", perms: ["catalog.categories"] },
    { path: "mega-menu", label: "mm.title", icon: "grid", perms: ["catalog.mega_menu"] },
    { path: "catalog/brands", label: "catalog.brands", icon: "tag", perms: ["catalog.brands"] },
    { path: "catalog/tags", label: "catalog.tags", icon: "tag", perms: ["catalog.tags"] },
    { path: "catalog/attributes", label: "catalog.attributes", icon: "list", perms: ["catalog.attributes"] },
    { path: "catalog/size-types", label: "sizeTypes.title", icon: "scale", perms: ["catalog.size_types"] },
    { path: "packaging", label: "pkg.adminTitle", icon: "package", perms: ["packaging.manage"], end: true },
  ] },
  { label: "adminNav.group.reports", items: [
    { path: "reports", label: "rpt.title", icon: "chart", perms: ["reports.view"], adminOnly: true },
    { path: "logs", label: "admin.logs", icon: "list", perms: ["logs.view"] },
  ] },
  { label: "adminNav.group.content", items: [
    { path: "blog", label: "bl.title", icon: "file", perms: ["blog.manage"] },
    { path: "pages", label: "sp.title", icon: "file", perms: ["pages.manage"] },
    { path: "legal", label: "legal.adminTitle", icon: "shield", perms: ["legal.manage"] },
    { path: "media", label: "media.title", icon: "upload", perms: ["media.manage"] },
  ] },
  { label: "adminNav.group.trust", items: [
    { path: "levels", label: "lv.title", icon: "chart", perms: ["levels.manage"] },
    { path: "badges", label: "bd.title", icon: "star", perms: ["badges.manage"] },
  ] },
  { label: "adminNav.group.platform", items: [
    { path: "settings", label: "admin.settings", icon: "settings", perms: ["settings.general"], end: true },
    { path: "settings/sections", label: "st.title", icon: "settings", perms: ["settings.sections"] },
    { path: "document-settings", label: "ds.title", icon: "file", perms: ["settings.documents"] },
    { path: "messages", label: "msgs.title", icon: "mail", perms: ["settings.email_templates"] },
    { path: "zones", label: "z.title", icon: "map", perms: ["zones.manage"] },
    { path: "profile", label: "account.profile", icon: "user", perms: [] },
  ] },
];

/** Routes without a sidebar entry (detail pages etc.) → required permission. */
const EXTRA_ROUTES: ReadonlyArray<{ path: string; perms: readonly string[] }> = [
  { path: "users/", perms: ["users.view"] },
  { path: "vendors/", perms: ["vendors.view"] },
  { path: "products/", perms: ["products.view"] },
  { path: "orders/", perms: ["orders.view"] },
  { path: "packaging/orders/", perms: ["packaging.view"] },
  { path: "media-settings", perms: ["settings.general"] },
  // the email editor opens from Messages and notifications
  { path: "email-templates", perms: ["settings.email_templates"] },
];

/**
 * Permission(s) needed for a path below /:lang/admin. Longest matching
 * prefix wins; unknown admin paths need admin (["*"] never matches staff
 * unless granted everything).
 */
export function adminRoutePerms(subPath: string): readonly string[] {
  const p = subPath.replace(/^\/+|\/+$/g, "");
  if (p === "") return ["dashboard.view"];
  if (/^vendors\/[^/]+\/edit$/.test(p)) return ["vendors.edit"];
  let best: { len: number; perms: readonly string[] } | null = null;
  const consider = (path: string, perms: readonly string[]) => {
    if (!path) return;
    const hit = path.endsWith("/") ? p.startsWith(path) : p === path || p.startsWith(`${path}/`);
    if (hit && (!best || path.length > best.len)) best = { len: path.length, perms };
  };
  for (const g of ADMIN_NAV) for (const it of g.items) consider(it.path, it.perms);
  for (const r of EXTRA_ROUTES) consider(r.path, r.perms);
  return best ? (best as { perms: readonly string[] }).perms : ["*"];
}

export function canSeeAdminItem(role: Role, permissions: readonly string[], perms: readonly string[]): boolean {
  return perms.length === 0 || canAny(role, permissions, perms);
}

/** Sidebar filtered for this viewer; empty groups dropped. */
export function visibleAdminNav(role: Role, permissions: readonly string[]): AdminNavGroup[] {
  return ADMIN_NAV.map((g) => ({
    ...g,
    items: g.items.filter((it) => (!it.adminOnly || role === "admin") && canSeeAdminItem(role, permissions, it.perms)),
  })).filter((g) => g.items.length > 0);
}

/** First page this viewer may open (dashboard when allowed). */
export function firstAdminPath(role: Role, permissions: readonly string[]): string {
  for (const g of visibleAdminNav(role, permissions)) for (const it of g.items) return it.path;
  return "profile";
}

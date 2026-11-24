/**
 * RBAC — the single permission catalog (PLAN.md §3). The database enforces
 * the same keys through `has_permission()` (migrations 20261105000001/2):
 * admin → everything, staff → role list + per-person grants − removals.
 * Pure functions — covered by tests/permissions.test.ts.
 *
 * Permission naming convention: `<domain>.<action>` e.g. "orders.approve".
 * Labels: i18n `perm.<domain>_<action>` + `permHint.<domain>_<action>`,
 * groups: `permGroup.<id>`.
 */

export const ROLES = ["admin", "staff", "vendor", "customer"] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** A role created in admin → Roles: a staff sub-role (profiles.staff_role). */
export interface CustomRole { slug: string; name_ar: string; name_en: string; permissions: string[] }

/** Slugs minted by fn_admin_create_role ("role_" + 10 hex chars). */
export function isCustomRoleSlug(value: unknown): value is string {
  return typeof value === "string" && /^role_[a-z0-9]{4,40}$/.test(value);
}

/** Base role of a role key: a custom role slug is a staff sub-role. */
export function baseRole(key: string): Role | null {
  if (isRole(key)) return key;
  return isCustomRoleSlug(key) ? "staff" : null;
}

export interface PermissionGroup {
  id: string;
  perms: readonly string[];
}

export const PERMISSION_GROUPS: readonly PermissionGroup[] = [
  { id: "dashboard", perms: ["dashboard.view"] },
  { id: "orders", perms: ["orders.view", "orders.create", "orders.edit", "orders.approve", "refunds.view", "refunds.manage", "shipping.manage"] },
  { id: "vendors", perms: ["vendors.view", "vendors.create", "vendors.edit", "vendors.review", "vendors.verify", "vendors.suspend", "store_changes.review", "withdrawals.view", "withdrawals.manage", "penalties.manage"] },
  { id: "users", perms: ["users.view", "users.create", "users.edit", "users.block", "users.delete"] },
  { id: "products", perms: ["products.view", "products.create", "products.edit", "products.delete", "products.review"] },
  { id: "packaging", perms: ["packaging.view", "packaging.manage"] },
  { id: "marketing", perms: ["coupons.manage", "ads.manage", "services.manage", "events.manage", "banners.manage"] },
  // one key per catalog page (they used to share catalog.manage)
  { id: "catalog", perms: ["catalog.categories", "catalog.mega_menu", "catalog.brands", "catalog.tags", "catalog.attributes", "catalog.size_types", "reviews.moderate"] },
  { id: "trust", perms: ["levels.manage", "badges.manage"] },
  { id: "reports", perms: ["reports.view", "logs.view"] },
  { id: "content", perms: ["blog.manage", "pages.manage", "legal.manage", "media.manage"] },
  { id: "support", perms: ["contact.manage"] },
  { id: "platform", perms: ["zones.manage", "settings.general", "settings.sections", "settings.documents", "settings.email_templates", "staff.manage"] },
];

export const ALL_PERMISSIONS: readonly string[] = PERMISSION_GROUPS.flatMap((g) => g.perms);

export function isPermission(value: unknown): value is string {
  return typeof value === "string" && ALL_PERMISSIONS.includes(value);
}

/** i18n key fragment for a permission: "orders.approve" → "orders_approve". */
export function permKey(perm: string): string {
  return perm.replace(".", "_");
}

/**
 * The staff role defaults: orders, sellers and users — view, add, edit,
 * approve/reject — products (add/edit/delete/review), brands, categories and
 * tags (commission stays admin-only) and the contact inbox.
 * Mirrors migration 20261107000015 — keep both in sync.
 */
export const DEFAULT_STAFF_PERMISSIONS = [
  "dashboard.view",
  "orders.view", "orders.create", "orders.edit", "orders.approve",
  "vendors.view", "vendors.create", "vendors.edit", "vendors.review", "vendors.verify", "vendors.suspend", "store_changes.review",
  "users.view", "users.create", "users.edit", "users.block",
  "products.view", "products.create", "products.edit", "products.delete", "products.review",
  "catalog.categories", "catalog.mega_menu", "catalog.brands", "catalog.tags", "catalog.attributes", "catalog.size_types", "contact.manage",
] as const;

/** Wildcard-aware permission check against an effective permission list. */
export function can(
  role: Role,
  permissions: readonly string[],
  required: string,
): boolean {
  if (role === "admin") return true;
  if (role === "staff") {
    return permissions.includes("*") || permissions.includes(required);
  }
  return false;
}

/** True when any of `required` passes. */
export function canAny(role: Role, permissions: readonly string[], required: readonly string[]): boolean {
  return required.some((p) => can(role, permissions, p));
}

/**
 * Effective staff list = role list ∪ grants − removals (same rule as
 * has_permission in SQL; a key both granted and removed counts as granted).
 */
export function effectivePermissions(
  rolePerms: readonly string[],
  overrides: ReadonlyArray<{ permission: string; granted: boolean }>,
): string[] {
  const set = new Set(rolePerms);
  for (const o of overrides) if (!o.granted) set.delete(o.permission);
  for (const o of overrides) if (o.granted) set.add(o.permission);
  return [...set].sort();
}

/** Can this role see a protected panel at all? */
export function canAccessPanel(role: Role, panel: "admin" | "vendor" | "account"): boolean {
  switch (panel) {
    case "admin":
      return role === "admin" || role === "staff";
    case "vendor":
      // staff and admins may run a store of their own as well (dual role)
      return role === "vendor" || role === "admin" || role === "staff";
    case "account":
      return true; // any authenticated user
  }
}

/** Roles a creator may assign when creating a user manually. */
export function creatableRoles(role: Role, permissions: readonly string[]): Role[] {
  if (role === "admin") return ["customer", "vendor", "staff", "admin"];
  const out: Role[] = [];
  if (can(role, permissions, "users.create")) out.push("customer");
  if (can(role, permissions, "users.create") || can(role, permissions, "vendors.create")) out.push("vendor");
  return out;
}

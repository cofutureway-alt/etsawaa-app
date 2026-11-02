/**
 * RBAC from `roles.permissions` jsonb — no permission literals checked in UI
 * code outside this module (PLAN.md §3). Pure functions — covered by
 * tests/permissions.test.ts.
 *
 * Permission naming convention: `<domain>.<action>` e.g. "users.manage".
 * `admin` bypasses the matrix entirely; `staff` is limited to it.
 */

export const ROLES = ["admin", "staff", "vendor", "customer"] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** Wildcard-aware permission check against a role's permission list. */
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

/** Can this role see a protected panel at all? */
export function canAccessPanel(role: Role, panel: "admin" | "vendor" | "account"): boolean {
  switch (panel) {
    case "admin":
      return role === "admin" || role === "staff";
    case "vendor":
      return role === "vendor" || role === "admin";
    case "account":
      return true; // any authenticated user
  }
}

/**
 * The default role matrix seeded into `roles.permissions` for staff.
 * Mirrors the SQL seed — keep both in sync.
 */
export const DEFAULT_STAFF_PERMISSIONS = [
  "users.read",
  "products.read",
  "orders.read",
  "settings.read",
] as const;

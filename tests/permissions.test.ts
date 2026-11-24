import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALL_PERMISSIONS, DEFAULT_STAFF_PERMISSIONS, PERMISSION_GROUPS, can, canAccessPanel, canAny, creatableRoles,
  effectivePermissions, isPermission, isRole, permKey, type Role,
} from "../app/lib/permissions.ts";
import { ADMIN_NAV, adminRoutePerms, firstAdminPath, visibleAdminNav } from "../app/features/admin/nav.ts";
import { ar } from "../app/lib/i18n/ar.ts";
import { en } from "../app/lib/i18n/en.ts";

test("admin bypasses the permission matrix", () => {
  assert.equal(can("admin", [], "anything.at.all"), true);
  assert.equal(can("admin", [], "staff.manage"), true);
});

test("staff is limited to their list (exact + wildcard)", () => {
  assert.equal(can("staff", DEFAULT_STAFF_PERMISSIONS, "orders.approve"), true);
  assert.equal(can("staff", DEFAULT_STAFF_PERMISSIONS, "settings.general"), false);
  assert.equal(can("staff", ["*"], "anything.at.all"), true);
  assert.equal(can("staff", [], "orders.view"), false);
  assert.equal(canAny("staff", ["users.view"], ["orders.view", "users.view"]), true);
});

test("staff defaults: orders, sellers and users — add, edit, approve/reject", () => {
  for (const p of ["orders.view", "orders.create", "orders.edit", "orders.approve",
    "vendors.view", "vendors.create", "vendors.edit", "vendors.review",
    "users.view", "users.create", "users.edit", "users.block"]) {
    assert.ok((DEFAULT_STAFF_PERMISSIONS as readonly string[]).includes(p), p);
  }
  for (const p of DEFAULT_STAFF_PERMISSIONS) assert.ok(isPermission(p), p);
  assert.ok(!(DEFAULT_STAFF_PERMISSIONS as readonly string[]).includes("staff.manage"));
});

test("vendor and customer never pass permission checks", () => {
  const roles: Role[] = ["vendor", "customer"];
  for (const role of roles) {
    assert.equal(can(role, ["*"], "users.view"), false, role);
    assert.equal(can(role, ["users.view"], "users.view"), false, role);
  }
});

test("per-person overrides: role ∪ grants − removals", () => {
  const eff = effectivePermissions(["orders.view", "orders.approve"], [
    { permission: "orders.approve", granted: false },
    { permission: "coupons.manage", granted: true },
  ]);
  assert.deepEqual(eff, ["coupons.manage", "orders.view"]);
});

test("catalog keys are unique, well-formed and labelled in both languages", () => {
  assert.equal(new Set(ALL_PERMISSIONS).size, ALL_PERMISSIONS.length);
  const dict = (m: unknown) => m as Record<string, string>;
  for (const p of ALL_PERMISSIONS) {
    assert.match(p, /^[a-z_]+\.[a-z_]+$/);
    for (const d of [dict(ar), dict(en)]) {
      assert.ok(d[`perm.${permKey(p)}`], `label perm.${permKey(p)}`);
      assert.ok(d[`permHint.${permKey(p)}`], `hint permHint.${permKey(p)}`);
    }
  }
  for (const g of PERMISSION_GROUPS) assert.ok(dict(en)[`permGroup.${g.id}`], g.id);
});

test("every admin nav item points at a real permission", () => {
  for (const g of ADMIN_NAV) for (const it of g.items) for (const p of it.perms) assert.ok(isPermission(p), `${it.path}: ${p}`);
});

test("admin route → permission map", () => {
  assert.deepEqual(adminRoutePerms(""), ["dashboard.view"]);
  assert.deepEqual(adminRoutePerms("/orders"), ["orders.view"]);
  assert.deepEqual(adminRoutePerms("orders/ET-1001"), ["orders.view"]);
  assert.deepEqual(adminRoutePerms("vendors/abc/edit"), ["vendors.edit"]);
  assert.deepEqual(adminRoutePerms("vendors/abc"), ["vendors.view"]);
  assert.deepEqual(adminRoutePerms("settings/sections"), ["settings.sections"]);
  // one key per catalog page: categories alone no longer opens brands
  assert.deepEqual(adminRoutePerms("catalog/categories"), ["catalog.categories"]);
  assert.deepEqual(adminRoutePerms("catalog/brands/new"), ["catalog.brands"]);
  assert.deepEqual(adminRoutePerms("packaging/orders/PKG-1"), ["packaging.view"]);
  assert.deepEqual(adminRoutePerms("packaging"), ["packaging.manage"]);
  assert.deepEqual(adminRoutePerms("roles"), ["staff.manage"]);
  assert.deepEqual(adminRoutePerms("profile"), []);
  assert.deepEqual(adminRoutePerms("something-new"), ["*"]);
});

test("staff menu shows only permitted items; empty groups disappear", () => {
  const nav = visibleAdminNav("staff", DEFAULT_STAFF_PERMISSIONS);
  const paths = nav.flatMap((g) => g.items.map((i) => i.path));
  for (const p of ["", "orders", "vendors", "products", "users", "profile"]) assert.ok(paths.includes(p), p);
  for (const p of ["roles", "settings", "coupons", "refunds", "email-templates"]) assert.ok(!paths.includes(p), p);
  assert.ok(nav.every((g) => g.items.length > 0));
  assert.equal(visibleAdminNav("admin", []).flatMap((g) => g.items).length, ADMIN_NAV.flatMap((g) => g.items).length);
  assert.equal(firstAdminPath("staff", ["users.view"]), "users");
  assert.equal(firstAdminPath("staff", []), "profile");
});

test("who may create which accounts", () => {
  assert.deepEqual(creatableRoles("admin", []), ["customer", "vendor", "staff", "admin"]);
  assert.deepEqual(creatableRoles("staff", DEFAULT_STAFF_PERMISSIONS), ["customer", "vendor"]);
  assert.deepEqual(creatableRoles("staff", ["vendors.create"]), ["vendor"]);
  assert.deepEqual(creatableRoles("staff", []), []);
});

test("panel access matrix matches AGENT.md §4", () => {
  assert.equal(canAccessPanel("admin", "admin"), true);
  assert.equal(canAccessPanel("staff", "admin"), true);
  assert.equal(canAccessPanel("vendor", "admin"), false);
  assert.equal(canAccessPanel("customer", "admin"), false);

  assert.equal(canAccessPanel("vendor", "vendor"), true);
  assert.equal(canAccessPanel("admin", "vendor"), true);
  // staff may run a store of their own too (owner rule 2026-11-07: dual role)
  assert.equal(canAccessPanel("staff", "vendor"), true);
  assert.equal(canAccessPanel("customer", "vendor"), false);

  assert.equal(canAccessPanel("customer", "account"), true);
  assert.equal(canAccessPanel("vendor", "account"), true);
});

test("isRole guards unknown values", () => {
  assert.equal(isRole("admin"), true);
  assert.equal(isRole("superuser"), false);
  assert.equal(isRole(42), false);
  assert.equal(isRole(null), false);
});

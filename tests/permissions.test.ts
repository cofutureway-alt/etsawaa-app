import { test } from "node:test";
import assert from "node:assert/strict";
import { can, canAccessPanel, isRole, DEFAULT_STAFF_PERMISSIONS, type Role } from "../app/lib/permissions.ts";

test("admin bypasses the permission matrix", () => {
  assert.equal(can("admin", [], "anything.at.all"), true);
  assert.equal(can("admin", [], "users.manage"), true);
});

test("staff is limited to their matrix (exact + wildcard)", () => {
  assert.equal(can("staff", DEFAULT_STAFF_PERMISSIONS, "users.read"), true);
  assert.equal(can("staff", DEFAULT_STAFF_PERMISSIONS, "users.manage"), false);
  assert.equal(can("staff", ["*"], "anything.at.all"), true);
  assert.equal(can("staff", [], "orders.read"), false);
});

test("vendor and customer never pass permission checks", () => {
  const roles: Role[] = ["vendor", "customer"];
  for (const role of roles) {
    assert.equal(can(role, ["*"], "users.read"), false, role);
    assert.equal(can(role, ["users.read"], "users.read"), false, role);
  }
});

test("panel access matrix matches AGENT.md §4", () => {
  assert.equal(canAccessPanel("admin", "admin"), true);
  assert.equal(canAccessPanel("staff", "admin"), true);
  assert.equal(canAccessPanel("vendor", "admin"), false);
  assert.equal(canAccessPanel("customer", "admin"), false);

  assert.equal(canAccessPanel("vendor", "vendor"), true);
  assert.equal(canAccessPanel("admin", "vendor"), true);
  assert.equal(canAccessPanel("staff", "vendor"), false);

  assert.equal(canAccessPanel("customer", "account"), true);
  assert.equal(canAccessPanel("vendor", "account"), true);
});

test("isRole guards unknown values", () => {
  assert.equal(isRole("admin"), true);
  assert.equal(isRole("superuser"), false);
  assert.equal(isRole(42), false);
  assert.equal(isRole(null), false);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseScopes, scopeConflict } from "../app/features/settings/coupon-scopes.ts";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

function form(rows: Array<[string, string, string]>) {
  const f = new FormData();
  for (const [mode, kind, ref] of rows) {
    f.append("scope_mode", mode);
    f.append("scope_kind", kind);
    f.append("scope_ref", ref);
  }
  return f;
}

test("parses rows in order", () => {
  assert.deepEqual(parseScopes(form([["include", "vendor", A]])), [
    { mode: "include", scope: "vendor", ref_id: A },
  ]);
});

test("skips blank editor rows", () => {
  assert.deepEqual(parseScopes(form([["include", "category", ""]])), []);
});

test("rejects non-uuid refs and unknown kinds", () => {
  assert.deepEqual(parseScopes(form([["include", "vendor", "not-a-uuid"]])), []);
  assert.deepEqual(parseScopes(form([["include", "store", A]])), []);
  assert.deepEqual(parseScopes(form([["maybe", "vendor", A]])), []);
});

test("dedupes identical rows", () => {
  const out = parseScopes(form([
    ["exclude", "brand", B],
    ["exclude", "brand", B],
  ]));
  assert.equal(out.length, 1);
});

test("mixing include and exclude is flagged", () => {
  assert.equal(scopeConflict([{ mode: "include", scope: "vendor", ref_id: A }]), false);
  assert.equal(
    scopeConflict([
      { mode: "include", scope: "vendor", ref_id: A },
      { mode: "exclude", scope: "brand", ref_id: B },
    ]),
    true,
  );
});

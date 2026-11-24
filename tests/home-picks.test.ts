/**
 * Admin home picks (product review → home visibility): after the paid
 * products, before the rest, no duplicates; and the staff permissions tab.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { placePicks } from "../app/features/storefront/home-picks.ts";
import { profileTabs } from "../app/features/admin/user-profile.shared.ts";
import { pickFields, pickStateFrom } from "../app/components/admin/HomePlacementPanel.tsx";

const card = (id: string) => ({ id });
const ids = (xs: Array<{ id: string }>) => xs.map((x) => x.id);

test("picks follow the paid products and lead the rest", () => {
  const list = ["ad1", "a", "b", "c"].map(card);
  const cards = new Map([["p1", card("p1")], ["b", card("b")]]);
  assert.deepEqual(ids(placePicks(list, new Set(["ad1"]), ["p1", "b"], cards)), ["ad1", "p1", "b", "a", "c"]);
});

test("a pick that is also paid stays once, in the paid slot", () => {
  const list = ["ad1", "a"].map(card);
  assert.deepEqual(ids(placePicks(list, new Set(["ad1"]), ["ad1", "a"], new Map())), ["ad1", "a"]);
});

test("a pick with no card (not listable) is skipped; max trims the end", () => {
  const list = ["a", "b", "c"].map(card);
  assert.deepEqual(ids(placePicks(list, new Set(), ["gone", "c"], new Map(), 2)), ["c", "a"]);
});

test("only staff accounts get the permissions tab", () => {
  assert.ok(profileTabs(false, "staff").includes("permissions"));
  assert.ok(!profileTabs(false, "customer").includes("permissions"));
  assert.ok(!profileTabs(true, "vendor").includes("permissions"));
});

test("the period round-trips: the end day is inclusive", () => {
  const f = pickFields({ sections: ["best"], from: "2026-12-01", to: "2026-12-10" });
  assert.equal(JSON.parse(f.home_sections!)[0], "best");
  assert.ok(Date.parse(f.home_to!) > Date.parse(f.home_from!));
  const back = pickStateFrom([{ section: "best", starts_at: f.home_from!, ends_at: f.home_to! }]);
  assert.equal(back.from, "2026-12-01");
  assert.equal(back.to, "2026-12-10");
  assert.deepEqual(pickFields({ sections: [], from: "", to: "" }).home_to, "");
});

import { commissionOn, sellingPrice } from "../app/components/admin/CommissionBox.tsx";

test("commission box: active sale price is the base, rounding like checkout", () => {
  const now = Date.parse("2026-11-22T12:00:00Z");
  assert.equal(sellingPrice({ price: 10000, sale: 8000, sale_starts_at: null, sale_ends_at: "2026-12-01T00:00:00Z" }, now), 8000);
  assert.equal(sellingPrice({ price: 10000, sale: 8000, sale_starts_at: null, sale_ends_at: "2026-11-01T00:00:00Z" }, now), 10000);
  assert.equal(commissionOn(8000, 12), 960);
  assert.equal(commissionOn(9999, 12.5), 1250);
  assert.equal(commissionOn(5000, 0), 0);
});

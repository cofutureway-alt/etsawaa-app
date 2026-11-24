import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchAll } from "../app/lib/supabase/fetch-all.ts";

// a fake PostgREST: answers range(from, to) from an array, capped at maxRows
function source(total: number, maxRows: number) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: i }));
  const calls: Array<[number, number]> = [];
  const build = (from: number, to: number) => {
    calls.push([from, to]);
    return Promise.resolve({ data: rows.slice(from, Math.min(to + 1, from + maxRows)), error: null });
  };
  return { build, calls };
}

test("reads past the row cap in windows", async () => {
  const s = source(2345, 1000);
  const rows = await fetchAll(s.build);
  assert.equal(rows.length, 2345);
  assert.deepEqual(rows.map((r) => r.id), Array.from({ length: 2345 }, (_, i) => i));
  assert.deepEqual(s.calls, [[0, 999], [1000, 1999], [2000, 2999]]);
});

test("an exact multiple of the page size ends on the empty page", async () => {
  const s = source(2000, 1000);
  assert.equal((await fetchAll(s.build)).length, 2000);
  assert.equal(s.calls.length, 3);
});

test("errors surface instead of returning a short list", async () => {
  await assert.rejects(
    fetchAll(() => Promise.resolve({ data: null, error: { message: "boom" } })),
    /boom/,
  );
});

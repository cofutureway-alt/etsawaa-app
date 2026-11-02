/**
 * PostgREST filter injection guard — the `.or()` string is never escaped by
 * postgrest-js, so user input must be normalized before interpolation.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { isSafeFilterValue, safeSlug, safeLikeTerm } from "../app/lib/postgrest.ts";

test("safeSlug accepts the slugs we generate", () => {
  assert.equal(safeSlug("womens-dresses"), "womens-dresses");
  assert.equal(safeSlug("dress_2024"), "dress_2024");
  assert.equal(safeSlug("  phones  "), "phones");
});

test("safeSlug rejects injection payloads", () => {
  assert.equal(safeSlug("x,id.not.is.null"), null);
  assert.equal(safeSlug("x)"), null);
  assert.equal(safeSlug("a.or(b.eq.c)"), null);
  assert.equal(safeSlug("slug*"), null);
  assert.equal(safeSlug(""), null);
  assert.equal(safeSlug(null), null);
  assert.equal(safeSlug("a".repeat(201)), null);
});

test("isSafeFilterValue flags reserved characters", () => {
  assert.equal(isSafeFilterValue("plain"), true);
  assert.equal(isSafeFilterValue("has,comma"), false);
  assert.equal(isSafeFilterValue("has(paren"), false);
  assert.equal(isSafeFilterValue("has.dot"), false);
  assert.equal(isSafeFilterValue("has:colon"), false);
  assert.equal(isSafeFilterValue("star*"), false);
  assert.equal(isSafeFilterValue(""), false);
});

test("safeLikeTerm strips LIKE and PostgREST metacharacters", () => {
  assert.equal(safeLikeTerm("mohamed,ali"), "mohamed ali");
  assert.equal(safeLikeTerm("100% cotton"), "100 cotton");
  assert.equal(safeLikeTerm("a_b"), "a b");
  assert.equal(safeLikeTerm("x) or (y"), "x or y");
});

test("safeLikeTerm truncates long input", () => {
  assert.equal(safeLikeTerm("a".repeat(200), 10).length, 10);
});

/**
 * safeNext guards the post-login redirect against open-redirect payloads.
 * `startsWith("/")` alone lets `//evil.com` (protocol-relative) through.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { safeNext } from "../app/lib/auth/next.ts";

const FALLBACK = "/ar/account";

test("accepts a normal same-origin path", () => {
  assert.equal(safeNext("/ar/cart", FALLBACK), "/ar/cart");
  assert.equal(safeNext("/en/account/orders?page=2", FALLBACK), "/en/account/orders?page=2");
});

test("rejects protocol-relative URLs", () => {
  assert.equal(safeNext("//evil.com", FALLBACK), FALLBACK);
  assert.equal(safeNext("//evil.com/path", FALLBACK), FALLBACK);
});

test("rejects absolute URLs with a scheme", () => {
  assert.equal(safeNext("https://evil.com", FALLBACK), FALLBACK);
  assert.equal(safeNext("javascript:alert(1)", FALLBACK), FALLBACK);
});

test("rejects a backslash variant used to bypass slash checks", () => {
  assert.equal(safeNext("/\\evil.com", FALLBACK), FALLBACK);
});

test("rejects empty, null and non-strings", () => {
  assert.equal(safeNext("", FALLBACK), FALLBACK);
  assert.equal(safeNext(null, FALLBACK), FALLBACK);
  assert.equal(safeNext(undefined, FALLBACK), FALLBACK);
  assert.equal(safeNext(42, FALLBACK), FALLBACK);
});

test("rejects control characters", () => {
  assert.equal(safeNext("/ar/\u0000x", FALLBACK), FALLBACK);
  assert.equal(safeNext("/ar/\u001fx", FALLBACK), FALLBACK);
});

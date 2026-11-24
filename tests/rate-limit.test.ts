import { test } from "node:test";
import assert from "node:assert/strict";
import { clientKey, isRateLimited, rateLimit, recordHit } from "../app/lib/rate-limit.server.ts";

function req(xff?: string): Request {
  return new Request("http://localhost/x", { headers: xff ? { "x-forwarded-for": xff } : {} });
}

test("clientKey trusts nothing without TRUSTED_PROXY_HOPS", () => {
  delete process.env.TRUSTED_PROXY_HOPS;
  assert.equal(clientKey(req("6.6.6.6")), null);
  assert.equal(clientKey(req()), null);
});

test("clientKey takes the entry appended by the outermost trusted proxy", () => {
  process.env.TRUSTED_PROXY_HOPS = "1";
  // a client-forged leftmost entry is ignored
  assert.equal(clientKey(req("6.6.6.6, 203.0.113.9")), "203.0.113.9");
  process.env.TRUSTED_PROXY_HOPS = "2";
  assert.equal(clientKey(req("6.6.6.6, 203.0.113.9, 10.0.0.2")), "203.0.113.9");
  assert.equal(clientKey(req("10.0.0.2")), null);
  delete process.env.TRUSTED_PROXY_HOPS;
});

test("rateLimit allows exactly `limit` hits per window", () => {
  const key = `t:${Math.random()}`;
  for (let i = 0; i < 3; i++) assert.equal(rateLimit(key, 3, 60_000), true);
  assert.equal(rateLimit(key, 3, 60_000), false);
});

test("recordHit / isRateLimited count only what is recorded", () => {
  const key = `t:${Math.random()}`;
  assert.equal(isRateLimited(key, 2), false);
  recordHit(key, 60_000);
  assert.equal(isRateLimited(key, 2), false);
  recordHit(key, 60_000);
  assert.equal(isRateLimited(key, 2), true);
});

test("a flood of fresh keys cannot grow past the cap or crash", () => {
  for (let i = 0; i < 12_000; i++) recordHit(`flood:${i}`, 60_000);
  // the most recent keys survive, the oldest were evicted
  assert.equal(isRateLimited("flood:11999", 1), true);
  assert.equal(isRateLimited("flood:0", 1), false);
});

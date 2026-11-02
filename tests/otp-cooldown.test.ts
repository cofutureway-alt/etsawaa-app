import { test } from "node:test";
import assert from "node:assert/strict";
import { formatCooldown, resendSecondsLeft } from "../app/features/auth/otp.ts";

test("resend cooldown counts down from 60s and never goes negative", () => {
  const start = 1_000_000;
  assert.equal(resendSecondsLeft(start, start), 60);
  assert.equal(resendSecondsLeft(start, start + 1_000), 59);
  assert.equal(resendSecondsLeft(start, start + 59_999), 1);
  assert.equal(resendSecondsLeft(start, start + 60_000), 0);
  assert.equal(resendSecondsLeft(start, start + 600_000), 0);
});

test("cooldown formats as m:ss (design reference countdown style)", () => {
  assert.equal(formatCooldown(0), "0:00");
  assert.equal(formatCooldown(42), "0:42");
  assert.equal(formatCooldown(60), "1:00");
  assert.equal(formatCooldown(75), "1:15");
});

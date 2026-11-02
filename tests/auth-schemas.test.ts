import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loginSchema,
  otpCodeSchema,
  passwordStrengthScore,
  registerSchema,
  resetPasswordSchema,
} from "../app/features/auth/schemas.ts";

function baseRegister() {
  return {
    firstName: "محمود",
    lastName: "علي",
    email: "User@Example.COM",
    phone: "01012345678",
    password: "Passw0rd123",
    confirmPassword: "Passw0rd123",
    locale: "ar" as const,
    terms: true as const,
  };
}

test("register schema: happy path normalizes email and phone", () => {
  const parsed = registerSchema.safeParse(baseRegister());
  assert.ok(parsed.success);
  if (parsed.success) {
    assert.equal(parsed.data.email, "user@example.com");
    assert.equal(parsed.data.phone, "+201012345678");
    assert.equal(parsed.data.firstName, "محمود");
  }
});

test("register schema: rejects weak passwords, mismatch, missing terms", () => {
  assert.equal(registerSchema.safeParse({ ...baseRegister(), password: "short1" }).success, false);
  assert.equal(registerSchema.safeParse({ ...baseRegister(), password: "passwordonly" }).success, false); // no digit
  assert.equal(registerSchema.safeParse({ ...baseRegister(), password: "12345678" }).success, false); // no letter
  assert.equal(registerSchema.safeParse({ ...baseRegister(), confirmPassword: "different" }).success, false);
  assert.equal(registerSchema.safeParse({ ...baseRegister(), terms: false }).success, false);
});

test("register schema: rejects non-Egyptian phones", () => {
  assert.equal(registerSchema.safeParse({ ...baseRegister(), phone: "01312345678" }).success, false);
  assert.equal(registerSchema.safeParse({ ...baseRegister(), phone: "+447911123456" }).success, false);
});

test("login schema: routes identifier to email or normalized phone", () => {
  const byPhone = loginSchema.safeParse({ identifier: "01012345678", password: "x" });
  assert.ok(byPhone.success);
  if (byPhone.success) assert.deepEqual(byPhone.data.identifier, { kind: "phone", value: "+201012345678" });

  const byEmail = loginSchema.safeParse({ identifier: "USER@Example.com ", password: "x" });
  assert.ok(byEmail.success);
  if (byEmail.success) assert.deepEqual(byEmail.data.identifier, { kind: "email", value: "user@example.com" });

  assert.equal(loginSchema.safeParse({ identifier: "0191234567", password: "x" }).success, false);
});

test("otp schema: exactly six digits", () => {
  assert.equal(otpCodeSchema.safeParse("123456").success, true);
  assert.equal(otpCodeSchema.safeParse("12345").success, false);
  assert.equal(otpCodeSchema.safeParse("1234567").success, false);
  assert.equal(otpCodeSchema.safeParse("12a456").success, false);
  assert.equal(otpCodeSchema.safeParse(" 123456 ").success, true); // trimmed
});

test("reset schema enforces match + strength", () => {
  assert.equal(resetPasswordSchema.safeParse({ password: "Passw0rd123", confirmPassword: "Passw0rd123" }).success, true);
  assert.equal(resetPasswordSchema.safeParse({ password: "Passw0rd123", confirmPassword: "nope" }).success, false);
});

test("passwordStrengthScore climbs with length, classes and symbols", () => {
  assert.equal(passwordStrengthScore(""), 0);
  assert.equal(passwordStrengthScore("abcdef1"), 0); // too short
  assert.equal(passwordStrengthScore("!!!!!!!!"), 1); // 8+ only
  assert.equal(passwordStrengthScore("abcdefg1"), 2); // 8+ with letter+digit
  assert.equal(passwordStrengthScore("abcdefg12345"), 3); // 12+ chars
  assert.equal(passwordStrengthScore("Abcdefg1!@#$"), 4); // symbol + 12
});

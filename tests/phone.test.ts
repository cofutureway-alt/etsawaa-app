import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeEgyptianPhone, maskPhone, looksLikeEmail } from "../app/lib/phone.ts";

test("normalizes Egyptian mobile formats to E.164 + local", () => {
  const cases: Array<[string, string]> = [
    ["01012345678", "+201012345678"],
    ["+20 101 234 5678", "+201012345678"],
    ["+201012345678", "+201012345678"],
    ["201012345678", "+201012345678"],
    ["00201012345678", "+201012345678"],
    ["010-1234-5678", "+201012345678"],
    ["(010)12345678", "+201012345678"],
    ["٠١٠١٢٣٤٥٦٧٨", "+201012345678"], // Arabic-Indic digits
  ];
  for (const [input, expected] of cases) {
    const result = normalizeEgyptianPhone(input);
    assert.equal(result.ok, true, `expected ok for ${input}`);
    if (result.ok) assert.equal(result.e164, expected, `input: ${input}`);
  }
});

test("rejects invalid numbers with the right reason", () => {
  assert.deepEqual(normalizeEgyptianPhone("abc"), { ok: false, reason: "not_a_number" });
  assert.deepEqual(normalizeEgyptianPhone("0201234567"), { ok: false, reason: "wrong_length" });
  assert.deepEqual(normalizeEgyptianPhone("01912345678"), { ok: false, reason: "wrong_prefix" }); // 11 digits, bad prefix
  assert.deepEqual(normalizeEgyptianPhone("0101234567"), { ok: false, reason: "wrong_length" }); // 10 digits
  assert.deepEqual(normalizeEgyptianPhone("010123456789"), { ok: false, reason: "wrong_length" });
});

test("accepts all four Egyptian mobile prefixes only", () => {
  for (const prefix of ["010", "011", "012", "015"]) {
    const result = normalizeEgyptianPhone(`${prefix}12345678`);
    assert.equal(result.ok, true, prefix);
  }
  assert.equal(normalizeEgyptianPhone("01312345678").ok, false);
  assert.equal(normalizeEgyptianPhone("01412345678").ok, false);
});

test("local form keeps the 01 leading zero", () => {
  const result = normalizeEgyptianPhone("+201012345678");
  assert.ok(result.ok && result.local === "01012345678");
});

test("maskPhone hides the middle digits", () => {
  assert.equal(maskPhone("+201012345678"), "+201 012 ••• 5678");
  assert.equal(maskPhone("notaphone"), "notaphone");
});

test("looksLikeEmail distinguishes emails from phones", () => {
  assert.equal(looksLikeEmail("user@example.com"), true);
  assert.equal(looksLikeEmail("user@example"), false);
  assert.equal(looksLikeEmail("01012345678"), false);
});

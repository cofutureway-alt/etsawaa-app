import { test } from "node:test";
import assert from "node:assert/strict";
import { ar } from "../app/lib/i18n/ar.ts";
import { en, type TranslationKey } from "../app/lib/i18n/en.ts";
import { LOCALES, dirFor, isLocale, switchLocalePath } from "../app/lib/i18n/config.ts";

test("ar and en dictionaries carry exactly the same key set (F-03 DoD)", () => {
  const arKeys = Object.keys(ar).sort();
  const enKeys = Object.keys(en).sort();
  assert.deepEqual(arKeys, enKeys);
  assert.ok(arKeys.length > 100, `expected a substantial dictionary, got ${arKeys.length}`);
});

test("no empty values in either dictionary", () => {
  for (const [dictionary, name] of [[ar, "ar"], [en, "en"]] as const) {
    for (const [key, value] of Object.entries(dictionary)) {
      assert.ok(String(value).trim().length > 0, `empty value: ${name}.${key}`);
    }
  }
});

test("dictionaries contain no emoji (G3 code-level check)", () => {
  // Alternatives (not one class): FE0F is a combining selector that must not
  // share a class with ranges (no-misleading-character-class).
  const emoji =
    /[\u{1F300}-\u{1FAFF}]|[\u{2600}-\u{27BF}]|[\u{2190}-\u{21FF}]|[\u{2B00}-\u{2BFF}]|\u{FE0F}/u;
  for (const value of Object.values(ar)) assert.equal(emoji.test(value), false);
  for (const value of Object.values(en)) assert.equal(emoji.test(value), false);
});

test("interpolation placeholders appear in both languages", () => {
  const keysWithVars = (Object.keys(en) as TranslationKey[]).filter((key) => /\{\{\w+\}\}/.test(en[key]));
  assert.ok(keysWithVars.length > 0);
  for (const key of keysWithVars) {
    const enVars = (en[key].match(/\{\{\w+\}\}/g) ?? []).sort();
    const arVars = (ar[key as keyof typeof ar].match(/\{\{\w+\}\}/g) ?? []).sort();
    assert.deepEqual(arVars, enVars, `variable mismatch on ${key}`);
  }
});

test("locale helpers", () => {
  assert.deepEqual([...LOCALES], ["ar", "en"]);
  assert.equal(isLocale("ar"), true);
  assert.equal(isLocale("fr"), false);
  assert.equal(dirFor("ar"), "rtl");
  assert.equal(dirFor("en"), "ltr");
});

test("switchLocalePath keeps path, query and hash (US-01)", () => {
  assert.equal(switchLocalePath("/ar/products?x=1#top", "?x=1", "#top", "en"), "/en/products?x=1#top");
  assert.equal(switchLocalePath("/en/account", "", "", "ar"), "/ar/account");
  assert.equal(switchLocalePath("/", "", "", "ar"), "/ar");
  assert.equal(switchLocalePath("/products", "", "", "en"), "/en/products");
});

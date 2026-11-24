import { test } from "node:test";
import assert from "node:assert/strict";
import { foldSearch, foldTokens, matchesFolded } from "../app/lib/search-fold.ts";

test("hamza forms fold to a plain alef", () => {
  assert.equal(foldSearch("أحمد"), "احمد");
  assert.equal(foldSearch("إبراهيم"), "ابراهيم");
  assert.equal(foldSearch("آمنة"), "امنه");
  assert.equal(foldSearch("ٱلله"), "الله");
});

test("taa marbuta, alef maqsura, waw/yaa hamza and standalone hamza", () => {
  assert.equal(foldSearch("مدرسة"), "مدرسه");
  assert.equal(foldSearch("مصطفى"), "مصطفي");
  assert.equal(foldSearch("مؤمن"), "مومن");
  assert.equal(foldSearch("سائل"), "سايل");
  assert.equal(foldSearch("سماء"), "سما");
});

test("diacritics, tatweel and case are removed", () => {
  assert.equal(foldSearch("مُحَمَّد"), "محمد");
  assert.equal(foldSearch("مـحـمـد"), "محمد");
  assert.equal(foldSearch("TOSHIBA"), "toshiba");
});

test("Arabic-Indic and Persian digits become Latin and whitespace collapses", () => {
  assert.equal(foldSearch("١٢٣ ٤٥٦"), "123 456");
  assert.equal(foldSearch("۱۲۳"), "123");
  assert.equal(foldSearch("  a   b  "), "a b");
});

test("tokens match in any order; empty query matches everything", () => {
  assert.equal(matchesFolded("سامسونج جالاكسي", "جالاكسي سامسونج"), true);
  assert.equal(matchesFolded("توشيبا لابتوب", "لابتوب توشيبا"), true);
  assert.equal(matchesFolded("TOSHIBA Laptop", "toshiba"), true);
  assert.equal(matchesFolded("أحمد علي", "احمد"), true);
  assert.equal(matchesFolded("سامسونج", "ابل"), false);
  assert.equal(matchesFolded("anything", "   "), true);
  assert.deepEqual(foldTokens("  أحمد   علي "), ["احمد", "علي"]);
  assert.deepEqual(foldTokens(""), []);
});

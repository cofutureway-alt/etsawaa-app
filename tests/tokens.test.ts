import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_DESIGN_TOKENS,
  contrastRatio,
  isHexColor,
  parseDesignTokens,
  passesAaNormalText,
  tokensToCss,
} from "../app/lib/tokens.ts";

test("default brand tokens match the official palette", () => {
  assert.deepEqual(DEFAULT_DESIGN_TOKENS, {
    primary: "#F30609",
    action: "#BE0404",
    actionHover: "#8D0504",
    ink: "#510504",
  });
});

test("action red passes WCAG AA for normal text on white (G3)", () => {
  assert.ok(passesAaNormalText(DEFAULT_DESIGN_TOKENS.action), "#BE0404 must be >= 4.5:1");
  const ratio = contrastRatio(DEFAULT_DESIGN_TOKENS.action, "#FFFFFF");
  assert.ok(ratio >= 4.5, `ratio ${ratio}`);
});

test("brand primary is reserved for accents (documented 3:1 non-text)", () => {
  // Non-text requirement
  assert.ok(contrastRatio(DEFAULT_DESIGN_TOKENS.primary, "#FFFFFF") >= 3);
});

test("semantic text colors pass AA on white", () => {
  assert.ok(passesAaNormalText("#15803D")); // success-strong
  assert.ok(passesAaNormalText("#92400E")); // warning-strong
  assert.ok(passesAaNormalText("#DC2626")); // danger
  assert.ok(passesAaNormalText("#6B7280")); // text-muted
  assert.ok(passesAaNormalText("#1F2937")); // text
});

test("isHexColor validates strict #RRGGBB only", () => {
  assert.equal(isHexColor("#F30609"), true);
  assert.equal(isHexColor("#f30609"), true);
  assert.equal(isHexColor("F30609"), false);
  assert.equal(isHexColor("#F30"), false);
  assert.equal(isHexColor("#F306090"), false);
  assert.equal(isHexColor(null), false);
  assert.equal(isHexColor("linear-gradient(...)"), false);
});

test("parseDesignTokens keeps valid overrides and drops invalid ones", () => {
  const parsed = parseDesignTokens({ primary: "#0055CC", action: "not-a-color", unknown: "#123123" });
  assert.equal(parsed.primary, "#0055CC");
  assert.equal(parsed.action, DEFAULT_DESIGN_TOKENS.action);
  assert.equal("unknown" in parsed, false);
});

test("tokensToCss emits the :root override block for SSR injection", () => {
  const css = tokensToCss(parseDesignTokens({ primary: "#0055CC" }));
  assert.equal(css, ":root{--color-primary:#0055CC;--color-action:#BE0404;--color-action-hover:#8D0504;--color-ink:#510504;}");
});

test("contrastRatio is symmetric and bounded", () => {
  const ab = contrastRatio("#000000", "#FFFFFF");
  const ba = contrastRatio("#FFFFFF", "#000000");
  assert.equal(ab, ba);
  assert.ok(ab > 20.9 && ab <= 21);
  assert.ok(contrastRatio("#FFFFFF", "#FFFFFF") >= 0.99);
});

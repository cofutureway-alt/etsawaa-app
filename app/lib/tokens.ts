/**
 * Design tokens (F-02). `settings.design` in the database holds overrides;
 * the root loader injects them server-side as a <style> block, so changing a
 * token in the DB restyles the rendered page with zero code edits.
 * Pure functions — covered by tests/tokens.test.ts.
 */

/** Editable color tokens exposed in admin settings. */
export const EDITABLE_COLOR_TOKENS = [
  "primary",
  "action",
  "actionHover",
  "ink",
] as const;

export type EditableColorToken = (typeof EDITABLE_COLOR_TOKENS)[number];

/** Defaults mirror app/styles/tokens.css — keep both in sync. */
export const DEFAULT_DESIGN_TOKENS: Record<EditableColorToken, string> = {
  primary: "#F30609",
  action: "#BE0404",
  actionHover: "#8D0504",
  ink: "#510504",
};

const CSS_VAR_BY_TOKEN: Record<EditableColorToken, string> = {
  primary: "--color-primary",
  action: "--color-action",
  actionHover: "--color-action-hover",
  ink: "--color-ink",
};

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** The flat surface white used as the AA-contrast reference background. */
export const SURFACE_WHITE = "#FFFFFF";

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_RE.test(value);
}

export type DesignTokens = Record<EditableColorToken, string>;

/** Parse unknown JSON (from `settings.design`) into safe tokens, falling back per key. */
export function parseDesignTokens(raw: unknown): DesignTokens {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const result = { ...DEFAULT_DESIGN_TOKENS };
  for (const token of EDITABLE_COLOR_TOKENS) {
    const value = source[token];
    if (isHexColor(value)) result[token] = value.toUpperCase();
  }
  return result;
}

/** Build the SSR <style> body overriding :root tokens. */
export function tokensToCss(tokens: DesignTokens): string {
  const declarations = EDITABLE_COLOR_TOKENS.map(
    (token) => `${CSS_VAR_BY_TOKEN[token]}:${tokens[token]};`,
  ).join("");
  return `:root{${declarations}}`;
}

/* ---------------------------------- contrast --------------------------------- */

function srgbChannelToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (
    0.2126 * srgbChannelToLinear(r) +
    0.7152 * srgbChannelToLinear(g) +
    0.0722 * srgbChannelToLinear(b)
  );
}

/** WCAG 2.x contrast ratio between two #RRGGBB colors (1..21). */
export function contrastRatio(hexA: string, hexB: string): number {
  const la = relativeLuminance(hexA);
  const lb = relativeLuminance(hexB);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** AA for normal text requires 4.5:1. */
export function passesAaNormalText(foreground: string, background = "#FFFFFF"): boolean {
  return contrastRatio(foreground, background) >= 4.5;
}

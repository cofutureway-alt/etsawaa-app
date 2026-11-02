/**
 * PostgREST `.or()` / `.filter()` strings are assembled by string
 * interpolation inside postgrest-js — nothing is escaped. A slug such as
 *   x,id.not.is.null
 * rewrites the boolean expression and returns the first row regardless of the
 * real slug; an unbalanced `)` yields a 400. Every user-supplied value that
 * lands in an `.or()` must pass through here first.
 *
 * PostgREST reserves `,` `.` `(` `)` `:` inside these expressions. We refuse
 * rather than mangle: a slug containing them is not a slug we ever generate.
 *
 * Pure — covered by tests/postgrest.test.ts.
 */

const RESERVED = /[,.:()"*\\]/;

/** True when the value is safe to interpolate into an `.or()`/`.filter()` string. */
export function isSafeFilterValue(value: string): boolean {
  return value.length > 0 && value.length <= 200 && !RESERVED.test(value);
}

/**
 * Slugs are NOT ASCII-only: this catalogue stores Arabic slugs
 * (`h08-أزياء`), so the guard must permit any letter/digit in any script.
 * What it forbids is exactly the PostgREST expression grammar plus control
 * characters — the things that let a value escape its filter.
 */
const SLUG_FORBIDDEN = /[,.:()"*\\\u0000-\u001f\u007f]/;

/**
 * Normalize a URL slug before it reaches PostgREST. Returns the trimmed value
 * when it is safe to interpolate, otherwise `null` so the caller returns a 404
 * instead of building a filter. Length-capped to keep URLs sane.
 */
export function safeSlug(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (v.length === 0 || v.length > 200) return null;
  if (SLUG_FORBIDDEN.test(v)) return null;
  // A slug never starts with a separator.
  if (v.startsWith("-") || v.startsWith("_")) return null;
  return v;
}

/**
 * Escape a free-text search term for `ilike.%...%`. PostgREST reserves `,`
 * `.` `(` `)` inside `.or()`, and SQL LIKE reserves `%` `_` `\`; both are
 * stripped so a search box can never widen the predicate.
 */
export function safeLikeTerm(raw: string, maxLength = 80): string {
  return raw
    .replace(/[,.:()"'\\%_*]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

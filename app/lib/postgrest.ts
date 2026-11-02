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

/** Slugs we accept for lookup: ASCII letters, digits, `-` and `_` only. */
const SLUG = /^[a-z0-9][a-z0-9_-]{0,199}$/i;

/**
 * Normalize a URL slug before it reaches PostgREST. Returns the trimmed value
 * when it matches the slug shape, otherwise `null` so the caller returns a 404
 * instead of building a filter.
 */
export function safeSlug(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  return SLUG.test(v) ? v : null;
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

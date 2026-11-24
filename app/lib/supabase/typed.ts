/**
 * Central boundary for Supabase embedded-join results. postgrest-js cannot
 * type `select("a(*, b(*))")` payloads, so callers historically scattered
 * `as unknown as Row[]` everywhere. This module is the single audited
 * chokepoint: it checks the value is an array (and optionally runs a
 * per-row guard) before handing typed rows back.
 */

/**
 * Narrow a postgrest list payload to `T[]` — `[]` for null/error-shaped data,
 * the rows themselves when the payload is an array. `guard` optionally drops
 * rows that fail a runtime predicate.
 */
export function asRows<T>(data: unknown, guard?: (row: unknown) => row is T): T[] {
  if (!Array.isArray(data)) return [];
  return guard ? data.filter(guard) : (data as T[]);
}

/** Single-row variant for `.single()` / `.maybeSingle()` payloads; an
 * array-shaped payload yields its first row, anything nullish yields null. */
export function asRow<T>(data: unknown): T | null {
  const row = Array.isArray(data) ? (data[0] ?? null) : data;
  return (row ?? null) as T | null;
}

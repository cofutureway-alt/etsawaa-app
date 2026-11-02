/**
 * Variant math — pure functions shared by the wizard UI and unit tests.
 * The DB (`fn_generate_variants`) owns the authoritative generation; this
 * module only powers the client-side preview counts and matrix scaffolding.
 */

export interface AxisSelection {
  attribute_id: string;
  option_ids: string[];
}

/**
 * Cartesian product of the selected axes (same ordering the RPC uses).
 * Returns one entry per combination, each a sorted list of option ids.
 */
export function cartesianOptionKeys(axes: AxisSelection[]): string[][] {
  let combos: string[][] = [[]];
  for (const axis of axes) {
    const next: string[][] = [];
    for (const combo of combos) {
      for (const optionId of axis.option_ids) {
        next.push([...combo, optionId].sort());
      }
    }
    combos = next;
  }
  return combos;
}

/** Canonical option_key: sorted ids joined with ',' (matches the RPC). */
export function optionKeyOf(combo: string[]): string {
  return [...combo].sort().join(",");
}

/** Count of unique combinations (0 axes → 1 plain variant). */
export function combinationCount(axes: AxisSelection[]): number {
  if (axes.length === 0) return 1;
  const seen = new Set<string>();
  for (const combo of cartesianOptionKeys(axes)) seen.add(optionKeyOf(combo));
  return seen.size;
}

/** Bulk-fill: apply a default value to every row that has none. */
export function bulkFill<T extends Record<string, unknown>>(
  rows: T[],
  patch: Partial<T>,
  mode: "empty_only" | "all",
): T[] {
  return rows.map((row) => {
    const applies =
      mode === "all" ||
      Object.keys(patch).every((key) => {
        const current = row[key];
        return current === "" || current === null || current === undefined;
      });
    return applies ? { ...row, ...patch } : row;
  });
}

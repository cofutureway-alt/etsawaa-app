/**
 * Read every row of a PostgREST query, page by page.
 *
 * PostgREST caps each response at `db-max-rows` (1000 on this stack) and
 * truncates SILENTLY — no error, just a short list. The Phase 09 catalog has
 * ~1,600 categories and ~12,000 template links, so any "load them all" query
 * must page. `build(from, to)` returns the query for one window; it MUST be
 * ordered by a unique column (or end with `.order("id")`) so windows never
 * overlap or skip rows.
 */
export async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

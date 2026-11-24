/**
 * Products the admin placed in a home section during review
 * (product_home_picks): they follow the paid products and lead the rest of
 * the section, without duplicates. Pure: covered by tests/home-picks.test.ts.
 */
export function placePicks<T extends { id: string }>(
  list: T[],
  paidIds: Set<string>,
  pickIds: string[],
  cards: Map<string, T>,
  max?: number,
): T[] {
  const paid = list.filter((p) => paidIds.has(p.id));
  const seen = new Set(paid.map((p) => p.id));
  const picked: T[] = [];
  for (const id of pickIds) {
    const card = cards.get(id) ?? list.find((p) => p.id === id);
    if (!card || seen.has(card.id)) continue;
    seen.add(card.id);
    picked.push(card);
  }
  const merged = [...paid, ...picked, ...list.filter((p) => !seen.has(p.id))];
  return max ? merged.slice(0, max) : merged;
}

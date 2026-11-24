/**
 * Home carousels get a fresh order per visit. Shuffling happens only in the
 * loader (server), so SSR and hydration render the same order.
 */

/** Fisher–Yates; returns a new array, never mutates the input. */
export function shuffled<T>(list: readonly T[], random: () => number = Math.random): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Featured products first (shuffled among themselves), then the rest shuffled. */
export function featuredFirstShuffled<T extends { is_featured: boolean }>(
  list: readonly T[],
  random: () => number = Math.random,
): T[] {
  return [
    ...shuffled(list.filter((item) => item.is_featured), random),
    ...shuffled(list.filter((item) => !item.is_featured), random),
  ];
}

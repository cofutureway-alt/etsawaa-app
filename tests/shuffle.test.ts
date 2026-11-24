/**
 * Home carousels shuffle in the loader. Deterministic random injected in the
 * tests so the order is reproducible.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { featuredFirstShuffled, shuffled } from "../app/features/storefront/shuffle.ts";

/** Small LCG — same seed → same sequence. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const numbers = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

test("shuffled returns a new array and leaves the input untouched", () => {
  const input = [...numbers];
  const out = shuffled(input, seeded(7));
  assert.notEqual(out, input);
  assert.deepEqual(input, numbers);
});

test("shuffled is a permutation — every item once", () => {
  const out = shuffled(numbers, seeded(11));
  assert.deepEqual([...out].sort((a, b) => a - b), numbers);
});

test("shuffled is deterministic for a given random source", () => {
  assert.deepEqual(shuffled(numbers, seeded(42)), shuffled(numbers, seeded(42)));
});

test("shuffled handles empty and single-item lists", () => {
  assert.deepEqual(shuffled([], seeded(1)), []);
  assert.deepEqual(shuffled(["x"], seeded(1)), ["x"]);
});

test("featuredFirstShuffled puts every featured product first, shuffled among themselves", () => {
  const items = [
    { id: "a", is_featured: true },
    { id: "b", is_featured: false },
    { id: "c", is_featured: true },
    { id: "d", is_featured: false },
    { id: "e", is_featured: true },
  ];
  for (let seed = 1; seed <= 20; seed += 1) {
    const out = featuredFirstShuffled(items, seeded(seed));
    assert.deepEqual(out.map((item) => item.id).sort(), ["a", "b", "c", "d", "e"]);
    const featuredCount = items.filter((item) => item.is_featured).length;
    assert.ok(out.slice(0, featuredCount).every((item) => item.is_featured));
    assert.ok(out.slice(featuredCount).every((item) => !item.is_featured));
  }
});

test("featuredFirstShuffled keeps the input and handles an all-featured list", () => {
  const items = [
    { id: "a", is_featured: true },
    { id: "b", is_featured: true },
  ];
  const out = featuredFirstShuffled(items, seeded(3));
  assert.deepEqual(items.map((item) => item.id), ["a", "b"]);
  assert.deepEqual(out.map((item) => item.id).sort(), ["a", "b"]);
});

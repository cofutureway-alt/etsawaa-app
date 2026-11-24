/**
 * Crop geometry — the crop box comes back from react-easy-crop as floats in
 * image pixel space, and drawImage with a fractional or out-of-bounds rect
 * either blurs the result or reads past the bitmap edge (a blank stripe).
 * These pin the clamps: whole pixels, fully inside, never upscaled.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { clampCropRect, outputSize } from "../app/features/account/crop.ts";

test("a clean rect passes through unchanged", () => {
  assert.deepEqual(
    clampCropRect({ x: 100, y: 50, width: 600, height: 600 }, 1200, 1200),
    { x: 100, y: 50, width: 600, height: 600 },
  );
});

test("fractional boxes round to whole pixels", () => {
  assert.deepEqual(
    clampCropRect({ x: 10.4, y: 10.6, width: 300.5, height: 299.4 }, 1000, 1000),
    { x: 10, y: 11, width: 301, height: 299 },
  );
});

test("a box wider than the image is clipped, not pushed outside", () => {
  const r = clampCropRect({ x: 0, y: 0, width: 5000, height: 5000 }, 800, 600);
  assert.deepEqual(r, { x: 0, y: 0, width: 800, height: 600 });
});

test("x/y are pulled back so x + width never exceeds the bitmap", () => {
  const r = clampCropRect({ x: 900, y: 900, width: 400, height: 400 }, 1000, 1000);
  assert.equal(r.x, 600);
  assert.equal(r.y, 600);
  assert.equal(r.x + r.width, 1000);
  assert.equal(r.y + r.height, 1000);
});

test("negative offsets clamp to zero", () => {
  assert.deepEqual(
    clampCropRect({ x: -40, y: -5, width: 200, height: 200 }, 1000, 1000),
    { x: 0, y: 0, width: 200, height: 200 },
  );
});

test("a degenerate box still has at least one pixel", () => {
  const r = clampCropRect({ x: 0, y: 0, width: 0, height: 0 }, 100, 100);
  assert.equal(r.width, 1);
  assert.equal(r.height, 1);
});

test("output never upscales a small crop", () => {
  assert.deepEqual(
    outputSize({ x: 0, y: 0, width: 213, height: 213 }, 512, 512),
    { width: 213, height: 213 },
  );
});

test("output scales a big crop down to the preferred size", () => {
  assert.deepEqual(
    outputSize({ x: 0, y: 0, width: 3000, height: 1000 }, 1500, 500),
    { width: 1500, height: 500 },
  );
});

test("output fits both sides inside the target, keeping the aspect", () => {
  // the tighter of the two ratios wins, so nothing is stretched
  assert.deepEqual(
    outputSize({ x: 0, y: 0, width: 4000, height: 2000 }, 1500, 500),
    { width: 1000, height: 500 },
  );
});

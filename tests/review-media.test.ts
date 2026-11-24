import { test } from "node:test";
import assert from "node:assert/strict";
import { parseReviewMedia, REVIEW_MEDIA_MAX } from "../app/lib/review-media.ts";

test("parseReviewMedia keeps only well-formed image/video entries", () => {
  const raw = JSON.stringify([
    { kind: "image", path: "u/a/1.webp" },
    { kind: "video", path: "u/a/2.mp4" },
    { kind: "file", path: "u/a/3.pdf" },
    { kind: "image" },
    { kind: "image", path: "" },
    null,
    "nope",
  ]);
  assert.deepEqual(parseReviewMedia(raw), [
    { kind: "image", path: "u/a/1.webp" },
    { kind: "video", path: "u/a/2.mp4" },
  ]);
});

test("parseReviewMedia rejects junk and caps the list at five", () => {
  assert.deepEqual(parseReviewMedia(null), []);
  assert.deepEqual(parseReviewMedia(""), []);
  assert.deepEqual(parseReviewMedia("not json"), []);
  assert.deepEqual(parseReviewMedia('{"kind":"image"}'), []);
  const many = Array.from({ length: 8 }, (_, i) => ({ kind: "image", path: `u/a/${i}.webp` }));
  assert.equal(parseReviewMedia(JSON.stringify(many)).length, REVIEW_MEDIA_MAX);
});

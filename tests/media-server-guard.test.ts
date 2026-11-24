/**
 * Media server guards — the media library was uploadable to any bucket with
 * any file type, and listFiles interpolated the client-controlled ?self=
 * param into Postgrest `.or()` strings, which postgrest-js never escapes
 * (see app/lib/postgrest.ts). These tests pin the server-side refusals:
 * hostile filter values yield an empty result without touching the database,
 * the bucket allowlist is strict, and uploadMedia re-runs validateUpload even
 * when the browser pre-check is skipped.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_MEDIA_SETTINGS, VIDEO_MIMES, validateUpload } from "../app/lib/media.shared.ts";
import {
  BUCKETS,
  isMediaBucket,
  listFiles,
  uploadMedia,
} from "../app/features/media/server-api.ts";

const UUID_A = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const UUID_B = "6c84fb90-12c4-11e1-840d-7b25c5ee733a";

interface Spy {
  fromCalls: number;
  or: string[];
  ilike: string[];
}

/**
 * Minimal chainable postgrest stand-in: records the .or()/.ilike() strings the
 * code builds and resolves like an awaited builder. Refusing paths must never
 * reach it — `fromCalls` stays 0.
 */
function fakeDb(rows: unknown[], spy: Spy): SupabaseClient {
  const builder = {
    select: () => builder,
    is: () => builder,
    ilike: (_col: string, pattern: string) => {
      spy.ilike.push(pattern);
      return builder;
    },
    or: (expr: string) => {
      spy.or.push(expr);
      return builder;
    },
    eq: () => builder,
    order: () => builder,
    range: () => builder,
    maybeSingle: () => builder,
    then: (res?: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve({ data: rows, error: null, count: rows.length }).then(res, rej),
  };
  return {
    from: () => {
      spy.fromCalls += 1;
      return builder;
    },
  } as unknown as SupabaseClient;
}

function newSpy(): Spy {
  return { fromCalls: 0, or: [], ilike: [] };
}

test("BUCKETS is the strict upload allowlist", () => {
  assert.deepEqual([...BUCKETS], ["media", "documents"]);
  assert.equal(isMediaBucket("media"), true);
  assert.equal(isMediaBucket("documents"), true);
  assert.equal(isMediaBucket("profile-photos"), false);
  assert.equal(isMediaBucket("media,documents"), false);
  assert.equal(isMediaBucket(""), false);
});

test("listFiles refuses a hostile ?self= without touching the database", async () => {
  const spy = newSpy();
  const res = await listFiles(fakeDb([], spy), {
    selfId: "x,id.not.is.null",
    folderIds: ["x,id.not.is.null"],
    search: "",
    page: 0,
  });
  assert.deepEqual(res, { rows: [], count: 0 });
  assert.equal(spy.fromCalls, 0);
  assert.equal(spy.or.length, 0);
});

test("listFiles refuses when any folder id carries the .or() grammar", async () => {
  const spy = newSpy();
  const res = await listFiles(fakeDb([], spy), {
    selfId: UUID_A,
    folderIds: [UUID_B, "a)or(b.eq.id.neq.null"],
    search: "photo",
    page: 0,
  });
  assert.deepEqual(res, { rows: [], count: 0 });
  assert.equal(spy.fromCalls, 0);
  assert.equal(spy.or.length, 0);
});

test("listFiles interpolates uuid ids into .or() unchanged", async () => {
  const spy = newSpy();
  await listFiles(fakeDb([], spy), {
    selfId: UUID_A,
    folderIds: [UUID_B],
    search: "photo",
    page: 0,
  });
  assert.deepEqual(spy.or, [`folder_id.eq.${UUID_A},folder_id.in.(${UUID_B})`]);
});

test("root listing keeps folder_id.is.null in the .or() string", async () => {
  const spy = newSpy();
  await listFiles(fakeDb([], spy), {
    selfId: null,
    folderIds: [UUID_B],
    search: "photo",
    page: 0,
  });
  assert.deepEqual(spy.or, [`folder_id.is.null,folder_id.in.(${UUID_B})`]);
});

test("search terms are stripped of LIKE wildcards and .or() grammar", async () => {
  const spy = newSpy();
  await listFiles(fakeDb([], spy), {
    selfId: null,
    folderIds: [],
    search: "ph%to_(1),x\\y",
    page: 0,
  });
  assert.deepEqual(spy.ilike, ["%ph to 1 x y%"]);
  // No folder ids under root → the parameterized .is() branch, never .or().
  assert.equal(spy.or.length, 0);
});

test("uploadMedia refuses buckets outside the allowlist", async () => {
  const spy = newSpy();
  const file = new File([new ArrayBuffer(8)], "x.png", { type: "image/png" });
  await assert.rejects(
    () =>
      uploadMedia(fakeDb([], spy), "u1", "profile-photos", file, null, {
        ...DEFAULT_MEDIA_SETTINGS,
      }),
    { message: "bad_bucket" },
  );
  assert.equal(spy.fromCalls, 0);
});

test("uploadMedia enforces validateUpload even when the browser check is skipped", async () => {
  await assert.rejects(
    () =>
      uploadMedia(
        fakeDb([], newSpy()),
        "u1",
        "media",
        new File([new ArrayBuffer(8)], "x.png", { type: "image/png" }),
        null,
        { ...DEFAULT_MEDIA_SETTINGS, allow_images: false },
      ),
    { message: "media.errors.imagesOff" },
  );
  await assert.rejects(
    () =>
      uploadMedia(
        fakeDb([], newSpy()),
        "u1",
        "media",
        new File([new ArrayBuffer(6 * 1024 * 1024)], "big.png", { type: "image/png" }),
        null,
        { ...DEFAULT_MEDIA_SETTINGS },
      ),
    { message: "media.errors.tooBig" },
  );
});

test("uploadMedia without a settings argument loads them from the settings table", async () => {
  const spy = newSpy();
  await assert.rejects(
    () =>
      uploadMedia(
        fakeDb([], spy),
        "u1",
        "media",
        new File([new ArrayBuffer(8)], "x.zip", { type: "application/zip" }),
        null,
      ),
    { message: "media.errors.mime" },
  );
  // The settings read happened; storage was never reached.
  assert.equal(spy.fromCalls, 1);
});

test("video uploads are accepted once allow_video is on, whatever the mime list says", () => {
  const video = { ...DEFAULT_MEDIA_SETTINGS, allow_video: true, allowed_mimes: ["image/png"] };
  for (const type of VIDEO_MIMES) {
    assert.equal(validateUpload({ type, size: 1024, name: `clip.${type.split("/")[1]}` }, video), null);
  }
  // an extension-only type (some browsers) normalises to the same mime
  assert.equal(validateUpload({ type: "", size: 1024, name: "clip.mov" }, video), null);
  // other video containers stay refused
  assert.equal(validateUpload({ type: "video/x-matroska", size: 1024, name: "clip.mkv" }, video), "media.errors.mime");
  assert.equal(validateUpload({ type: "video/avi", size: 1024, name: "clip.avi" }, video), "media.errors.mime");
  // the switch still gates video
  assert.equal(validateUpload({ type: "video/mp4", size: 1024, name: "clip.mp4" }, DEFAULT_MEDIA_SETTINGS), "media.errors.videoOff");
});

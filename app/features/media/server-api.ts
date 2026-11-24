import type { SupabaseClient } from "@supabase/supabase-js";
import { processUpload, processedObjectPath } from "~/lib/media-pipeline.server";
import {
  detectKind,
  normalizeMime,
  parseMediaSettings,
  validateUpload,
  type MediaSettings,
} from "~/lib/media.shared";
import { isSafeFilterValue, safeLikeTerm } from "~/lib/postgrest";
import type { MediaFileRow, MediaFolderRow, MediaUsageRef } from "./api";
export type { MediaFileRow, MediaFolderRow, MediaUsageRef };

/**
 * Server-side media library operations.
 *
 * The library used to run straight from the component tree through the
 * browser client. That client cannot see the httpOnly auth cookie, so every
 * call reached PostgREST as `anon`: listing answered 401 and an upload wrote
 * the object to storage but failed to insert its row. These run in the
 * resource route below, where the request cookie is available and RLS sees
 * the signed-in user.
 */

const FILE_COLUMNS =
  "id,folder_id,bucket,path,original_name,mime,size_bytes,kind,width,height";
export const MEDIA_PAGE_SIZE = 20;

/**
 * The only storage buckets an upload may target. The bucket name reaches both
 * Storage and the media_files row verbatim from the multipart form, so it is
 * never taken on trust: the resource route refuses anything outside this list
 * with a 400 and uploadMedia re-checks it (defense in depth).
 */
export const BUCKETS = ["media", "documents"] as const;

export type MediaBucket = (typeof BUCKETS)[number];

export function isMediaBucket(value: string): value is MediaBucket {
  return (BUCKETS as readonly string[]).includes(value);
}

export async function listFolders(db: SupabaseClient): Promise<MediaFolderRow[]> {
  const { data, error } = await db
    .from("media_folders")
    .select("id,parent_id,name,depth")
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as MediaFolderRow[];
}

export async function listFiles(
  db: SupabaseClient,
  opts: { selfId: string | null; folderIds: string[]; search: string; page: number },
): Promise<{ rows: MediaFileRow[]; count: number }> {
  // `selfId` comes from the ?self= URL param and folderIds include it, so both
  // are client-controlled; they are interpolated into .or() strings below and
  // postgrest-js never escapes those (app/lib/postgrest.ts). Refuse — an empty
  // result the caller renders as an empty page — rather than mangle or let a
  // value rewrite the predicate.
  if (opts.selfId !== null && !isSafeFilterValue(opts.selfId)) return { rows: [], count: 0 };
  if (!opts.folderIds.every(isSafeFilterValue)) return { rows: [], count: 0 };
  // Free-text search goes through the same module's LIKE guard so a term can
  // neither widen the pattern (% _) nor carry the .or() grammar.
  const search = safeLikeTerm(opts.search);
  const from = opts.page * MEDIA_PAGE_SIZE;
  let q = db
    .from("media_files")
    .select(FILE_COLUMNS, { count: "exact" })
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .range(from, from + MEDIA_PAGE_SIZE - 1);
  if (search) q = q.ilike("original_name", `%${search}%`);
  if (opts.selfId === null) {
    q =
      search && opts.folderIds.length > 0
        ? q.or(`folder_id.is.null,folder_id.in.(${opts.folderIds.join(",")})`)
        : q.is("folder_id", null);
  } else {
    q =
      search && opts.folderIds.length > 0
        ? q.or(`folder_id.eq.${opts.selfId},folder_id.in.(${opts.folderIds.join(",")})`)
        : q.eq("folder_id", opts.selfId);
  }
  const { data, error, count } = await q;
  if (error) throw new Error(error.message);
  return { rows: (data ?? []) as MediaFileRow[], count: count ?? 0 };
}

export async function createFolder(
  db: SupabaseClient,
  name: string,
  parentId: string | null,
): Promise<MediaFolderRow> {
  const { data, error } = await db
    .from("media_folders")
    .insert({ name, parent_id: parentId })
    .select("id,parent_id,name,depth")
    .single();
  if (error) throw new Error(error.message);
  return data as MediaFolderRow;
}

export async function updateFolder(db: SupabaseClient, id: string, name: string) {
  const { error } = await db.from("media_folders").update({ name }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteFolder(db: SupabaseClient, id: string) {
  const { error } = await db.from("media_folders").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function updateFile(
  db: SupabaseClient,
  id: string,
  patch: { original_name?: string; folder_id?: string | null; deleted_at?: string | null },
) {
  const { error } = await db.from("media_files").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function fileUsage(db: SupabaseClient, path: string): Promise<MediaUsageRef[]> {
  const { data, error } = await db.rpc("fn_media_usage", { p_path: path });
  if (error) throw new Error(error.message);
  return (data ?? []) as MediaUsageRef[];
}

/** One media_files row by id under the caller's RLS; null when not theirs / absent. */
export async function getFile(db: SupabaseClient, id: string): Promise<MediaFileRow | null> {
  if (!isSafeFilterValue(id)) return null;
  const { data, error } = await db.from("media_files").select(FILE_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as MediaFileRow | null) ?? null;
}

export async function physicalDelete(db: SupabaseClient, row: MediaFileRow) {
  const usage = await fileUsage(db, row.path);
  if (usage.length > 0) return { inUse: true as const, usage };
  const { error: objErr } = await db.storage.from(row.bucket).remove([row.path]);
  if (objErr) throw new Error(objErr.message);
  const { error: rowErr } = await db.from("media_files").delete().eq("id", row.id);
  if (rowErr) throw new Error(rowErr.message);
  return { inUse: false as const };
}

/**
 * Media settings from the `settings` table (key "media"). parseMediaSettings
 * falls back to DEFAULT_MEDIA_SETTINGS when the row is missing or malformed,
 * so the upload guard always has a usable policy.
 */
export async function loadMediaSettings(db: SupabaseClient): Promise<MediaSettings> {
  const { data } = await db.from("settings").select("value").eq("key", "media").maybeSingle();
  return parseMediaSettings(data?.value);
}

/**
 * Storage upload + row insert, both under the caller's own session.
 *
 * This is the real upload boundary: media-ui pre-checks validateUpload in the
 * browser, but a crafted request reaches this function directly, so the same
 * guard (mime allowlist, per-kind size cap via maxBytesFor) re-runs here
 * against server-side settings — the browser check stays purely cosmetic.
 * Refusals throw the i18n error-code; callers that want a 400 validate the
 * file themselves first (the resource route does). `settings` is accepted
 * from callers that already loaded them (the route) to save the extra read;
 * when omitted they are fetched here, so the guard never depends on caller
 * cooperation.
 */
export async function uploadMedia(
  db: SupabaseClient,
  uid: string,
  bucket: string,
  file: File,
  folderId: string | null,
  settings?: MediaSettings,
): Promise<MediaFileRow> {
  if (!isMediaBucket(bucket)) throw new Error("bad_bucket");
  const mediaSettings = settings ?? (await loadMediaSettings(db));
  const rejectCode = validateUpload({ type: file.type, size: file.size, name: file.name }, mediaSettings);
  if (rejectCode) throw new Error(rejectCode);
  // virus scan (fail-closed) + images re-encoded to WebP before anything is stored
  const out = await processUpload(new Uint8Array(await file.arrayBuffer()), normalizeMime(file.type, file.name), file.name);
  const path = processedObjectPath(uid, out.ext);
  const { error: upErr } = await db.storage.from(bucket).upload(path, out.bytes, {
    contentType: out.mime || "application/octet-stream",
    upsert: false,
  });
  if (upErr) throw new Error(`upload_${upErr.message}`);
  const { data, error } = await db
    .from("media_files")
    .insert({
      bucket,
      path,
      folder_id: folderId,
      original_name: out.mime === "image/webp" && file.type !== "image/webp" ? file.name.replace(/\.[A-Za-z0-9]+$/, "") + ".webp" : file.name,
      mime: out.mime || "application/octet-stream",
      size_bytes: out.bytes.byteLength,
      kind: detectKind(out.mime),
      width: out.width,
      height: out.height,
    })
    .select(FILE_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return data as MediaFileRow;
}

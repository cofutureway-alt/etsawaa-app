import { data, type ActionFunctionArgs } from "react-router";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { getViewer } from "~/lib/auth/guards";
import { DOCUMENTS_BUCKET_MAX_MB, normalizeMime, publicMediaUrl, VIDEO_MIMES } from "~/lib/media.shared";
import { processUpload, processedObjectPath, UploadRejected } from "~/lib/media-pipeline.server";
import { loadMediaSettings } from "~/features/media/server-api";
import { DOCUMENT_TYPES, type DocumentType } from "~/features/vendor/config";
import { fetchVendorConfig, fetchVendorRow } from "~/features/vendor/api";

/**
 * POST /api/upload — uploads that are NOT part of the media library.
 *
 * The auth cookie is httpOnly, so the browser Supabase client never has a
 * session: a direct Storage call from the browser reaches RLS as `anon` and
 * is refused. These uploads therefore run here, under the request's cookie,
 * exactly like /api/media-library does for the library.
 *
 *   op=image          {bucket: media|documents, file}  → {path, url}
 *       Customer images (owner rule: customers have no media library) — the
 *       profile avatar (media) and refund evidence (documents, private).
 *   op=reviewMedia    {file}                           → {path, kind}
 *       Buyer review photos / videos into the public media bucket under the
 *       caller's own u/{uid}/ prefix.
 *   op=vendorDocument {docType, file, replaceId?}     → {path, id}
 *   op=vendorDocumentDelete {id}                      → {ok}
 *       Vendor KYC document into the private documents bucket + its
 *       vendor_documents row. The vendor is resolved from the session, never
 *       taken from the form.
 *
 * Every limit is re-checked here; the browser checks are advisory.
 */

// every raster type the pipeline turns into WebP (avatars, refund evidence)
const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/avif"];
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const DOC_MIMES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

export async function action({ request }: ActionFunctionArgs) {
  const { client, headers } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db_unavailable" }, { status: 503 });
  const { viewer } = (await getViewer(client)) ?? { viewer: null };
  if (!viewer) return data({ ok: false, reason: "unauthorized" }, { status: 401, headers });
  const uid = viewer.user.id;

  const form = await request.formData().catch(() => null);
  if (form && String(form.get("op") ?? "") === "vendorDocumentDelete") {
    const vendor = await fetchVendorRow(client, uid);
    if (!vendor) return data({ ok: false, reason: "no_vendor" }, { status: 403, headers });
    const removed = await removeDocument(client, vendor.id, String(form.get("id") ?? ""));
    return removed ? data({ ok: true }, { headers }) : data({ ok: false, reason: "not_removable" }, { status: 400, headers });
  }
  const file = form?.get("file");
  if (!form || !(file instanceof File) || file.size === 0) {
    return data({ ok: false, reason: "no_file" }, { status: 400, headers });
  }
  const op = String(form.get("op") ?? "");

  if (op === "reviewMedia") {
    // buyer review attachments: everything is virus-scanned by store();
    // images become WebP, videos are kept as is and only when the media policy allows them
    const settings = await loadMediaSettings(client);
    const mime = normalizeMime(file.type, file.name);
    const image = IMAGE_MIMES.includes(mime);
    const video = VIDEO_MIMES.includes(mime);
    if (!image && !video) return data({ ok: false, reason: "invalid_file" }, { status: 400, headers });
    if (image && file.size > IMAGE_MAX_BYTES) {
      return data({ ok: false, reason: "too_large", max: 5 }, { status: 400, headers });
    }
    if (video) {
      if (!settings.allow_video) return data({ ok: false, reason: "video_off" }, { status: 400, headers });
      if (file.size > settings.max_video_mb * 1024 * 1024) {
        return data({ ok: false, reason: "too_large", max: settings.max_video_mb }, { status: 400, headers });
      }
    }
    const stored = await store(client, "media", uid, file);
    if (typeof stored !== "string") return data({ ok: false, reason: stored.reason }, { status: stored.status, headers });
    return data({ ok: true, path: stored, kind: image ? "image" : "video" }, { headers });
  }

  if (op === "image") {
    const bucket = String(form.get("bucket") ?? "");
    if (bucket !== "media" && bucket !== "documents") {
      return data({ ok: false, reason: "bad_bucket" }, { status: 400, headers });
    }
    if (!IMAGE_MIMES.includes(normalizeMime(file.type, file.name)) || file.size > IMAGE_MAX_BYTES) {
      return data({ ok: false, reason: "invalid_file" }, { status: 400, headers });
    }
    const stored = await store(client, bucket, uid, file);
    if (typeof stored !== "string") return data({ ok: false, reason: stored.reason }, { status: stored.status, headers });
    const path = stored;
    // public bucket only: the rich-text editor inserts this URL into the HTML
    const url = bucket === "media" ? publicMediaUrl(process.env.SUPABASE_URL ?? "", path) : null;
    return data({ ok: true, path, url }, { headers });
  }

  if (op === "vendorDocument") {
    const docType = String(form.get("docType") ?? "");
    if (!(DOCUMENT_TYPES as readonly string[]).includes(docType)) {
      return data({ ok: false, reason: "bad_type" }, { status: 400, headers });
    }
    const [vendor, config] = await Promise.all([fetchVendorRow(client, uid), fetchVendorConfig(client)]);
    if (!vendor) return data({ ok: false, reason: "no_vendor" }, { status: 403, headers });
    const maxMb = Math.min(config.max_document_mb, DOCUMENTS_BUCKET_MAX_MB);
    if (!DOC_MIMES.includes(file.type)) {
      return data({ ok: false, reason: "bad_mime" }, { status: 400, headers });
    }
    if (file.size > maxMb * 1024 * 1024) {
      return data({ ok: false, reason: "too_large", max: maxMb }, { status: 400, headers });
    }
    const stored = await store(client, "documents", uid, file);
    if (typeof stored !== "string") return data({ ok: false, reason: stored.reason }, { status: stored.status, headers });
    const path = stored;
    // every image is its own row (a document type may have several pages);
    // `replaceId` swaps out one rejected/pending image of this store
    const { data: row, error } = await client.from("vendor_documents").insert({
      vendor_id: vendor.id,
      type: docType as DocumentType,
      bucket: "documents",
      path, original_name: file.name, mime: path.endsWith(".webp") ? "image/webp" : file.type, size_bytes: file.size,
    }).select("id").single();
    if (error || !row) {
      // no row points at the object — don't leave it orphaned
      await client.storage.from("documents").remove([path]);
      return data({ ok: false, reason: error?.message.includes("row-level security") ? "store_suspended" : "save_failed" }, { status: 500, headers });
    }
    const replaceId = String(form.get("replaceId") ?? "");
    if (replaceId) await removeDocument(client, vendor.id, replaceId);
    return data({ ok: true, path, id: (row as { id: string }).id }, { headers });
  }

  return data({ ok: false, reason: "bad_op" }, { status: 400, headers });
}

/** Delete one not-yet-verified document of this store (RLS refuses verified ones). */
async function removeDocument(client: SupabaseClient, vendorId: string, id: string): Promise<boolean> {
  const { data: rows } = await client.from("vendor_documents").delete()
    .eq("id", id).eq("vendor_id", vendorId).neq("status", "verified").select("path");
  const paths = ((rows ?? []) as Array<{ path: string }>).map((r) => r.path);
  if (paths.length) await client.storage.from("documents").remove(paths);
  return paths.length > 0;
}

/**
 * Virus-scan, convert images to WebP, then upload under the caller's own
 * u/{uid}/ prefix (the storage RLS boundary). Returns the path, or why not.
 */
async function store(client: SupabaseClient, bucket: string, uid: string, file: File): Promise<string | { reason: string; status: number }> {
  let out;
  try {
    out = await processUpload(new Uint8Array(await file.arrayBuffer()), normalizeMime(file.type, file.name), file.name);
  } catch (e) {
    if (e instanceof UploadRejected) return { reason: e.reason, status: e.reason === "scan_unavailable" ? 503 : 422 };
    throw e;
  }
  const path = processedObjectPath(uid, out.ext);
  const { error } = await client.storage.from(bucket).upload(path, out.bytes, {
    contentType: out.mime,
    upsert: false,
  });
  return error ? { reason: "upload_failed", status: 502 } : path;
}

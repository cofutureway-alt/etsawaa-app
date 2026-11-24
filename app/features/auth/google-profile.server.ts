import type { SupabaseClient, User } from "@supabase/supabase-js";

/**
 * After a Google sign-in, copy what Google already knows into the profile so
 * the person does not type it again:
 *  - full name (only when ours is empty — never overwrite an edited name);
 *  - profile photo (only when we have none) — downloaded server-side and
 *    stored in our own media bucket under u/<uid>/, so it is served by
 *    /api/media like any other avatar (no third-party image host in the CSP,
 *    and no dependency on Google's short-lived photo URLs).
 * Best effort: any failure just leaves the field empty for the person to fill.
 */
const PHOTO_HOST = /(^|\.)googleusercontent\.com$/i;
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

export async function syncGoogleProfile(client: SupabaseClient, user: User): Promise<void> {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const googleName = (str(meta.full_name) || str(meta.name)).slice(0, 120);
  const googlePhoto = str(meta.avatar_url) || str(meta.picture);

  const { data: profile } = await client
    .from("profiles")
    .select("full_name, avatar_url")
    .eq("id", user.id)
    .maybeSingle<{ full_name: string | null; avatar_url: string | null }>();
  if (!profile) return;

  const patch: Record<string, string> = {};
  if (!profile.full_name?.trim() && googleName) patch.full_name = googleName;
  if (!profile.avatar_url && googlePhoto) {
    const path = await copyGooglePhoto(client, user.id, googlePhoto);
    if (path) patch.avatar_url = path;
  }
  if (Object.keys(patch).length) {
    await client.from("profiles").update(patch).eq("id", user.id);
  }
}

async function copyGooglePhoto(client: SupabaseClient, uid: string, raw: string): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !PHOTO_HOST.test(url.hostname)) return null;
  // Google serves s96 by default; ask for a sharper 256px square.
  url.pathname = url.pathname.replace(/=s\d+(-c)?$/, "=s256-c");
  if (!/=s\d+/.test(url.pathname)) url.pathname += "=s256-c";

  try {
    const res = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(5000) });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !/^image\/(jpeg|png|webp)$/.test(type.split(";")[0] ?? "")) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength === 0 || buf.byteLength > MAX_PHOTO_BYTES) return null;
    const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
    // same pipeline as every upload: virus scan + WebP
    const { processUpload, processedObjectPath } = await import("~/lib/media-pipeline.server");
    const out = await processUpload(new Uint8Array(buf), type.split(";")[0] ?? type, `google.${ext}`);
    const path = processedObjectPath(uid, out.ext);
    const { error } = await client.storage.from("media").upload(path, out.bytes, { contentType: out.mime, upsert: false });
    return error ? null : path;
  } catch {
    return null;
  }
}


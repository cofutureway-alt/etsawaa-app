import { getSupabaseBrowserClient } from "~/lib/supabase/browser";
import { buildObjectPath } from "~/lib/media.shared";

/**
 * Customer upload (owner rule: customers have NO media library) — an image
 * goes straight to storage and the path lands in the target field. Used by
 * the profile avatar and the refund evidence picker.
 */
export async function uploadCustomerImage(
  uid: string,
  file: File,
  bucket: "media" | "documents" = "media",
): Promise<{ path: string }> {
  const c = getSupabaseBrowserClient();
  if (!c) throw new Error("db_unavailable");
  const { data: session } = await c.auth.getSession();
  const token = session.session?.access_token;
  if (!token) throw new Error("not_signed_in");
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!base) throw new Error("db_unavailable");
  const path = buildObjectPath(uid, file.name);
  const res = await fetch(`${base}/storage/v1/object/${bucket}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "x-upsert": "false",
      "Content-Type": file.type || "application/octet-stream",
    },
    body: file,
  });
  if (!res.ok) throw new Error(`upload_${res.status}`);
  return { path };
}

import { data } from "react-router";
import type { Route } from "./+types/document";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { getViewer } from "~/lib/auth/guards";

/**
 * GET /api/document?path=u/{uuid}/{file}
 *
 * Serves an object from the PRIVATE `documents` bucket through a short-lived
 * signed URL. The public media proxy (/api/media) only reads the `media`
 * bucket, so every refund-evidence thumbnail 404'd — uploads go to
 * `documents` (private), previews were built against `media`.
 *
 * Access is enforced by storage RLS: the signed URL is minted with the
 * CALLER's client, so `documents_owner_read` (own uploads) and
 * `documents_admin_read` (admins) apply. A customer can never mint a link
 * for someone else's evidence, and nobody can for another vendor's.
 */
const PATH_RE = /^u\/[0-9a-f-]{36}\/[A-Za-z0-9._-]+$/i;

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const path = url.searchParams.get("path") ?? "";
  if (!PATH_RE.test(path)) return data({ reason: "bad_path" }, { status: 400 });

  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ reason: "db" }, { status: 503 });
  const { viewer } = (await getViewer(client)) ?? { viewer: null };
  if (!viewer) return data({ reason: "unauthenticated" }, { status: 401 });

  // 60s is enough for the <img> to fetch; possession of the link expires fast.
  const { data: signed, error } = await client.storage
    .from("documents")
    .createSignedUrl(path, 60);
  if (error || !signed?.signedUrl) {
    // RLS denied, or the object does not exist — do not distinguish (that
    // would leak whether another user's evidence exists).
    return data({ reason: "not_found" }, { status: 404 });
  }
  return data(
    { url: signed.signedUrl },
    { headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" } },
  );
}

import { data, type ActionFunctionArgs } from "react-router";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { getViewer } from "~/lib/auth/guards";

/**
 * POST /api/profile-media — persists a cropped profile picture or cover.
 *
 * The upload itself still goes through /api/upload (virus scan → WebP under
 * u/{uid}/); this only writes the resulting path onto the row. It lives in its
 * own resource route because the identity card — which carries the edit
 * buttons — is the ACCOUNT LAYOUT's, shared by every tab. A profile-route
 * action is unreachable from /account/orders, and a fetcher there would post
 * to the wrong route.
 *
 * The path is re-validated here exactly like the profile action did: the
 * browser's word is never trusted for "this is my file".
 */

const PATH_RE = /^u\/[0-9a-fA-F-]{36}\/[A-Za-z0-9._-]+$/;

export async function action({ request }: ActionFunctionArgs) {
  const { client, headers } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  const { viewer } = (await getViewer(client)) ?? { viewer: null };
  if (!viewer) return data({ ok: false, reason: "unauthorized" }, { status: 401, headers });

  const form = await request.formData().catch(() => null);
  const intent = String(form?.get("intent") ?? "");
  if (intent !== "avatar" && intent !== "banner") {
    return data({ ok: false, reason: "bad_intent" }, { status: 400, headers });
  }
  const path = String(form?.get("path") ?? "");
  if (!PATH_RE.test(path)) return data({ ok: false, reason: "bad_path" }, { status: 400, headers });
  // only the caller's own uploads (/api/upload stores them under u/<uid>/)
  if (path.split("/")[1] !== viewer.user.id) {
    return data({ ok: false, reason: "bad_path" }, { status: 400, headers });
  }

  const { error } = await client
    .from("profiles")
    .update({ [intent === "avatar" ? "avatar_url" : "banner_url"]: path })
    .eq("id", viewer.user.id);
  return error
    ? data({ ok: false, reason: "failed" }, { status: 400, headers })
    : data({ ok: true }, { headers });
}

import { data } from "react-router";
import type { Route } from "./+types/attribute-usage";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { getViewer } from "~/lib/auth/guards";
import { isSafeFilterValue } from "~/lib/postgrest";

/**
 * GET /api/attribute-usage?id=<attribute uuid> → { ok, usage: [{ref_type, ref_label}] }
 *
 * What still uses an attribute, asked before admin/catalog/attributes offers
 * to archive it. It used to call fn_attribute_usage from the browser client,
 * which has no session (httpOnly cookie) and therefore always reached the
 * RPC as anon. Here it runs under the request's cookie; the RPC itself keeps
 * enforcing is_admin().
 */
export async function loader({ request }: Route.LoaderArgs) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!isSafeFilterValue(id)) return data({ ok: false, reason: "bad_id" }, { status: 400 });

  const { client, headers } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db_unavailable" }, { status: 503 });
  const { viewer } = (await getViewer(client)) ?? { viewer: null };
  if (!viewer) return data({ ok: false, reason: "unauthorized" }, { status: 401, headers });

  const { data: usage, error } = await client.rpc("fn_attribute_usage", { p_attribute_id: id });
  if (error) return data({ ok: false, reason: "query_failed" }, { status: 500, headers });
  return data(
    { ok: true, usage: (usage ?? []) as Array<{ ref_type: string; ref_label: string }> },
    { headers: { ...Object.fromEntries(headers), "Cache-Control": "private, no-store" } },
  );
}

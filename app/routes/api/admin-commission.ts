import { data } from "react-router";
import type { Route } from "./+types/admin-commission";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { getViewer } from "~/lib/auth/guards";
import { isSafeFilterValue } from "~/lib/postgrest";

/**
 * GET /api/admin-commission?vendor=<uuid>&leaf=<uuid?> → the platform
 * commission for that store in that category (the product wizard's live box
 * for admin and staff). fn_admin_commission_for refuses everyone else.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const sp = new URL(request.url).searchParams;
  const vendor = sp.get("vendor") ?? "";
  const leaf = sp.get("leaf") ?? "";
  if (!isSafeFilterValue(vendor) || (leaf && !isSafeFilterValue(leaf))) return data({ ok: false, reason: "bad_id" }, { status: 400 });
  const { client, headers } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db_unavailable" }, { status: 503 });
  const { viewer } = (await getViewer(client)) ?? { viewer: null };
  if (!viewer) return data({ ok: false, reason: "unauthorized" }, { status: 401, headers });
  const { data: res, error } = await client.rpc("fn_admin_commission_for", { p_vendor: vendor, p_leaf: leaf || null });
  if (error) return data({ ok: false, reason: "query_failed" }, { status: 500, headers });
  return data(res ?? { ok: false }, { headers: { ...Object.fromEntries(headers), "Cache-Control": "private, no-store" } });
}

import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { createSupabaseServerClient } from "~/lib/supabase/server";

/**
 * POST /:lang/api/coupon — validate a coupon against cart lines (S-09).
 * Guests may apply (JOURNEYS §5); the redemption row is written at order
 * time (phase 05), so per-user limits only apply to signed-in users.
 */
export async function action({ request }: ActionFunctionArgs) {
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db_not_connected" }, { status: 503 });

  const body = (await request.json().catch(() => null)) as
    | { code?: string; lines?: Array<{ product_id: string; vendor_id: string | null; leaf_category_id: string | null; brand_id: string | null; unit_price_piastres: number; qty: number; on_sale: boolean }> }
    | null;
  if (!body?.code || !Array.isArray(body.lines)) {
    return data({ ok: false, reason: "bad_request" }, { status: 400 });
  }
  const { data: res, error } = await client.rpc("fn_apply_coupon", {
    p_code: body.code.slice(0, 40),
    p_lines: body.lines.slice(0, 60),
  });
  if (error) return data({ ok: false, reason: "query_failed" }, { status: 500 });
  return data(res);
}

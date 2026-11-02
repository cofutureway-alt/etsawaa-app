import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { getViewer } from "~/lib/auth/guards";

/** POST /:lang/api/wishlist — toggle one product for the signed-in user (S-13). */
export async function action({ request }: ActionFunctionArgs) {
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db_not_connected" }, { status: 503 });
  const { viewer } = (await getViewer(client)) ?? { viewer: null };
  if (!viewer) return data({ ok: false, reason: "unauthenticated" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { product_id?: string; intent?: string } | null;
  if (!body?.product_id) return data({ ok: false, reason: "bad_request" }, { status: 400 });

  // explicit removal from the account wishlist page (RLS delete grant)
  if (body.intent === "remove") {
    const { error } = await client
      .from("wishlist_items")
      .delete()
      .eq("user_id", viewer.user.id)
      .eq("product_id", body.product_id);
    if (error) return data({ ok: false, reason: "query_failed" }, { status: 500 });
    return data({ ok: true, added: false });
  }

  const { data: res, error } = await client.rpc("fn_wishlist_toggle", { p_product_id: body.product_id });
  if (error) {
    const reason = error.message.includes("product_unavailable") ? "unavailable" : "query_failed";
    return data({ ok: false, reason }, { status: reason === "query_failed" ? 500 : 400 });
  }
  return data({ ok: true, added: (res as { added: boolean }).added });
}

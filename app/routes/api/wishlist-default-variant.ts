import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { createSupabaseServerClient } from "~/lib/supabase/server";

/**
 * GET /api/wishlist-default-variant?product_id=… — the cheapest live variant
 * of a listable product, for the wishlist "move to cart" shortcut (O-21).
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  const productId = new URL(request.url).searchParams.get("product_id") ?? "";
  if (!/^[0-9a-fA-F-]{36}$/.test(productId)) return data({ ok: false, reason: "bad_id" }, { status: 400 });
  const { data: variant } = await client
    .from("variants")
    .select("id, price_piastres, sale_price_piastres, stock")
    .eq("product_id", productId)
    .is("deleted_at", null)
    .eq("is_active", true)
    .gt("stock", 0)
    .order("price_piastres", { ascending: true })
    .limit(1)
    .maybeSingle();
  return { ok: true, variant_id: variant?.id ?? null };
}


import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { getViewer } from "~/lib/auth/guards";

/**
 * GET /api/reorder?number=ETS-YY-### — the reorder payload for one of the
 * caller's own orders (RLS): every line with its LIVE availability so the
 * client re-adds only purchasable lines and names the rest (US-12).
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  const { viewer } = (await getViewer(client)) ?? { viewer: null };
  if (!viewer) return data({ ok: false, reason: "unauthenticated" }, { status: 401 });

  const number = new URL(request.url).searchParams.get("number") ?? "";
  const { data: order } = await client
    .from("orders")
    .select("id")
    .eq("number", decodeURIComponent(number))
    .maybeSingle();
  if (!order) return data({ ok: false, reason: "not_found" }, { status: 404 });

  const { data: items } = await client
    .from("order_items")
    .select("variant_id, product_id, qty, product_name_ar, product_name_en")
    .eq("order_id", order.id);
  const rows = (items ?? []) as Array<{
    variant_id: string; product_id: string; qty: number; product_name_ar: string; product_name_en: string;
  }>;

  // live availability through the anon-visible storefront rules
  const variantIds = [...new Set(rows.map((r) => r.variant_id))];
  const live = new Set<string>();
  if (variantIds.length > 0) {
    const { data: variants } = await client
      .from("variants")
      .select("id, stock, is_active, deleted_at, products(status, deleted_at, event_hidden, vendors(status, verification_status, hidden_from_listings))")
      .in("id", variantIds);
    for (const v of (variants ?? []) as unknown as Array<{
      id: string; stock: number; is_active: boolean; deleted_at: string | null;
      products: {
        status: string; deleted_at: string | null; event_hidden: boolean;
        vendors: { status: string; verification_status: string; hidden_from_listings: boolean } | null;
      };
    }>) {
      const p = v.products;
      if (
        v.is_active && v.deleted_at === null && v.stock > 0 &&
        p.status === "approved" && p.deleted_at === null && !p.event_hidden &&
        p.vendors && p.vendors.status === "active" &&
        p.vendors.verification_status !== "grace_expired" && !p.vendors.hidden_from_listings
      ) {
        live.add(v.id);
      }
    }
  }

  return {
    ok: true,
    lines: rows.map((r) => ({
      variant_id: r.variant_id,
      product_id: r.product_id,
      qty: r.qty,
      available: live.has(r.variant_id),
      name: r.product_name_ar || r.product_name_en,
    })),
  };
}


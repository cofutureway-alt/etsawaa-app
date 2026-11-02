import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { getViewer } from "~/lib/auth/guards";
import type { ProductCard } from "~/features/storefront/api";

/**
 * POST/DELETE/GET /:lang/api/recent — recently viewed (S-22).
 *  - POST record  (auth) → fn_record_view (dedupe + cap 20 server-side)
 *  - POST merge   (auth) → fn_recently_viewed_merge (guest history)
 *  - POST cards   (any)  → hydrate explicit ids into cards; hidden/deleted
 *                          ids are silently dropped (public view only)
 *  - GET          (auth) → the user's last 20 as hydrated cards
 *  - DELETE       (auth) → clear history
 */

const MAX_IDS = 20;

async function hydrateCards(client: SupabaseClient, ids: string[]): Promise<ProductCard[]> {
  if (ids.length === 0) return [];
  const { data, error } = await client.from("v_storefront_products").select("*").in("id", ids);
  if (error || !data) return [];
  const byId = new Map(data.map((row) => [row.id, row]));
  return ids.map((id) => byId.get(id)).filter((row): row is ProductCard => Boolean(row));
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db_not_connected" }, { status: 503 });
  const { viewer } = (await getViewer(client)) ?? { viewer: null };
  if (!viewer) return data({ ok: false, reason: "unauthenticated" }, { status: 401 });
  const { data: rows, error } = await client
    .from("recently_viewed")
    .select("product_id, viewed_at")
    .eq("user_id", viewer.user.id)
    .order("viewed_at", { ascending: false })
    .limit(MAX_IDS);
  if (error) return data({ ok: false, reason: "query_failed" }, { status: 500 });
  const ids = ((rows ?? []) as Array<{ product_id: string }>).map((r) => r.product_id);
  const cards = await hydrateCards(client, ids);
  return data({ ok: true, cards, count: rows?.length ?? 0 });
}

export async function action({ request }: ActionFunctionArgs) {
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db_not_connected" }, { status: 503 });

  if (request.method === "DELETE") {
    const { viewer } = (await getViewer(client)) ?? { viewer: null };
    if (!viewer) return data({ ok: false, reason: "unauthenticated" }, { status: 401 });
    const { error } = await client.rpc("fn_recently_viewed_clear");
    if (error) return data({ ok: false, reason: "query_failed" }, { status: 500 });
    return data({ ok: true });
  }

  const body = (await request.json().catch(() => null)) as
    | { intent?: string; product_id?: string; items?: Array<{ product_id: string; viewed_at?: string }>; ids?: string[] }
    | null;
  if (!body?.intent) return data({ ok: false, reason: "bad_request" }, { status: 400 });

  if (body.intent === "cards") {
    const ids = (body.ids ?? []).filter((id): id is string => typeof id === "string").slice(0, MAX_IDS);
    const cards = await hydrateCards(client, ids);
    return data({ ok: true, cards });
  }

  const { viewer } = (await getViewer(client)) ?? { viewer: null };
  if (!viewer) return data({ ok: false, reason: "unauthenticated" }, { status: 401 });

  if (body.intent === "record") {
    if (!body.product_id) return data({ ok: false, reason: "bad_request" }, { status: 400 });
    const { error } = await client.rpc("fn_record_view", { p_product_id: body.product_id });
    if (error) return data({ ok: false, reason: "query_failed" }, { status: 500 });
    return data({ ok: true });
  }

  if (body.intent === "merge") {
    const items = (body.items ?? [])
      .filter((i) => typeof i?.product_id === "string")
      .slice(0, MAX_IDS);
    const { data: count, error } = await client.rpc("fn_recently_viewed_merge", { p_items: items });
    if (error) return data({ ok: false, reason: "query_failed" }, { status: 500 });
    return data({ ok: true, count });
  }

  return data({ ok: false, reason: "bad_request" }, { status: 400 });
}


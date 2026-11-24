import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { getViewer } from "~/lib/auth/guards";
import { likeWords } from "~/lib/postgrest";

export interface PanelProductSuggestion {
  id: string;
  name_ar: string;
  name_en: string;
  status: string;
  image: string | null;
  store_ar: string;
  store_en: string;
}

/**
 * GET /api/panel-product-suggest?q=… — the product search dropdown of the admin
 * and vendor product lists (image + title). Admins / customer support search the
 * whole catalogue; a vendor only their own store. Every word of the query must
 * appear in the Arabic or the English name, so a pasted title still matches.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const empty = { items: [] as PanelProductSuggestion[] };
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 160);
  const words = likeWords(q);
  if (!words.length || q.length < 2) return data(empty);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data(empty);
  const viewer = (await getViewer(client))?.viewer;
  if (!viewer) return data(empty, { status: 401 });
  const role = viewer.profile.role;

  let query = client
    .from("products")
    .select("id, name_ar, name_en, status, vendors(store_name_ar, store_name_en), product_media(path, kind, position)")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(8);
  if (role !== "admin" && role !== "staff") {
    const { data: own } = await client.rpc("own_vendor_id");
    if (!own) return data(empty);
    query = query.eq("vendor_id", own as string);
  }
  for (const w of words) query = query.or(`name_ar.ilike.%${w}%,name_en.ilike.%${w}%`);
  const { data: rows } = await query;
  const items = ((rows ?? []) as Array<{
    id: string; name_ar: string; name_en: string; status: string;
    vendors: { store_name_ar: string | null; store_name_en: string | null } | null;
    product_media: Array<{ path: string; kind: string; position: number | null }> | null;
  }>).map((r) => ({
    id: r.id,
    name_ar: r.name_ar ?? "",
    name_en: r.name_en ?? "",
    status: r.status,
    image: (r.product_media ?? []).filter((m) => m.kind === "image").sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0]?.path ?? null,
    store_ar: r.vendors?.store_name_ar ?? "",
    store_en: r.vendors?.store_name_en ?? "",
  }));
  return data({ items }, { headers: { "Cache-Control": "private, no-store" } });
}

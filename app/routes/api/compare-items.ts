import type { Route } from "./+types/compare-items";
import { createSupabaseServerClient } from "~/lib/supabase/server";

export interface CompareItem {
  id: string;
  name_ar: string;
  name_en: string;
  slug_ar: string;
  slug_en: string;
  image: string | null;
  price: number | null;
  sale_price: number | null;
}

/**
 * GET /api/compare-items?ids=a,b — name, picture and price of the products
 * staged for comparison (the staging list in localStorage only holds ids),
 * for the compare bar's expandable list.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const ids = (new URL(request.url).searchParams.get("ids") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => /^[0-9a-f-]{36}$/i.test(id))
    .slice(0, 4);
  const { client } = createSupabaseServerClient(request);
  if (!client || ids.length === 0) return Response.json({ items: [] });
  const { data } = await client
    .from("v_storefront_products")
    .select("id, name_ar, name_en, slug_ar, slug_en, main_image_path, min_price_piastres, min_sale_price_piastres")
    .in("id", ids);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const items: CompareItem[] = ids.flatMap((id) => {
    const r = rows.find((x) => x.id === id);
    return r ? [{
      id,
      name_ar: String(r.name_ar ?? ""), name_en: String(r.name_en ?? ""),
      slug_ar: String(r.slug_ar ?? ""), slug_en: String(r.slug_en ?? ""),
      image: (r.main_image_path as string | null) ?? null,
      price: (r.min_price_piastres as number | null) ?? null,
      sale_price: (r.min_sale_price_piastres as number | null) ?? null,
    }] : [];
  });
  return Response.json({ items }, { headers: { "Cache-Control": "private, max-age=60" } });
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { getRelatedProducts, PRODUCT_CARD_COLUMNS, type ProductCard } from "./api";

/**
 * Related products ranked by category closeness (fn_related_products), so a
 * young catalogue still fills the strip when a leaf has no sibling. Falls back
 * to the leaf-only query when the RPC is not deployed yet.
 */
export async function getRelatedProductsWide(
  client: SupabaseClient,
  productId: string,
  limit = 16,
): Promise<ProductCard[]> {
  try {
    const { data, error } = await client
      .rpc("fn_related_products", { p_product: productId, p_limit: limit })
      .select(PRODUCT_CARD_COLUMNS);
    if (!error && Array.isArray(data)) return data as unknown as ProductCard[];
  } catch {
    // RPC missing / network failure — the leaf-only path below still works
  }
  const { data: row } = await client.from("products").select("leaf_category_id").eq("id", productId).maybeSingle();
  const leaf = (row as { leaf_category_id: string | null } | null)?.leaf_category_id ?? null;
  if (!leaf) return [];
  return getRelatedProducts(client, leaf, productId, limit).catch(() => []);
}

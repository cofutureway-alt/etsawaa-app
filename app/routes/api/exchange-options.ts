import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { createSupabaseServerClient } from "~/lib/supabase/server";

/**
 * GET /api/exchange-options?q=…&products=id,id — what a customer can pick as
 * a replacement in a return: sellable variants of the returned products
 * (same product, another size/colour) or a name search across the store.
 * Prices are today's site price (fn_variant_unit_price, the checkout rule).
 */
export interface ExchangeVariant {
  id: string; label_ar: string | null; label_en: string | null;
  unit_piastres: number; stock: number; image_path: string | null;
}
export interface ExchangeProduct {
  id: string; name_ar: string; name_en: string; main_image_path: string | null;
  store_name_ar: string; store_name_en: string; variants: ExchangeVariant[];
}

const UUID = /^[0-9a-f-]{36}$/i;

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 60);
  const products = (url.searchParams.get("products") ?? "").split(",").filter((id) => UUID.test(id)).slice(0, 20);
  if (q.length < 2 && products.length === 0) return data({ products: [] as ExchangeProduct[] });
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ products: [] as ExchangeProduct[] }, { status: 503 });
  // only a signed-in customer picks replacements (the function is not granted to guests)
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) return data({ products: [] as ExchangeProduct[] }, { status: 401 });
  const { data: rows, error } = await client.rpc("fn_exchange_options", {
    p_query: q.length >= 2 ? q : null,
    p_product_ids: products.length ? products : null,
  });
  if (error) return data({ products: [] as ExchangeProduct[] }, { status: 500 });
  return data({ products: (rows ?? []) as ExchangeProduct[] }, { headers: { "Cache-Control": "private, no-store" } });
}

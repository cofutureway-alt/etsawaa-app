import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { getProductPage } from "~/features/storefront/api";

/**
 * GET /api/product-quick?slug=… — the product-page payload for the
 * "Choose options" popup on product cards (same storefront views/RLS as the
 * product page, so nothing unpublished can leak).
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  const slug = new URL(request.url).searchParams.get("slug") ?? "";
  const page = await getProductPage(client, slug);
  if (!page) return data({ ok: false, reason: "not_found" }, { status: 404 });
  return data({ ok: true, page }, { headers: { "Cache-Control": "private, max-age=30" } });
}

import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { searchSuggestions } from "~/features/storefront/api";

/** GET /:lang/api/search-suggest?q=… — instant suggestions (S-04). */
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 60);
  if (q.length < 2) return data({ products: [], stores: [], categories: [] });
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ products: [], stores: [], categories: [] });
  try {
    const suggestions = await searchSuggestions(client, q);
    return data(suggestions);
  } catch {
    return data({ products: [], stores: [], categories: [] });
  }
}


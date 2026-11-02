import { data } from "react-router";
import type { Route } from "./+types/areas";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requireLang } from "~/lib/lang.server";

/**
 * H-22 — areas of ONE governorate, on demand. The address form and checkout
 * fetch this when the governorate changes (with an AbortController + a
 * per-governorate session cache on the client) instead of loading every area
 * of Egypt up-front. Public reference data, cached at the edge for an hour.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  const govId = Number(new URL(request.url).searchParams.get("governorate_id") ?? 0);
  if (!Number.isInteger(govId) || govId <= 0) {
    return data({ areas: [] }, { status: 400 });
  }
  const { data: areas } = await client
    .from("areas")
    .select("id, governorate_id, name_ar, name_en")
    .eq("governorate_id", govId)
    .eq("is_active", true)
    .order("sort");
  return data(
    { areas: areas ?? [] },
    { headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" } },
  );
}


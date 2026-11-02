import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { getViewer } from "~/lib/auth/guards";

/**
 * GET /api/order-status?number=ETS-YY-### — RLS-scoped status probe used by
 * the order page while a Kashier webhook is awaited. Returns the two fields
 * the page polls; nothing else leaks.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false }, { status: 503 });
  const { viewer } = (await getViewer(client)) ?? { viewer: null };
  if (!viewer) return data({ ok: false, reason: "unauthenticated" }, { status: 401 });
  const number = new URL(request.url).searchParams.get("number") ?? "";
  if (!/^ETS-\d{2}-\d{3,}$/.test(number)) return data({ ok: false, reason: "bad_number" }, { status: 400 });
  const { data: row } = await client
    .from("orders")
    .select("status, payment_status")
    .eq("number", number)
    .maybeSingle();
  if (!row) return data({ ok: false, reason: "not_found" }, { status: 404 });
  return data({ ok: true, status: row.status, payment_status: row.payment_status });
}


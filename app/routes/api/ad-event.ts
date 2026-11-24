import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { createSupabaseServerClient } from "~/lib/supabase/server";

/**
 * POST /api/ad-event  { id, kind: "view" | "click" } — counts an impression or a
 * click on a live paid placement (fn_ad_event ignores anything not live). The
 * client sends each view once per browser session.
 */
export async function action({ request }: ActionFunctionArgs) {
  let body: { id?: unknown; kind?: unknown } = {};
  try { body = await request.json(); } catch { /* ignore */ }
  const id = typeof body.id === "string" && /^[0-9a-f-]{36}$/i.test(body.id) ? body.id : null;
  const kind = body.kind === "click" ? "click" : body.kind === "view" ? "view" : null;
  if (!id || !kind) return data({ ok: false }, { status: 400 });
  const { client } = createSupabaseServerClient(request);
  if (client) await client.rpc("fn_ad_event", { p_campaign: id, p_kind: kind });
  return data({ ok: true });
}

import { data } from "react-router";
import type { Route } from "./+types/admin-import-rejects";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { getSupabaseAdminClient } from "~/lib/supabase/admin";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";

/**
 * D-12 — reject ledger download (JSONL). Admin-only: the session guard runs
 * first; the service client then reads import_rejects (RLS allows admin
 * SELECT too, but the service client keeps pagination simple server-side).
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const svc = getSupabaseAdminClient();
  if (!svc) throw data({ reason: "service_client" }, { status: 503 });
  const batchId = new URL(request.url).searchParams.get("batch") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(batchId)) throw data({ reason: "bad_batch" }, { status: 400 });
  const rows: string[] = [];
  let from = 0;
  for (;;) {
    const { data: page, error } = await svc
      .from("import_rejects")
      .select("batch_id,dataset,src_row,reason,payload")
      .eq("batch_id", batchId)
      .order("src_row")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(page ?? []).map((r) => JSON.stringify(r)));
    if (!page || page.length < 1000) break;
    from += 1000;
  }
  return new Response(rows.join("\n") + "\n", {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Content-Disposition": `attachment; filename="rejects-${batchId}.jsonl"`,
    },
  });
}


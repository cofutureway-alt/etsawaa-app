import { data } from "react-router";
import type { Route } from "./+types/logs";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { Badge, Card, CardBody, CardHeader, EmptyState } from "~/components/ui";
import { Button } from "~/components/ui/Button";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonTable } from "~/components/ui/Skeleton";


/**
 * A-28 — Audit log viewer (US-15): filters by action/entity/date; each row
 * expands to the before/after diff. Writers never log credentials; the viewer
 * additionally masks anything key-like before render.
 */

export interface AuditRow {
  id: number;
  actor: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  before: unknown;
  after: unknown;
  ip_address: string | null;
  created_at: string;
}

const SENSITIVE = /(key|secret|token|password|credential)/i;

/** mask anything that looks like a credential (US-15 edge) */
function maskDeep(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) return v.map(maskDeep);
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = SENSITIVE.test(k) ? "••••••" : maskDeep(val);
    }
    return out;
  }
  return v;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db_not_connected" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const url = new URL(request.url);
  const action = url.searchParams.get("action")?.trim() ?? "";
  const entity = url.searchParams.get("entity")?.trim() ?? "";
  const from = url.searchParams.get("from") ?? "";

  let q = client
    .from("audit_logs")
    .select("id, actor, action, entity, entity_id, before, after, ip_address, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (action) q = q.ilike("action", `%${action}%`);
  if (entity) q = q.eq("entity", entity);
  if (from) q = q.gte("created_at", new Date(from).toISOString());
  const { data: logs, error } = await q;
  if (error) throw new Error(error.message);
  const entities = await client.from("audit_logs").select("entity").limit(500);
  const entityList = [...new Set(((entities.data ?? []) as Array<{ entity: string }>).map((r) => r.entity))].sort();
  return { lang, logs: JSON.parse(JSON.stringify(logs ?? [])) as AuditRow[], action, entity, from, entityList };
}

/** Audit log view — proves F-08 + A-28: every sensitive change with before/after. */
export default function AdminLogs({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { logs } = loaderData;
  const inp = "rounded-m border border-border bg-surface px-2.5 py-1.5 text-[13px] text-text";

  return (
    <Card>
      <CardHeader title={t("admin.logs")} />
      <CardBody>
        {/* filters */}
        <form method="get" className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs font-bold text-text">
            {t("am.action")}
            <input name="action" defaultValue={loaderData.action} placeholder="vendor.…" dir="ltr" className={inp} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-bold text-text">
            {t("admin.logs.entity")}
            <select name="entity" defaultValue={loaderData.entity} className={inp}>
              <option value="">—</option>
              {loaderData.entityList.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-bold text-text">
            {t("bn.from")}
            <input name="from" type="date" defaultValue={loaderData.from} dir="ltr" className={inp} />
          </label>
          <Button type="submit" size="sm" variant="outline">{t("common.search")}</Button>
        </form>

        {!logs || logs.length === 0 ? (
          <div className="mt-3"><EmptyState title={t("admin.logs.empty")} body={t("admin.logs.hint")} /></div>
        ) : (
          <div className="mt-3 flex flex-col gap-1.5">
            {logs.map((row) => (
              <details key={row.id} className="rounded-m border border-border/60 bg-surface px-2.5 py-2">
                <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-[13px]">
                  <span className="num text-xs text-text-muted" dir="ltr">{new Date(row.created_at).toLocaleString("ar-EG")}</span>
                  <Badge tone="info">{row.action}</Badge>
                  <span className="num text-xs">
                    {row.entity}
                    {row.entity_id ? `#${row.entity_id.slice(0, 8)}` : ""}
                  </span>
                  <span className="num text-xs text-text-faint">{row.actor ? row.actor.slice(0, 8) : "system"}</span>
                </summary>
                {/* before/after diff (masked) */}
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  <pre className="overflow-x-auto rounded-m bg-surface-tint p-2 text-[11px] text-text-muted" dir="ltr">
                    {JSON.stringify(maskDeep(row.before) ?? null, null, 1)}
                  </pre>
                  <pre className="overflow-x-auto rounded-m bg-surface-tint p-2 text-[11px] text-text" dir="ltr">
                    {JSON.stringify(maskDeep(row.after) ?? null, null, 1)}
                  </pre>
                </div>
              </details>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}


/** H-06: friendly route error page (500s log a CORERR id; 403/404 keep their message) */
export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonTable />;
}

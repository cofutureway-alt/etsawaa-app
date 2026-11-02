import { data } from "react-router";
import type { Route } from "./+types/penalties";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { formatPiastres } from "~/lib/money";
import { EmptyState } from "~/components/ui/EmptyState";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonPage } from "~/components/ui/Skeleton";


/**
 * Penalties view (VO-11 / US-10) — list + reason + reference + status
 * (applied/waived with who and when). RLS vendor_read.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "vendor", request);
  const { data: rows, error } = await client
    .from("vendor_penalties")
    .select("id, source, rule_key, amount_piastres, reason, reference, status, waived_by, waived_at, created_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  // Resolve the waiving admin's name — the view showed a blank actor before.
  const waivedIds = [...new Set(((rows ?? []) as Array<{ waived_by: string | null }>)
    .map((r) => r.waived_by).filter((x): x is string => Boolean(x)))];
  const names = new Map<string, string>();
  if (waivedIds.length > 0) {
    const { data: profs } = await client.from("profiles").select("id, full_name").in("id", waivedIds);
    for (const p of (profs ?? []) as Array<{ id: string; full_name: string }>) names.set(p.id, p.full_name);
  }
  return {
    lang,
    rows: JSON.parse(JSON.stringify(rows ?? [])),
    waivedNames: Object.fromEntries(names),
  };
}

export default function PenaltiesPage({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const money = (p: number) => formatPiastres(p, en ? "en" : "ar");
  return (
    <div>
      <h1 className="text-lg font-extrabold text-text">{t("penalties.title")}</h1>
      {loaderData.rows.length === 0 ? (
        <div className="mt-6">
          <EmptyState title={t("penalties.empty")} body={t("report.netHint")} />
        </div>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {(loaderData.rows as Array<{
            id: string; source: string; amount_piastres: number; reason: string;
            reference: string | null; status: string; waived_by: string | null; waived_at: string | null; created_at: string;
          }>).map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface p-3 text-sm">
              <span className={`rounded-md px-2 py-0.5 text-xs font-bold ${p.status === "waived" ? "bg-surface-tint text-primary" : "bg-surface-tint text-danger"}`}>
                {p.status === "waived" ? t("penalties.waived") : t("penalties.applied")}
              </span>
              <span className="font-bold tabular-nums text-text" dir="ltr">{money(p.amount_piastres)}</span>
              <span className="flex-1 text-text">{p.reason}</span>
              <span className="text-xs text-text-muted" dir="ltr">{p.reference ?? "—"}</span>
              <span className="num text-xs text-text-muted">{new Date(p.created_at).toLocaleDateString(en ? "en-EG" : "ar-EG")}</span>
              {p.status === "waived" && p.waived_at ? (
                <span className="text-xs text-text-muted">{t("penalties.waivedBy", { by: (loaderData.waivedNames as Record<string, string>)[p.waived_by ?? ""] ?? "—" })} {new Date(p.waived_at).toLocaleDateString(en ? "en-EG" : "ar-EG")}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}


/** H-06: friendly route error page (500s log a CORERR id; 403/404 keep their message) */
export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonPage />;
}

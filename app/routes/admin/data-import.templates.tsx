import { data, useFetcher } from "react-router";
import type { Route } from "./+types/data-import.templates";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { Badge } from "~/components/ui/Badge";
import { Button } from "~/components/ui/Button";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonTable } from "~/components/ui/Skeleton";


/**
 * D-12 — Template review queue: the 399 new-family templates with family,
 * field count, variant axes and confidence. approve/adjust/reject through
 * fn_admin_review_template (audited, admin-only). Only approved templates
 * are publishable (D-14 gate reads review_status).
 */

interface TplRow {
  id: string;
  batch_id: string;
  src_row: number;
  type_key: string;
  family: string;
  fields: string[];
  variant_axes: string[];
  source: string;
  confidence: string;
  review_status: string;
  review_note: string;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? "pending";
  const q = client
    .from("staging_templates")
    .select("id,batch_id,src_row,type_key,family,fields,variant_axes,source,confidence,review_status,review_note")
    .order("src_row");
  const rows = status === "all"
    ? await q.limit(1400)
    : await q.eq("review_status", status).limit(600);
  if (rows.error) throw new Error(rows.error.message);
  const { count: pendingTotal } = await client
    .from("staging_templates").select("id", { count: "exact", head: true })
    .eq("review_status", "pending");
  // category labels for the type (first leaf path from staging_types)
  const { data: typeRows } = await client
    .from("staging_types")
    .select("source_key,leaf_keys,name_ar,name_en")
    .order("src_row")
    .limit(1400);
  return {
    lang,
    templates: JSON.parse(JSON.stringify(rows.data ?? [])) as TplRow[],
    pendingTotal: pendingTotal ?? 0,
    types: JSON.parse(JSON.stringify(typeRows ?? [])) as Array<{ source_key: string; leaf_keys: string[]; name_ar: string; name_en: string }>,
    status,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const form = await request.formData();
  const id = String(form.get("id") ?? "");
  const act = String(form.get("action") ?? "");
  const note = String(form.get("note") ?? "");
  const fields = String(form.get("fields") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const axes = String(form.get("axes") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!id || !["approve", "reject", "adjust"].includes(act)) {
    return data({ ok: false, reason: "bad_request" }, { status: 400 });
  }
  const res = await client.rpc("fn_admin_review_template", {
    p_template: id, p_action: act,
    p_fields: act === "adjust" && fields.length ? fields : null,
    p_axes: act === "adjust" && axes.length ? axes : null,
    p_note: note,
  });
  if (res.error) return data({ ok: false, reason: res.error.message }, { status: 500 });
  const r = res.data as { ok: boolean; status: string };
  return { ok: r.ok, status: r.status };
}

const STATUS_TONE: Record<string, "success" | "danger" | "warning" | "info" | "neutral"> = {
  approved: "success", rejected: "danger", adjusted: "info", pending: "warning",
};

export default function AdminTemplateReview({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const fetcher = useFetcher<typeof action>();
  const [editing, setEditing] = useState<string | null>(null);
  const [showFields, setShowFields] = useState<string | null>(null);
  const busy = fetcher.state !== "idle";
  const typeByKey = new Map(loaderData.types.map((x) => [x.source_key, x]));

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg font-extrabold text-text">{t("dim.reviewQueue")}</h1>
        <Badge tone="warning">{loaderData.pendingTotal} {t("dim.pending")}</Badge>
      </div>
      <p className="mt-1 max-w-[68ch] text-sm text-text-muted">{t("dim.reviewHint")}</p>

      <nav className="mt-3 flex flex-wrap gap-2" aria-label="filter">
        {["pending", "approved", "adjusted", "rejected", "all"].map((s) => (
          <a key={s} href={`?status=${s}`}
            className={`inline-flex min-h-11 items-center rounded-md border px-3 text-xs font-bold ${
              loaderData.status === s ? "border-primary bg-primary-soft text-primary" : "border-border bg-surface text-text-muted hover:bg-surface-tint"
            }`} aria-current={loaderData.status === s ? "page" : undefined}>
            {s === "all" ? "—" : t(`dim.st_${s}`)}
          </a>
        ))}
      </nav>

      {loaderData.templates.length === 0 ? (
        <div className="mt-4 rounded-md border border-border bg-surface p-6 text-center text-sm text-text-muted">
          {t("dim.allReviewed")}
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {loaderData.templates.map((tpl) => {
            const type = typeByKey.get(tpl.type_key);
            const catPath = type?.leaf_keys?.[0]?.split("/").join(" › ") ?? "—";
            return (
              <div key={tpl.id} className="rounded-md border border-border bg-surface p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-extrabold text-text">{en ? tpl.type_key.replace(/-/g, " ") : (type?.name_ar || tpl.type_key)}</span>
                  <Badge tone={STATUS_TONE[tpl.review_status] ?? "neutral"}>{t(`dim.st_${tpl.review_status}`)}</Badge>
                  <Badge tone="neutral">{tpl.source === "exact" ? t("dim.exact") : t("dim.newFamily")}</Badge>
                  <span className="text-xs text-text-faint num" dir="ltr">#{tpl.src_row}</span>
                </div>
                <dl className="mt-1.5 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  <div><dt className="inline text-text-muted">{t("dim.category")}: </dt><dd className="inline">{catPath}</dd></div>
                  <div><dt className="inline text-text-muted">{t("dim.family")}: </dt><dd className="inline" dir="ltr"><code>{tpl.family || "—"}</code></dd></div>
                  <div><dt className="inline text-text-muted">{t("dim.fieldsCount")}: </dt><dd className="inline num" dir="ltr">{tpl.fields.length}</dd></div>
                  <div><dt className="inline text-text-muted">{t("dim.confidence")}: </dt><dd className="inline">{tpl.confidence}</dd></div>
                </dl>
                <p className="mt-1 text-xs text-text-muted">
                  <span className="font-bold">{t("dim.axes")}: </span>
                  {tpl.variant_axes.length ? tpl.variant_axes.join(" · ") : "—"}
                  {" · "}
                  <button type="button" className="font-bold text-primary underline" onClick={() => setShowFields(showFields === tpl.id ? null : tpl.id)}>
                    {showFields === tpl.id ? t("dim.hideFields") : t("dim.showFields")}
                  </button>
                </p>
                {showFields === tpl.id ? (
                  <p className="mt-1 rounded-sm bg-surface-tint p-2 text-xs text-text" dir="ltr">{tpl.fields.join(" | ") || "—"}</p>
                ) : null}
                {tpl.review_note ? <p className="mt-1 text-xs text-text-faint">{t("dim.reviewNote")}: {tpl.review_note}</p> : null}

                {tpl.review_status !== "rejected" ? (
                  editing === tpl.id ? (
                    <fetcher.Form method="post" className="mt-2 space-y-2 rounded-sm border border-border bg-surface-tint p-3">
                      <input type="hidden" name="id" value={tpl.id} />
                      <input type="hidden" name="action" value="adjust" />
                      <label className="block text-xs font-bold text-text" htmlFor={`f-${tpl.id}`}>{t("dim.adjustFields")}</label>
                      <textarea id={`f-${tpl.id}`} name="fields" rows={2} dir="ltr" defaultValue={tpl.fields.join(", ")}
                        className="w-full rounded-md border border-border bg-surface p-2 text-xs" />
                      <label className="block text-xs font-bold text-text" htmlFor={`a-${tpl.id}`}>{t("dim.adjustAxes")}</label>
                      <input id={`a-${tpl.id}`} name="axes" dir="ltr" defaultValue={tpl.variant_axes.join(", ")}
                        className="w-full rounded-md border border-border bg-surface p-2 text-xs" />
                      <label className="block text-xs font-bold text-text" htmlFor={`n-${tpl.id}`}>{t("dim.reviewNote")}</label>
                      <input id={`n-${tpl.id}`} name="note" defaultValue={tpl.review_note}
                        className="w-full rounded-md border border-border bg-surface p-2 text-xs" />
                      <div className="flex items-center gap-2">
                        <Button type="submit" size="sm" disabled={busy}>{t("dim.save")}</Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => setEditing(null)}>{t("dim.cancel")}</Button>
                      </div>
                    </fetcher.Form>
                  ) : (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <fetcher.Form method="post">
                        <input type="hidden" name="id" value={tpl.id} />
                        <input type="hidden" name="action" value="approve" />
                        <Button type="submit" size="sm" disabled={busy}>{t("dim.approve")}</Button>
                      </fetcher.Form>
                      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setEditing(tpl.id)}>{t("dim.adjust")}</Button>
                      <fetcher.Form method="post">
                        <input type="hidden" name="id" value={tpl.id} />
                        <input type="hidden" name="action" value="reject" />
                        <Button type="submit" size="sm" variant="outline" disabled={busy}>{t("dim.reject")}</Button>
                      </fetcher.Form>
                    </div>
                  )
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {fetcher.data && !fetcher.data.ok ? (
        <p role="alert" className="mt-3 text-sm font-bold text-danger">{String((fetcher.data as { reason?: string }).reason)}</p>
      ) : null}
    </div>
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

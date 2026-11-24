import { useEffect, useState } from "react";
import type { Route } from "./+types/store-changes";
import { Link, data, useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { requireLang } from "~/lib/lang.server";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { Badge, Button, Dialog, EmptyState } from "~/components/ui";
import { CheckIcon, XIcon } from "~/components/ui/icons";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonPage } from "~/components/ui/Skeleton";
import { PageHeader } from "~/components/layout/PageHeader";
import { useActionToast } from "~/components/layout/ActionFeedback";
import { ChangeDiff, type ChangeRequest } from "~/features/vendor/components/ChangeDiff";

/**
 * Admin → Store setting changes: sellers' requested edits to an active
 * store (names, logo, banner, categories, contact, address, socials) shown as
 * old → new. Approve applies them, reject keeps the store as it is and tells
 * the seller why. The "Decided" tab is the audit history.
 */

type Row = ChangeRequest & {
  vendor_id: string;
  requested_by: string | null;
  vendors: { store_name_ar: string; store_name_en: string; owner_id: string } | null;
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const tab = new URL(request.url).searchParams.get("tab") === "decided" ? "decided" : "pending";

  let q = client.from("vendor_change_requests")
    .select("id, vendor_id, changes, previous, status, reason, created_at, reviewed_at, requested_by, vendors(store_name_ar, store_name_en, owner_id)")
    .order("created_at", { ascending: tab === "pending" }).limit(100);
  q = tab === "pending" ? q.eq("status", "pending") : q.in("status", ["approved", "rejected"]);
  const [rows, cats, govs, areas, pendingCount] = await Promise.all([
    q,
    client.from("categories").select("id, name_ar, name_en").is("deleted_at", null).lte("depth", 2),
    client.from("governorates").select("id, name_ar, name_en"),
    client.from("areas").select("id, name_ar, name_en"),
    client.from("vendor_change_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
  ]);
  return {
    lang, tab,
    rows: (rows.data ?? []) as unknown as Row[],
    pendingCount: pendingCount.count ?? 0,
    categories: (cats.data ?? []) as Array<{ id: string; name_ar: string; name_en: string }>,
    governorates: (govs.data ?? []) as Array<{ id: number; name_ar: string; name_en: string }>,
    areas: (areas.data ?? []) as Array<{ id: number; name_ar: string; name_en: string }>,
    supabaseUrl: process.env.SUPABASE_URL ?? "",
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const form = await request.formData();
  const { data: res, error } = await client.rpc("fn_admin_decide_store_change", {
    p_request: String(form.get("request_id") ?? ""),
    p_decision: String(form.get("decision") ?? ""),
    p_reason: String(form.get("reason") ?? "").trim() || null,
  });
  if (error) return data({ ok: false, reason: error.message }, { status: 400 });
  const r = res as { ok: boolean; reason?: string };
  return r.ok ? { ok: true as const } : data({ ok: false, reason: r.reason ?? "failed" }, { status: 400 });
}

export default function AdminStoreChanges({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { lang, tab, rows } = loaderData;
  const en = lang === "en";
  const fetcher = useFetcher<typeof action>();
  useActionToast(fetcher, { success: t("productReview.done") });
  const busy = fetcher.state !== "idle";
  const [rejecting, setRejecting] = useState<Row | null>(null);
  useEffect(() => { if (fetcher.state === "idle" && fetcher.data?.ok) setRejecting(null); }, [fetcher.state, fetcher.data]);
  const lookups = {
    categories: new Map(loaderData.categories.map((c) => [c.id, en ? c.name_en : c.name_ar])),
    governorates: new Map(loaderData.governorates.map((g) => [String(g.id), en ? g.name_en : g.name_ar])),
    areas: new Map(loaderData.areas.map((a) => [String(a.id), en ? a.name_en : a.name_ar])),
    supabaseUrl: loaderData.supabaseUrl,
  };
  const when = (v: string | null) => (v ? new Date(v).toLocaleString(en ? "en-GB" : "ar-EG-u-nu-latn", { dateStyle: "medium", timeStyle: "short" }) : "—");

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("storeChange.adminTitle")} count={loaderData.pendingCount} subtitle={t("storeChange.adminSubtitle")} />
      <nav className="flex gap-1.5 rounded-lg border border-border bg-surface p-2 shadow-1">
        {(["pending", "decided"] as const).map((k) => (
          <Link key={k} to={k === "pending" ? "?" : "?tab=decided"} aria-current={tab === k ? "page" : undefined}
            className={`rounded-md px-3.5 py-1.5 text-xs font-bold ${tab === k ? "bg-action text-on-action" : "text-text-muted hover:bg-surface-tint"}`}>
            {t(`storeChange.tab.${k}`)}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-6"><EmptyState title={t(tab === "pending" ? "storeChange.emptyPending" : "storeChange.emptyDecided")} /></div>
      ) : (
        <ul className="flex flex-col gap-4">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  {r.vendors ? (
                    <Link to={`/${lang}/admin/users/${r.vendors.owner_id}?tab=store`} className="font-extrabold text-action hover:underline">
                      {en ? r.vendors.store_name_en : r.vendors.store_name_ar}
                    </Link>
                  ) : null}
                  <p className="text-xs text-text-muted">{t("storeChange.requested")}: <span className="num">{when(r.created_at)}</span>
                    {r.reviewed_at && r.status !== "pending" ? <> · {t("storeChange.decided")}: <span className="num">{when(r.reviewed_at)}</span></> : null}</p>
                </div>
                {r.status === "pending" ? (
                  <div className="flex gap-2">
                    <fetcher.Form method="post">
                      <input type="hidden" name="request_id" value={r.id} />
                      <input type="hidden" name="decision" value="approve" />
                      <Button type="submit" size="sm" loading={busy}><CheckIcon className="size-4" />{t("storeChange.approve")}</Button>
                    </fetcher.Form>
                    <Button size="sm" variant="outline" className="text-danger" disabled={busy} onClick={() => setRejecting(r)}><XIcon className="size-4" />{t("storeChange.reject")}</Button>
                  </div>
                ) : (
                  <Badge tone={r.status === "approved" ? "success" : "danger"}>{t(`storeChange.status.${r.status}`)}</Badge>
                )}
              </div>
              {r.reason ? <p className="text-sm text-text"><b>{t("storeChange.reason")}:</b> {r.reason}</p> : null}
              <ChangeDiff changes={r.changes} previous={r.previous} lookups={lookups} />
            </li>
          ))}
        </ul>
      )}

      <Dialog open={rejecting !== null} onClose={() => setRejecting(null)} title={t("storeChange.rejectTitle")}>
        {rejecting ? (
          <fetcher.Form method="post" className="flex flex-col gap-3 p-1">
            <input type="hidden" name="request_id" value={rejecting.id} />
            <input type="hidden" name="decision" value="reject" />
            <label className="flex flex-col gap-1.5 text-sm font-bold text-text">
              {t("storeChange.reason")} *
              <textarea name="reason" required minLength={3} rows={3} className="rounded-md border border-border bg-surface px-3 py-2 text-sm font-normal" />
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setRejecting(null)}>{t("common.cancel")}</Button>
              <Button type="submit" loading={busy} className="bg-danger hover:bg-danger">{t("storeChange.reject")}</Button>
            </div>
          </fetcher.Form>
        ) : null}
      </Dialog>
    </div>
  );
}

export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}

export function HydrateFallback() {
  return <SkeletonPage />;
}

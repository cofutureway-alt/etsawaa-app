import { data, useFetcher } from "react-router";
import type { Route } from "./+types/data-import";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { Badge } from "~/components/ui/Badge";
import { Button } from "~/components/ui/Button";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonTable } from "~/components/ui/Skeleton";


/**
 * D-12 — Data-import dashboard: batches (staged/rejected, source SHA-256),
 * reject JSONL download and staging rollback. Publish explains its gate/D-16
 * state honestly; the actual publish RPC lives behind the review queue.
 */

interface BatchRow {
  id: string;
  batch_no: number;
  dataset: string;
  status: string;
  staged_rows: number;
  rejected_rows: number;
  dry_run: boolean;
  source_files: Array<{ path: string; sha256: string }>;
  created_at: string;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const { data: batches, error } = await client
    .from("import_batches")
    .select("id,batch_no,dataset,status,staged_rows,rejected_rows,dry_run,source_files,created_at")
    .order("batch_no", { ascending: true });
  if (error) throw new Error(error.message);
  return { lang, batches: JSON.parse(JSON.stringify(batches ?? [])) as BatchRow[] };
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const form = await request.formData();
  const batchId = String(form.get("batch") ?? "");
  const intent = String(form.get("intent") ?? "");
  if (!batchId) return data({ ok: false, reason: "missing_batch" }, { status: 400 });

  if (intent === "publish") {
    // D-14: single explicit path; the RPC enforces the review gate + D-16 deferral
    const res = await client.rpc("fn_admin_publish_batch", { p_batch: batchId });
    return { ok: false as const, reason: res.error?.message ?? "unexpected_success", deferred: res.error?.message?.includes("publish_deferred_D16") ?? false };
  }

  // rollback staging batch (status guard: never a published batch)
  const { data: b, error: bErr } = await client
    .from("import_batches")
    .select("status,batch_no")
    .eq("id", batchId)
    .single();
  if (bErr || !b) return data({ ok: false, reason: "not_found" }, { status: 404 });
  if (b.status === "published") return data({ ok: false, reason: "batch_published_guard" }, { status: 409 });
  const { error: delErr } = await client.from("import_batches").delete().eq("id", batchId);
  if (delErr) return data({ ok: false, reason: delErr.message }, { status: 500 });
  return { ok: true as const, rolledBack: b.batch_no };
}

const DATASET_LABEL: Record<string, string> = {
  areas: "dim.areas", categories: "dim.categories", specs: "dim.specs",
  groups: "dim.groups", templates: "dim.templates", shared: "dim.shared",
};

export default function AdminDataImport({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";
  const batches = loaderData.batches;

  const pendingTemplates = /* reviewed via the templates page; dashboard shows the headline state */ batches.find((b) => b.dataset === "templates");

  return (
    <div>
      <h1 className="text-lg font-extrabold text-text">{t("dim.title")}</h1>
      <p className="mt-1 max-w-[68ch] text-sm text-text-muted">{t("dim.hint")}</p>

      {batches.length === 0 ? (
        <div className="mt-4 rounded-md border border-border bg-surface p-6 text-center text-sm text-text-muted">
          {t("dim.noBatches")}
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-md border border-border bg-surface">
          <table className="w-full min-w-[640px] text-start text-sm">
            <caption className="sr-only">{t("dim.batches")}</caption>
            <thead>
              <tr className="border-b border-border bg-surface-tint text-text-muted">
                <th scope="col" className="px-3 py-2 text-start font-bold">{t("dim.batch")}</th>
                <th scope="col" className="px-3 py-2 text-start font-bold">{t("dim.dataset")}</th>
                <th scope="col" className="px-3 py-2 text-start font-bold">{t("dim.staged")}</th>
                <th scope="col" className="px-3 py-2 text-start font-bold">{t("dim.rejected")}</th>
                <th scope="col" className="px-3 py-2 text-start font-bold">{t("dim.status")}</th>
                <th scope="col" className="px-3 py-2 text-start font-bold"><span className="sr-only">{t("dim.rollback")}</span></th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => {
                const rolling = busy && fetcher.formAction?.includes(b.id);
                return (
                  <tr key={b.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 font-bold num" dir="ltr">#{b.batch_no}</td>
                    <td className="px-3 py-2">{t(DATASET_LABEL[b.dataset] ?? "") || b.dataset}</td>
                    <td className="px-3 py-2 num" dir="ltr">{b.staged_rows}</td>
                    <td className="px-3 py-2 num" dir="ltr">{b.rejected_rows}</td>
                    <td className="px-3 py-2">
                      {b.status === "published" ? <Badge tone="success">{b.status}</Badge>
                        : b.status === "rolled_back" ? <Badge tone="neutral">{b.status}</Badge>
                        : <Badge tone="info">{b.status}</Badge>}
                      {b.dry_run ? <span className="ms-1 text-xs text-text-faint">dry-run</span> : null}
                    </td>
                    <td className="px-3 py-2">
                      {b.status === "staged" ? (
                        <fetcher.Form method="post" onSubmit={(e) => {
                          if (!window.confirm(t("dim.rollbackConfirm"))) e.preventDefault();
                        }}>
                          <input type="hidden" name="batch" value={b.id} />
                          <Button type="submit" size="sm" variant="outline" disabled={busy}>
                            {rolling ? "…" : t("dim.rollback")}
                          </Button>
                        </fetcher.Form>
                      ) : null}
                      {b.rejected_rows > 0 ? (
                        <a className="ms-2 inline-flex min-h-11 items-center rounded-md border border-border px-3 text-xs font-bold text-primary hover:bg-surface-tint"
                          href={`/api/admin/import-rejects?batch=${b.id}`} download>
                          {t("dim.rejects")}
                        </a>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {fetcher.data && !fetcher.data.ok && !("deferred" in fetcher.data && fetcher.data.deferred) ? (
        <p role="alert" className="mt-3 text-sm font-bold text-danger">{String((fetcher.data as { reason?: string }).reason)}</p>
      ) : null}
      {fetcher.data && "rolledBack" in fetcher.data && fetcher.data.ok ? (
        <p role="status" className="mt-3 text-sm font-bold text-success-strong">{t("dim.rolledBack")} #{(fetcher.data as { rolledBack?: number }).rolledBack}</p>
      ) : null}

      {pendingTemplates ? (
        <div className="mt-4 rounded-md border border-border bg-surface p-4">
          <h2 className="text-sm font-extrabold text-text">{t("dim.publishStatus")}</h2>
          <p className="mt-1 text-sm text-text-muted">{t("dim.publishDeferred")}</p>
          <p className="mt-1 text-sm text-text-muted">{t("dim.publishGateOn")}</p>
          <p className="mt-2 text-xs text-text-faint">{t("dim.reviewQueue")} → <code dir="ltr">/{loaderData.lang}/admin/data-import/templates</code></p>
        </div>
      ) : null}

      <details className="mt-4 rounded-md border border-border bg-surface p-4">
        <summary className="cursor-pointer text-sm font-extrabold text-text">{t("dim.sources")}</summary>
        <ul className="mt-2 space-y-1" dir="ltr">
          {batches.flatMap((b) =>
            (b.source_files ?? []).map((f) => (
              <li key={b.id + f.path} className="break-all text-xs text-text-muted num">
                {f.path} → <span className="select-all">{f.sha256}</span>
              </li>
            )),
          )}
        </ul>
      </details>
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

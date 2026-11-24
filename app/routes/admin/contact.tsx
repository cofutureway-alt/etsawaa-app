import { Link, data, useSearchParams } from "react-router";
import type { Route } from "./+types/contact";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess, requirePermission } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { PageHeader } from "~/components/layout/PageHeader";
import { EmptyState } from "~/components/ui/EmptyState";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonTable } from "~/components/ui/Skeleton";

/**
 * Contact inbox (admin + staff holding contact.manage): every message from the
 * customer and seller contact forms, newest first, filterable by source and
 * status; a row opens the thread (details, attachments, replies by email).
 */
interface Row {
  id: string; kind: "customer" | "vendor"; name: string; email: string; subject: string; message: string;
  topic: string; status: "new" | "open" | "replied" | "closed"; created_at: string; last_reply_at: string | null;
  attachments: unknown[];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  const viewer = await requirePanelAccess(client, lang, "admin", request);
  requirePermission(viewer, "contact.manage");
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");
  const status = url.searchParams.get("status");
  const q = (url.searchParams.get("q") ?? "").trim().replace(/[,.:()"*\\%_]/g, " ").slice(0, 60);
  let query = client.from("contact_messages")
    .select("id, kind, name, email, subject, message, topic, status, created_at, last_reply_at, attachments")
    .order("created_at", { ascending: false }).limit(300);
  if (kind === "customer" || kind === "vendor") query = query.eq("kind", kind);
  if (status && ["new", "open", "replied", "closed"].includes(status)) query = query.eq("status", status);
  if (q) query = query.or(`name.ilike.%${q}%,email.ilike.%${q}%,subject.ilike.%${q}%`);
  const [{ data: rows, error }, { count: unread }] = await Promise.all([
    query,
    client.from("contact_messages").select("id", { count: "exact", head: true }).eq("status", "new"),
  ]);
  if (error) throw new Error(error.message);
  return { lang, rows: (rows ?? []) as Row[], unread: unread ?? 0 };
}

const KIND_TONE = { customer: "bg-[#1e6fd9]/10 text-[#1557b0] border-[#1e6fd9]/30", vendor: "bg-[#6B3FA0]/10 text-[#56308a] border-[#6B3FA0]/30" } as const;
const STATUS_TONE = { new: "bg-danger text-white", open: "bg-warning-soft text-warning-strong", replied: "bg-success-soft text-success-strong", closed: "bg-surface-tint text-text-muted" } as const;

export default function AdminContactInbox({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { lang, rows } = loaderData;
  const [params, setParams] = useSearchParams();
  const setFilter = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };
  const when = (iso: string) => new Date(iso).toLocaleString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { dateStyle: "medium", timeStyle: "short" });
  const chip = (active: boolean) => `cursor-pointer rounded-full border px-3 py-1.5 text-xs font-bold transition-colors ${active ? "border-action bg-action text-on-action" : "border-border bg-surface text-text-muted hover:text-text"}`;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("inbox.title")} subtitle={t("inbox.subtitle", { count: loaderData.unread })} />

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3 shadow-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" className={chip(!params.get("kind"))} onClick={() => setFilter("kind", null)}>{t("common.all")}</button>
          <button type="button" className={chip(params.get("kind") === "customer")} onClick={() => setFilter("kind", "customer")}>{t("inbox.kind.customer")}</button>
          <button type="button" className={chip(params.get("kind") === "vendor")} onClick={() => setFilter("kind", "vendor")}>{t("inbox.kind.vendor")}</button>
          <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
          {(["new", "open", "replied", "closed"] as const).map((s) => (
            <button key={s} type="button" className={chip(params.get("status") === s)} onClick={() => setFilter("status", params.get("status") === s ? null : s)}>{t(`inbox.status.${s}`)}</button>
          ))}
        </div>
        <form method="get" className="flex gap-2">
          {params.get("kind") ? <input type="hidden" name="kind" value={params.get("kind")!} /> : null}
          {params.get("status") ? <input type="hidden" name="status" value={params.get("status")!} /> : null}
          <input name="q" defaultValue={params.get("q") ?? ""} placeholder={t("inbox.search")} type="search"
            className="min-h-10 flex-1 rounded-md border border-border bg-surface px-3 text-sm" />
          <button type="submit" className="rounded-md bg-action px-4 text-sm font-bold text-on-action">{t("common.search")}</button>
        </form>
      </div>

      {rows.length === 0 ? (
        <EmptyState title={t("inbox.emptyTitle")} body={t("inbox.emptyBody")} />
      ) : (
        <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface shadow-1">
          {rows.map((r) => (
            <li key={r.id}>
              <Link to={`/${lang}/admin/contact/${r.id}`} className={`flex flex-col gap-1.5 px-4 py-3 transition-colors hover:bg-surface-tint sm:flex-row sm:items-center sm:gap-4 ${r.status === "new" ? "bg-action/[0.03]" : ""}`}>
                <div className="flex shrink-0 items-center gap-1.5 sm:w-44 sm:flex-col sm:items-start">
                  <span className={`rounded-full border px-2 py-0.5 text-2xs font-black ${KIND_TONE[r.kind]}`}>{t(`inbox.kind.${r.kind}`)}</span>
                  <span className={`rounded-full px-2 py-0.5 text-2xs font-black ${STATUS_TONE[r.status]}`}>{t(`inbox.status.${r.status}`)}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`truncate text-sm text-text ${r.status === "new" ? "font-black" : "font-bold"}`}>{r.subject}</p>
                  <p className="truncate text-xs text-text-muted"><b className="text-text">{r.name}</b> · <span dir="ltr">{r.email}</span> · {r.message}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-2xs text-text-faint">
                  {r.attachments?.length ? <span className="num rounded bg-surface-tint px-1.5 py-0.5 font-bold text-text-muted">📎 {r.attachments.length}</span> : null}
                  <time className="num" dateTime={r.created_at}>{when(r.created_at)}</time>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ErrorBoundary() { return <RouteErrorBoundary />; }
export function HydrateFallback() { return <SkeletonTable />; }

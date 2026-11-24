import { useEffect, useState } from "react";
import { Link, data, useFetcher } from "react-router";
import type { Route } from "./+types/legal";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { legalToText, parseLegalText, type LegalDoc, type LegalKind } from "~/features/legal/legal.shared";
import { Badge, Button, Dialog, EmptyState } from "~/components/ui";
import { PageHeader } from "~/components/layout/PageHeader";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonTable } from "~/components/ui/Skeleton";
import { useActionToast } from "~/components/layout/ActionFeedback";
import { ListSkeleton, useListLoading } from "~/components/ui/ListLoading";

/**
 * Admin → Legal documents: every version of the Terms & Conditions and the
 * seller agreement (current one marked), publishing a new version (users
 * are asked to accept it on their next visit), and the acceptance register
 * — who accepted which version, when, how, from which IP — for legal
 * reference. Acceptance rows are read-only here.
 */
const KINDS: LegalKind[] = ["terms", "seller_agreement"];

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") === "seller_agreement" ? "seller_agreement" : "terms";
  const q = url.searchParams.get("q")?.trim() ?? "";
  const [docs, acc, counts] = await Promise.all([
    client.from("legal_documents").select("id, kind, version, title_ar, title_en, body, content_hash, effective_at, is_current, notes, source_file").order("created_at", { ascending: false }),
    client.from("legal_acceptances")
      .select("id, user_id, kind, version, context, signature, ip, user_agent, accepted_at, vendors(store_name_ar, store_name_en)")
      .eq("kind", kind).order("accepted_at", { ascending: false }).limit(300),
    client.from("legal_acceptances").select("document_id"),
  ]);
  const perDoc = new Map<string, number>();
  for (const r of (counts.data ?? []) as Array<{ document_id: string }>) perDoc.set(r.document_id, (perDoc.get(r.document_id) ?? 0) + 1);
  const raw = (acc.data ?? []) as unknown as Array<{ id: string; user_id: string; kind: string; version: string; context: string; signature: string | null; ip: string | null; user_agent: string | null; accepted_at: string; vendors: { store_name_ar: string; store_name_en: string } | null }>;
  // user_id points at auth.users, so the names come from profiles separately
  const ids = [...new Set(raw.map((r) => r.user_id))];
  const { data: people } = ids.length ? await client.from("profiles").select("id, full_name, email").in("id", ids) : { data: [] };
  const byId = new Map(((people ?? []) as Array<{ id: string; full_name: string; email: string }>).map((p) => [p.id, p]));
  let rows = raw.map((r) => ({ ...r, profiles: byId.get(r.user_id) ?? null }));
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter((r) => [r.profiles?.full_name, r.profiles?.email, r.vendors?.store_name_ar, r.vendors?.store_name_en, r.signature]
      .some((v) => (v ?? "").toLowerCase().includes(needle)));
  }
  return {
    lang, kind, q,
    docs: ((docs.data ?? []) as Array<LegalDoc & { source_file: string | null }>).map((d) => ({ ...d, acceptances: perDoc.get(d.id) ?? 0 })),
    rows,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const form = await request.formData();
  const parsed = parseLegalText(String(form.get("text_ar") ?? ""), String(form.get("text_en") ?? ""));
  if (!parsed.ok) return data({ ok: false, reason: parsed.reason }, { status: 400 });
  const { data: res, error } = await client.rpc("fn_admin_publish_legal", {
    p_kind: String(form.get("kind") ?? ""), p_version: String(form.get("version") ?? "").trim(),
    p_title_ar: String(form.get("title_ar") ?? ""), p_title_en: String(form.get("title_en") ?? ""),
    p_body: parsed.body, p_notes: String(form.get("notes") ?? ""), p_source_file: String(form.get("source_file") ?? ""),
  });
  if (error) return data({ ok: false, reason: "server_error" }, { status: 500 });
  const r = res as { ok: boolean; reason?: string };
  return r.ok ? { ok: true as const } : data({ ok: false, reason: r.reason }, { status: 400 });
}

export default function AdminLegal({ loaderData }: Route.ComponentProps) {
  const listLoading = useListLoading();
  const { t } = useTranslation();
  const { lang, kind, q, docs, rows } = loaderData;
  const en = lang === "en";
  const [publishing, setPublishing] = useState<LegalKind | null>(null);
  const fetcher = useFetcher<typeof action>();
  useActionToast(fetcher, { success: t("legal.published") });
  useEffect(() => { if (fetcher.state === "idle" && fetcher.data?.ok) setPublishing(null); }, [fetcher.state, fetcher.data]);
  const when = (v: string) => new Date(v).toLocaleString(en ? "en-GB" : "ar-EG-u-nu-latn", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const current = (k: LegalKind) => docs.find((d) => d.kind === k && d.is_current);
  const draft = publishing ? current(publishing) : undefined;
  const INPUT = "w-full rounded-md border border-border bg-surface p-2.5 text-sm text-text";
  const L = "flex flex-col gap-1 text-xs font-bold text-text-muted";

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("legal.adminTitle")} subtitle={t("legal.adminHint")} />

      <div className="grid gap-4 lg:grid-cols-2">
        {KINDS.map((k) => (
          <section key={k} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-1">
            <header className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-extrabold text-text">{t(`legal.kind_${k}`)}</h2>
              <div className="flex gap-2">
                <Link to={`/${lang}/legal/${k === "terms" ? "terms" : "seller-agreement"}`} target="_blank" className="text-sm font-bold text-action hover:underline">{t("legal.view")}</Link>
                <Button size="sm" onClick={() => setPublishing(k)}>{t("legal.publishNew")}</Button>
              </div>
            </header>
            <ul className="flex flex-col gap-2">
              {docs.filter((d) => d.kind === k).map((d) => (
                <li key={d.id} className="rounded-md border border-border p-2.5 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <b className="num">v{d.version}</b>
                    {d.is_current ? <Badge tone="success">{t("legal.current")}</Badge> : <Badge tone="neutral">{t("legal.superseded")}</Badge>}
                    <span className="text-xs text-text-muted">{t("legal.sectionsCount", { s: d.body.sections.length, c: d.body.sections.reduce((n, s) => n + s.clauses.length, 0) })}</span>
                    <span className="ms-auto text-xs font-bold text-text">{t("legal.acceptedBy", { n: d.acceptances })}</span>
                  </div>
                  <p className="num mt-1 text-2xs text-text-faint" dir="ltr">{when(d.effective_at)} · sha256 {d.content_hash.slice(0, 12)}…</p>
                  {d.notes ? <p className="mt-0.5 text-xs text-text-muted">{d.notes}</p> : null}
                  {d.source_file ? <p className="mt-0.5 truncate text-2xs text-text-faint">{d.source_file}</p> : null}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-1">
        <header className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-extrabold text-text">{t("legal.register")}</h2>
          <nav className="flex gap-1">
            {KINDS.map((k) => (
              <Link key={k} to={`?kind=${k}`} className={`rounded-md px-3 py-1 text-xs font-bold ${kind === k ? "bg-action text-on-action" : "text-text-muted hover:bg-surface-tint"}`}>{t(`legal.kind_${k}`)}</Link>
            ))}
          </nav>
          <form className="ms-auto">
            <input type="hidden" name="kind" value={kind} />
            <input name="q" defaultValue={q} placeholder={t("legal.search")} className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm" />
          </form>
        </header>
        {listLoading ? <ListSkeleton /> : rows.length === 0 ? <EmptyState title={t("legal.noRecords")} /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-surface-tint text-xs text-text-muted">
                <tr>{["user", "version", "when", "how", "signature", "ip"].map((h) => <th key={h} className="p-2.5 text-start font-bold">{t(`legal.col_${h}`)}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="p-2.5"><b className="block text-text">{r.profiles?.full_name || "—"}</b><span className="text-xs text-text-muted" dir="ltr">{r.profiles?.email}</span>
                      {r.vendors ? <span className="block text-xs text-text-muted">{en ? r.vendors.store_name_en : r.vendors.store_name_ar}</span> : null}</td>
                    <td className="num p-2.5">v{r.version}</td>
                    <td className="num p-2.5 text-xs">{when(r.accepted_at)}</td>
                    <td className="p-2.5 text-xs">{t(`legal.ctx_${r.context}`)}</td>
                    <td className="p-2.5 text-xs">{r.signature ?? "—"}</td>
                    <td className="num p-2.5 text-2xs text-text-muted" dir="ltr" title={r.user_agent ?? ""}>{r.ip ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Dialog open={publishing !== null} onClose={() => setPublishing(null)} title={publishing ? t("legal.publishTitle", { kind: t(`legal.kind_${publishing}`) }) : ""} size="xl">
        {publishing ? (
          <fetcher.Form method="post" className="flex min-h-0 flex-1 flex-col">
            <input type="hidden" name="kind" value={publishing} />
            <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto p-4 md:grid-cols-2">
              <p className="text-xs text-text-muted md:col-span-2">{t("legal.formatHint")}</p>
              <label className={L}>{t("legal.version")}<input name="version" required dir="ltr" pattern="[0-9A-Za-z.\-]{1,20}" className={INPUT} placeholder={draft ? `> ${draft.version}` : "1.0"} /></label>
              <label className={L}>{t("legal.sourceFile")}<input name="source_file" className={INPUT} /></label>
              <label className={L}>{t("legal.titleAr")}<input name="title_ar" required defaultValue={draft?.title_ar} className={INPUT} /></label>
              <label className={L}>{t("legal.titleEn")}<input name="title_en" required dir="ltr" defaultValue={draft?.title_en} className={INPUT} /></label>
              <label className={L}>{t("legal.textAr")}<textarea name="text_ar" required rows={18} defaultValue={draft ? legalToText(draft.body, "ar") : ""} className={`${INPUT} font-mono text-xs`} /></label>
              <label className={L}>{t("legal.textEn")}<textarea name="text_en" required rows={18} dir="ltr" defaultValue={draft ? legalToText(draft.body, "en") : ""} className={`${INPUT} font-mono text-xs`} /></label>
              <label className={`${L} md:col-span-2`}>{t("legal.notes")}<input name="notes" className={INPUT} /></label>
              <p className="text-xs font-bold text-warning-strong md:col-span-2">{t("legal.publishWarning")}</p>
            </div>
            <footer className="flex justify-end gap-2 border-t border-border px-4 py-3">
              <Button type="button" variant="ghost" onClick={() => setPublishing(null)}>{t("common.cancel")}</Button>
              <Button type="submit" loading={fetcher.state !== "idle"}>{t("legal.publish")}</Button>
            </footer>
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
  return <SkeletonTable />;
}

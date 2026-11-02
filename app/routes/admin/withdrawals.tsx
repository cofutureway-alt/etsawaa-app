import { data, useFetcher } from "react-router";
import type { Route } from "./+types/withdrawals";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { formatPiastres } from "~/lib/money";
import { Button } from "~/components/ui/Button";
import { Dialog } from "~/components/ui/Overlay";
import { EmptyState } from "~/components/ui/EmptyState";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonTable } from "~/components/ui/Skeleton";


/**
 * A-02 — Withdrawals (US-02): tabs Pending/Approved/Cancelled/All + CSV export
 * + approve/cancel (reason mandatory) → wallet moved exactly once by the
 * phase-06 RPC (hold taken at request; approve only flips; cancel restores).
 */

interface WdRow {
  id: string; vendor_ar: string; vendor_en: string; amount_piastres: number;
  method: string; details: { holder?: string; account?: string }; status: string;
  created_at: string;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);

  const tab = new URL(request.url).searchParams.get("tab") ?? "pending";
  let q = client
    .from("withdrawal_requests")
    .select("id, amount_piastres, method, details, status, created_at, vendors(store_name_ar, store_name_en)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (["pending", "approved", "cancelled"].includes(tab)) q = q.eq("status", tab);
  const [{ data: rows, error }, { data: statRows }] = await Promise.all([
    q,
    client.from("withdrawal_requests").select("status, amount_piastres"),
  ]);
  if (error) throw new Error(error.message);
  const wd: WdRow[] = ((rows ?? []) as unknown as Array<Record<string, unknown>>).map((r) => {
    const v = r.vendors as { store_name_ar: string; store_name_en: string } | null;
    return {
      id: r.id as string,
      vendor_ar: v?.store_name_ar ?? "", vendor_en: v?.store_name_en ?? "",
      amount_piastres: r.amount_piastres as number,
      method: r.method as string,
      details: (r.details ?? {}) as { holder?: string; account?: string },
      status: r.status as string,
      created_at: r.created_at as string,
    };
  });
  // H-15: per-status counters + held sums — measured server-side over ALL
  // requests, not derived from the displayed page slice
  const stats = { pending: 0, approved: 0, cancelled: 0, pendingSum: 0, approvedSum: 0 };
  for (const r of (statRows ?? []) as Array<{ status: string; amount_piastres: number }>) {
    if (r.status === "pending") { stats.pending += 1; stats.pendingSum += r.amount_piastres; }
    else if (r.status === "approved") { stats.approved += 1; stats.approvedSum += r.amount_piastres; }
    else if (r.status === "cancelled") stats.cancelled += 1;
  }
  return { lang, tab, wd, stats };
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const form = await request.formData();
  const id = String(form.get("id") ?? "");
  const decision = String(form.get("decision") ?? "");
  const { data: res, error } = await client.rpc("fn_admin_withdrawal_decision", { p_id: id, p_decision: decision });
  if (error) return data({ ok: false, reason: "server_error" }, { status: 500 });
  const r = res as { ok: boolean; reason?: string };
  return r.ok ? { ok: true as const } : data({ ok: false, reason: r.reason }, { status: 400 });
}

export default function AdminWithdrawals({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const money = (p: number) => formatPiastres(p, en ? "en" : "ar");
  const fetcher = useFetcher<typeof action>();
  const [cancelTarget, setCancelTarget] = useState<WdRow | null>(null);
  const [reason, setReason] = useState("");
  const busy = fetcher.state !== "idle";
  const lang = loaderData.lang;

  const tabs = [
    { key: "pending", label: t("wd.tabPending") },
    { key: "approved", label: t("wd.tabApproved") },
    { key: "cancelled", label: t("wd.tabCancelled") },
    { key: "all", label: t("wd.tabAll") },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-black text-text">{t("wd.title")}</h1>
            <span className="rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-black text-action">
              {loaderData.stats.pending} {en ? "Pending" : "معلق"}
            </span>
          </div>
          <p className="mt-1 text-xs text-text-muted">
            {en
              ? "Review vendor payout requests, verify bank / InstaPay accounts, and authorize settlements."
              : "متابعة طلبات سحب أرباح التجار، التحقق من الحسابات البنكية ومحافظ إنستاباي، واعتماد التحويلات."}
          </p>
        </div>
        {/* CSV export of the currently listed rows */}
        <a
          href={`data:text/csv;charset=utf-8,${encodeURIComponent(
            "id,vendor,amount_piastres,method,status,date\n" +
            loaderData.wd.map((w) =>
              [w.id, en ? w.vendor_en : w.vendor_ar, w.amount_piastres, w.method, w.status, w.created_at].join(","),
            ).join("\n"))}`}
          download="withdrawals.csv"
          className="rounded-m border border-border bg-surface px-3 py-1.5 text-xs font-bold text-text hover:bg-surface-tint shadow-1"
        >
          {t("wd.export")}
        </a>
      </div>

      {/* H-15 stats strip — per-status counts + held sums (server-computed) */}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { key: "pending", label: t("wd.tabPending"), value: loaderData.stats.pending, moneyVal: loaderData.stats.pendingSum, tone: "text-warning-strong", border: "border-t-warning" },
          { key: "approved", label: t("wd.tabApproved"), value: loaderData.stats.approved, moneyVal: loaderData.stats.approvedSum, tone: "text-success-strong", border: "border-t-success" },
          { key: "cancelled", label: t("wd.tabCancelled"), value: loaderData.stats.cancelled, moneyVal: null, tone: "text-danger", border: "border-t-danger" },
        ].map((s) => (
          <div key={s.key} className={`rounded-l border border-border border-t-[3px] ${s.border} bg-surface p-4 shadow-1`}>
            <dt className="text-xs font-bold text-text-muted">{s.label}</dt>
            <dd className={`num mt-1 text-xl font-black ${s.tone}`}>{s.value}</dd>
            {s.moneyVal != null ? <dd className="num mt-0.5 text-xs font-bold text-text" dir="ltr">{money(s.moneyVal)}</dd> : null}
          </div>
        ))}
        <div className="rounded-l border border-border bg-surface p-4 shadow-1">
          <dt className="text-xs font-bold text-text-muted">{t("wd.statShowing")}</dt>
          <dd className="num mt-1 text-xl font-black text-text">{loaderData.wd.length}</dd>
          <dd className="mt-0.5 text-[11px] text-text-faint">{t("wd.statShowingHint")}</dd>
        </div>
      </dl>

      <nav className="flex flex-wrap gap-1.5 rounded-l border border-border bg-surface p-2 shadow-1" aria-label={t("wd.title")}>
        {tabs.map((tab) => (
          <a key={tab.key}
            href={`/${lang}/admin/withdrawals?tab=${tab.key}`}
            aria-current={loaderData.tab === tab.key ? "page" : undefined}
            className={`rounded-m border px-3.5 py-1.5 text-xs font-bold transition-all duration-150 ${
              loaderData.tab === tab.key
                ? "border-action bg-action text-on-action shadow-sm"
                : "border-transparent text-text-muted hover:bg-surface-tint hover:text-text"
            }`}>
            {tab.label}
          </a>
        ))}
      </nav>

      {loaderData.wd.length === 0 ? (
        <div className="mt-4"><EmptyState title={t("wd.empty")} body={t("wd.emptyHint")} /></div>
      ) : (
        <>
          {/* table ≥768 → cards below (design skill: table→card) */}
          <div className="mt-3 hidden md:block overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border text-start text-xs text-text-muted">
                  <th className="p-2 text-start">{t("wd.vendor")}</th>
                  <th className="p-2 text-start">{t("wd.amount")}</th>
                  <th className="p-2 text-start">{t("wd.method")}</th>
                  <th className="p-2 text-start">{t("wd.details")}</th>
                  <th className="p-2 text-start">{t("wd.date")}</th>
                  <th className="p-2 text-start">{t("wd.status")}</th>
                  <th className="p-2 text-start">{t("wd.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {loaderData.wd.map((w) => (
                  <tr key={w.id} className="border-b border-border/60">
                    <td className="p-2 font-bold text-text">{en ? w.vendor_en : w.vendor_ar}</td>
                    <td className="p-2 tabular-nums" dir="ltr">{money(w.amount_piastres)}</td>
                    <td className="p-2">{t(`withdrawal.method_${w.method}`)}</td>
                    <td className="p-2 text-xs text-text-muted" dir="ltr">{w.details.account ?? "—"}</td>
                    <td className="p-2 text-xs text-text-muted" dir="ltr">{w.created_at.slice(0, 10)}</td>
                    <td className="p-2">{t(`withdrawal.status_${w.status}`)}</td>
                    <td className="p-2">
                      {w.status === "pending" ? (
                        <div className="flex gap-1.5">
                          <fetcher.Form method="post">
                            <input type="hidden" name="id" value={w.id} />
                            <input type="hidden" name="decision" value="approve" />
                            <Button type="submit" size="sm" disabled={busy}>{t("wd.approve")}</Button>
                          </fetcher.Form>
                          <button type="button" onClick={() => { setCancelTarget(w); setReason(""); }}
                            className="cursor-pointer rounded-m border border-danger/50 px-3 py-1.5 text-[13px] font-bold text-danger hover:bg-danger-soft">
                            {t("wd.cancel")}
                          </button>
                        </div>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="mt-3 flex flex-col gap-3 md:hidden">
            {loaderData.wd.map((w) => (
              <li key={w.id} className="rounded-m border border-border bg-surface p-3 text-[13px]">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-text">{en ? w.vendor_en : w.vendor_ar}</span>
                  <span className="tabular-nums" dir="ltr">{money(w.amount_piastres)}</span>
                </div>
                <p className="mt-1 text-xs text-text-muted">
                  {t(`withdrawal.method_${w.method}`)} · {t(`withdrawal.status_${w.status}`)} · <span dir="ltr">{w.created_at.slice(0, 10)}</span>
                </p>
                {w.status === "pending" ? (
                  <div className="mt-2 flex gap-2">
                    <fetcher.Form method="post" className="flex-1">
                      <input type="hidden" name="id" value={w.id} />
                      <input type="hidden" name="decision" value="approve" />
                      <Button type="submit" size="sm" disabled={busy} className="w-full">{t("wd.approve")}</Button>
                    </fetcher.Form>
                    <button type="button" onClick={() => { setCancelTarget(w); setReason(""); }}
                      className="flex-1 cursor-pointer rounded-m border border-danger/50 px-3 py-1.5 text-[13px] font-bold text-danger">
                      {t("wd.cancel")}
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}

      {/* cancel dialog — reason mandatory */}
      <Dialog open={cancelTarget !== null} onClose={() => setCancelTarget(null)} title={t("wd.cancelTitle")}>
        {cancelTarget !== null ? (
          <fetcher.Form method="post" onSubmit={() => { if (reason.trim().length < 3) { /* blocked server-side */ } }}>
            <input type="hidden" name="id" value={cancelTarget.id} />
            <input type="hidden" name="decision" value="cancel" />
            <label htmlFor="cancel-reason" className="text-[13px] font-bold text-text">{t("wd.reason")}</label>
            <textarea id="cancel-reason" name="reason" rows={3} required minLength={3} value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-1 w-full rounded-m border border-border bg-surface p-2 text-[13px] text-text"
              placeholder={t("wd.reasonPlaceholder")} />
            <p className="mt-1 text-xs text-text-muted">{t("wd.cancelNote")}</p>
            <div className="mt-3 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setCancelTarget(null)}>{t("common.cancel")}</Button>
              <Button type="submit" variant="outline" disabled={busy || reason.trim().length < 3}>{t("wd.confirm")}</Button>
            </div>
          </fetcher.Form>
        ) : null}
      </Dialog>
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

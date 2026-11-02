import { data, useFetcher } from "react-router";
import type { Route } from "./+types/refunds";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { formatPiastres } from "~/lib/money";
import { Button } from "~/components/ui/Button";
import { Badge } from "~/components/ui/Badge";
import { EmptyState } from "~/components/ui/EmptyState";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonTable } from "~/components/ui/Skeleton";
import { DocumentImage } from "~/components/account/DocumentImage";


/**
 * A-16/A-17 — Refunds (US-05): queue by status; per-item decision (approve /
 * partial / reject) with fault (vendor/shipping/customer/defect), amount and
 * restock. Vendor fault ⇒ clawback + penalty (one atomic RPC); shipping fault
 * ⇒ no vendor charge. Decision is final; execute settles the refunded money.
 */

interface RfqItem {
  id: string; order_item_id: string; qty: number; reason: string;
  decision: string | null; fault: string | null; refund_amount_piastres: number | null;
  restock: boolean;
  product_name: string; unit_piastres: number; line_total_piastres: number;
  vendor_ar: string; vendor_en: string;
}
interface Rfq {
  id: string; order_number: string; customer: string; kind: string;
  description: string; status: string; created_at: string;
  /** jsonb array of documents-bucket paths uploaded with the request */
  evidence: string[] | null;
  items: RfqItem[];
}

function pickName(ar?: string | null, en?: string | null) { return ar ?? en ?? ""; }

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);

  const status = new URL(request.url).searchParams.get("status") ?? "pending_admin";
  let q = client
    .from("refund_requests")
    .select(`id, kind, description, evidence, status, created_at,
             orders(number, ship_name),
             refund_request_items(id, order_item_id, qty, reason, decision, fault,
               refund_amount_piastres, restock,
               order_items(product_name_ar, product_name_en, unit_price_piastres, line_total_piastres,
                 vendors(store_name_ar, store_name_en)))`)
    .order("created_at", { ascending: false })
    .limit(50);
  if (["pending_admin", "approved", "rejected", "refunded", "closed"].includes(status)) q = q.eq("status", status);
  const { data: rows, error } = await q;
  if (error) throw new Error(error.message);

  const rfqs: Rfq[] = ((rows ?? []) as unknown as Array<Record<string, unknown>>).map((r) => {
    const order = r.orders as { number: string; ship_name: string } | null;
    const items = ((r.refund_request_items ?? []) as unknown as Array<Record<string, unknown>>).map((it) => {
      const oi = it.order_items as Record<string, unknown> | null;
      const v = oi?.vendors as { store_name_ar: string; store_name_en: string } | null;
      return {
        id: it.id as string, order_item_id: it.order_item_id as string,
        qty: it.qty as number, reason: it.reason as string,
        decision: (it.decision as string | null) ?? null,
        fault: (it.fault as string | null) ?? null,
        refund_amount_piastres: (it.refund_amount_piastres as number | null) ?? null,
        restock: (it.restock as boolean) ?? true,
        product_name: pickName(oi?.product_name_ar as string | null, oi?.product_name_en as string | null),
        unit_piastres: (oi?.unit_price_piastres as number) ?? 0,
        line_total_piastres: (oi?.line_total_piastres as number) ?? 0,
        vendor_ar: v?.store_name_ar ?? "", vendor_en: v?.store_name_en ?? "",
      };
    });
    return {
      id: r.id as string,
      order_number: order?.number ?? "",
      customer: order?.ship_name ?? "",
      kind: r.kind as string,
      description: r.description as string,
      status: r.status as string,
      created_at: r.created_at as string,
      evidence: Array.isArray(r.evidence) ? (r.evidence as string[]) : null,
      items,
    };
  });
  // product names picked at render time by locale
  return { lang, status, rfqs: JSON.parse(JSON.stringify(rfqs)) };
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const requestId = String(form.get("request_id") ?? "");

  if (intent === "decide") {
    // one JSON payload per item decision → fn_admin_decide_refund
    const itemIds = form.getAll("item_id").map(String);
    const items = itemIds.map((id) => ({
      item_id: id,
      decision: String(form.get(`decision_${id}`) ?? "reject"),
      fault: String(form.get(`fault_${id}`) ?? "customer"),
      amount: Math.max(0, Math.trunc(Number(form.get(`amount_${id}`) ?? 0)) || 0),
      restock: form.get(`restock_${id}`) === "on",
    }));
    const res = await client.rpc("fn_admin_decide_refund", {
      p_request_id: requestId, p_items: items, p_note: String(form.get("note") ?? ""),
    });
    if (res.error) return data({ ok: false, reason: res.error.message }, { status: 500 });
    const r = res.data as { ok: boolean; reason?: string };
    return r.ok ? { ok: true as const } : data({ ok: false, reason: r.reason }, { status: 400 });
  }

  if (intent === "execute") {
    const res = await client.rpc("fn_admin_execute_refund", {
      p_request_id: requestId, p_note: String(form.get("note") ?? ""),
    });
    if (res.error) return data({ ok: false, reason: res.error.message }, { status: 500 });
    const r = res.data as { ok: boolean; reason?: string };
    return r.ok ? { ok: true as const } : data({ ok: false, reason: r.reason }, { status: 400 });
  }

  return data({ ok: false, reason: "bad_intent" }, { status: 400 });
}

const TABS = ["pending_admin", "approved", "refunded", "closed"] as const;

export default function AdminRefunds({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const money = (p: number) => formatPiastres(p, en ? "en" : "ar");
  const fetcher = useFetcher<typeof action>();
  const [openId, setOpenId] = useState<string | null>(null);
  const busy = fetcher.state !== "idle";
  const lang = loaderData.lang;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-black text-text">{t("rf.title")}</h1>
            <span className="rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-black text-action">
              {loaderData.rfqs.length}
            </span>
          </div>
          <p className="mt-1 text-xs text-text-muted">
            {en
              ? "Review customer return requests, inspect defects, and process refunds."
              : "متابعة طلبات الإرجاع، فحص المنتجات، واتخاذ قرارات الاسترداد المالي والتسوية."}
          </p>
        </div>
      </div>

      <nav className="flex flex-wrap gap-1.5 rounded-lg border border-border bg-surface p-2 shadow-1" aria-label={t("rf.title")}>
        {TABS.map((s) => (
          <a
            key={s}
            href={`/${lang}/admin/refunds?status=${s}`}
            aria-current={loaderData.status === s ? "page" : undefined}
            className={`rounded-md border px-3.5 py-1.5 text-xs font-bold transition-all duration-150 ${
              loaderData.status === s
                ? "border-action bg-action text-on-action shadow-sm"
                : "border-transparent text-text-muted hover:bg-surface-tint hover:text-text"
            }`}
          >
            {t(`rfund.status_${s}`)}
          </a>
        ))}
      </nav>

      {loaderData.rfqs.length === 0 ? (
        <div className="mt-4"><EmptyState title={t("rf.empty")} body={t("rf.emptyHint")} /></div>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {(loaderData.rfqs as Rfq[]).map((r) => (
            <li key={r.id} className="rounded-md border border-border bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <a href={`/${lang}/admin/orders/${encodeURIComponent(r.order_number)}`} className="font-extrabold text-action hover:underline" dir="ltr">
                  {r.order_number}
                </a>
                <span className="text-text">{r.customer}</span>
                <Badge tone={r.kind === "return" ? "neutral" : "info"}>{t(`rfund.kind_${r.kind}`)}</Badge>
                <Badge tone={r.status === "pending_admin" ? "warning" : r.status === "refunded" ? "success" : "neutral"}>
                  {t(`rfund.status_${r.status}`)}
                </Badge>
                <span className="text-xs text-text-muted" dir="ltr">{r.created_at.slice(0, 10)}</span>
              </div>
              {r.description ? <p className="mt-1.5 text-sm text-text-muted">{r.description}</p> : null}
              {/* A-03: the admin rules on money here, so the customer's proof
                  is shown inline rather than left in the database. */}
              <EvidenceStrip paths={r.evidence} />

              <details className="mt-2" open={r.status === "pending_admin" && openId === r.id}
                onToggle={(e) => { if ((e.target as HTMLDetailsElement).open) setOpenId(r.id); }}>
                <summary className="cursor-pointer text-sm font-bold text-primary">{t("rf.items", { count: r.items.length })}</summary>
                {r.status === "pending_admin" ? (
                  <fetcher.Form method="post" className="mt-2 flex flex-col gap-3">
                    <input type="hidden" name="intent" value="decide" />
                    <input type="hidden" name="request_id" value={r.id} />
                    {r.items.map((it) => (
                      <fieldset key={it.id} className="rounded-md border border-border/70 p-3 text-sm">
                        <legend className="px-1 font-bold text-text">
                          {en ? it.vendor_en : it.vendor_ar} — {it.product_name} × {it.qty}
                        </legend>
                        <div className="flex flex-wrap items-center gap-2">
                          <label htmlFor={`dec-${it.id}`} className="sr-only">{t("rf.decision")}</label>
                          <select id={`dec-${it.id}`} name={`decision_${it.id}`} defaultValue="approve"
                            className="rounded-md border border-border bg-surface px-2 py-1.5">
                            <option value="approve">{t("rf.approve")}</option>
                            <option value="partial">{t("rf.partial")}</option>
                            <option value="reject">{t("rf.reject")}</option>
                          </select>
                          <label htmlFor={`fault-${it.id}`} className="sr-only">{t("rf.fault")}</label>
                          <select id={`fault-${it.id}`} name={`fault_${it.id}`} defaultValue="vendor"
                            className="rounded-md border border-border bg-surface px-2 py-1.5">
                            <option value="vendor">{t("rf.faultVendor")}</option>
                            <option value="shipping">{t("rf.faultShipping")}</option>
                            <option value="customer">{t("rf.faultCustomer")}</option>
                            <option value="defect">{t("rf.faultDefect")}</option>
                          </select>
                          <label htmlFor={`amt-${it.id}`} className="text-xs text-text-muted">{t("rf.amount")}</label>
                          <input id={`amt-${it.id}`} name={`amount_${it.id}`} type="number" min={0} step={1} dir="ltr"
                            defaultValue={it.line_total_piastres}
                            className="w-28 rounded-md border border-border bg-surface px-2 py-1.5 text-sm" />
                          <label className="flex items-center gap-1.5 text-xs text-text">
                            <input type="checkbox" name={`restock_${it.id}`} defaultChecked className="size-4 accent-[var(--color-action)]" />
                            {t("rf.restock")}
                          </label>
                          <span className="text-xs text-text-muted" dir="ltr">{money(it.line_total_piastres)}</span>
                        </div>
                      </fieldset>
                    ))}
                    <p className="text-xs text-text-muted">{t("rf.faultNote")}</p>
                    <div>
                      <Button type="submit" disabled={busy}>{t("rf.submit")}</Button>
                    </div>
                    {fetcher.data && !fetcher.data.ok ? (
                      <p role="alert" className="text-xs font-bold text-danger">{String(fetcher.data.reason)}</p>
                    ) : null}
                  </fetcher.Form>
                ) : r.status === "approved" ? (
                  <fetcher.Form method="post" className="mt-2 flex flex-wrap items-center gap-2">
                    <input type="hidden" name="intent" value="execute" />
                    <input type="hidden" name="request_id" value={r.id} />
                    <input name="note" placeholder={t("rf.executeNote")} className="w-56 rounded-md border border-border bg-surface px-2.5 py-2 text-sm" />
                    <Button type="submit" size="sm" disabled={busy}>{t("rf.execute")}</Button>
                  </fetcher.Form>
                ) : (
                  <ul className="mt-2 flex flex-col gap-1.5 text-sm">
                    {r.items.map((it) => (
                      <li key={it.id} className="flex flex-wrap items-center gap-2">
                        <span className="text-text">{it.product_name} × {it.qty}</span>
                        {it.decision ? <Badge tone={it.decision === "reject" ? "neutral" : "success"}>{t(`rf.dec_${it.decision}`)}</Badge> : null}
                        {it.fault ? <Badge tone={it.fault === "vendor" ? "danger" : "neutral"}>{t(`rf.fault_${it.fault}`)}</Badge> : null}
                        {it.refund_amount_piastres != null ? (
                          <span className="tabular-nums text-text-muted" dir="ltr">{money(it.refund_amount_piastres)}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}


/**
 * Refund evidence: paths stored in refund_requests.evidence (jsonb array of
 * documents-bucket paths). Opens the full image in a new tab — the signed URL
 * still expires in 60s, so the tab fetches it immediately.
 */
function EvidenceStrip({ paths }: { paths: unknown }) {
  const { t } = useTranslation();
  const list = Array.isArray(paths) ? paths.filter((x): x is string => typeof x === "string") : [];
  if (list.length === 0) {
    return <p className="mt-1.5 text-xs text-text-faint">{t("rfund.noEvidence")}</p>;
  }
  return (
    <div className="mt-2">
      <p className="text-xs font-bold text-text-muted">{t("rfund.evidence", { count: list.length })}</p>
      <ul className="mt-1 flex flex-wrap gap-1.5">
        {list.map((p) => (
          <li key={p}>
            <span className="block transition-opacity hover:opacity-80">
              <DocumentImage path={p} className="size-16" />
            </span>
          </li>
        ))}
      </ul>
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

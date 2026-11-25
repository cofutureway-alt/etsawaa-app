import { data, useFetcher } from "react-router";
import type { Route } from "./+types/refunds";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { egpToPiastres, formatPiastres } from "~/lib/money";
import { Button } from "~/components/ui/Button";
import { PageHeader } from "~/components/layout/PageHeader";
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
  source: string; logistics_status: string; refund_total_piastres: number;
  refund_method: string | null; refund_reference: string | null;
  /** jsonb array of documents-bucket paths uploaded with the request */
  evidence: string[] | null;
  items: RfqItem[];
  resolution: "refund" | "same_product" | "other_products";
  credit_destination: "wallet" | "original" | null;
  exchange_applied_piastres: number;
  exchange_wallet_piastres: number;
  exchange_hold_piastres: number;
  exchange_order: { number: string; total_piastres: number; wallet_paid_piastres: number; payment_status: string; payment_method: string; status: string } | null;
  replacements: Array<{ variant_id: string; qty: number; name: string; label: string | null; unit_piastres: number | null }>;
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
    .select(`id, kind, description, evidence, status, created_at, source, logistics_status, refund_total_piastres,
             refund_method, refund_reference, resolution, credit_destination,
             exchange_applied_piastres, exchange_wallet_piastres, exchange_hold_piastres,
             orders!refund_requests_order_id_fkey(number, ship_name),
             exchange_order:orders!refund_requests_exchange_order_id_fkey(number, total_piastres, wallet_paid_piastres, payment_status, payment_method, status),
             refund_replacements(variant_id, qty, products(name_ar, name_en), variants(option_label_ar, option_label_en)),
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
      source: (r.source as string) ?? "customer",
      logistics_status: (r.logistics_status as string) ?? "awaiting_return",
      refund_total_piastres: (r.refund_total_piastres as number) ?? 0,
      refund_method: (r.refund_method as string | null) ?? null,
      refund_reference: (r.refund_reference as string | null) ?? null,
      evidence: Array.isArray(r.evidence) ? (r.evidence as string[]) : null,
      items,
      resolution: ((r.resolution as string) ?? "refund") as Rfq["resolution"],
      credit_destination: (r.credit_destination as Rfq["credit_destination"]) ?? null,
      exchange_applied_piastres: (r.exchange_applied_piastres as number) ?? 0,
      exchange_wallet_piastres: (r.exchange_wallet_piastres as number) ?? 0,
      exchange_hold_piastres: (r.exchange_hold_piastres as number) ?? 0,
      exchange_order: (r.exchange_order as Rfq["exchange_order"]) ?? null,
      replacements: ((r.refund_replacements ?? []) as Array<Record<string, unknown>>).map((x) => {
        const prod = x.products as { name_ar: string; name_en: string } | null;
        const vr = x.variants as { option_label_ar: string | null; option_label_en: string | null } | null;
        return {
          variant_id: x.variant_id as string, qty: x.qty as number,
          name: pickName(prod?.name_ar, prod?.name_en), label: vr?.option_label_ar ?? vr?.option_label_en ?? null,
          unit_piastres: null as number | null,
        };
      }),
    };
  });
  // today's price of each replacement (the price the exchange order will charge)
  const variantIds = Array.from(new Set(rfqs.flatMap((r) => r.replacements.map((x) => x.variant_id))));
  const prices = new Map<string, number | null>();
  await Promise.all(variantIds.map(async (id) => {
    const { data: unit } = await client.rpc("fn_variant_unit_price", { p_variant: id });
    prices.set(id, typeof unit === "number" ? unit : null);
  }));
  for (const r of rfqs) for (const x of r.replacements) x.unit_piastres = prices.get(x.variant_id) ?? null;
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
      // empty = the server computes what the buyer paid for these units
      amount: egpToPiastres(form.get(`amount_${id}`)) ?? 0,
      restock: form.get(`restock_${id}`) === "on",
    }));
    const res = await client.rpc("fn_admin_decide_refund", {
      p_request_id: requestId, p_items: items, p_note: String(form.get("note") ?? ""),
      p_options: {
        shipping_refund_piastres: egpToPiastres(form.get("shipping_refund")) ?? 0,
        deduction_piastres: egpToPiastres(form.get("deduction")) ?? 0,
        logistics_status: String(form.get("logistics_status") ?? "awaiting_return"),
        ...(form.get("resolution_override") === "refund" ? { resolution: "refund" } : {}),
        ...(form.get("credit_destination") ? { credit_destination: String(form.get("credit_destination")) } : {}),
      },
    });
    if (res.error) return data({ ok: false, reason: res.error.message }, { status: 500 });
    const r = res.data as { ok: boolean; reason?: string };
    return r.ok ? { ok: true as const } : data({ ok: false, reason: r.reason }, { status: 400 });
  }

  if (intent === "received") {
    const res = await client.rpc("fn_admin_return_received", { p_request_id: requestId, p_note: null });
    if (res.error) return data({ ok: false, reason: res.error.message }, { status: 500 });
    const r = res.data as { ok: boolean; reason?: string };
    return r.ok ? { ok: true as const } : data({ ok: false, reason: r.reason }, { status: 400 });
  }

  if (intent === "execute") {
    const res = await client.rpc("fn_admin_execute_refund", {
      p_request_id: requestId, p_note: String(form.get("note") ?? ""),
      p_method: String(form.get("method") ?? "original"),
      p_reference: String(form.get("reference") ?? ""),
    });
    if (res.error) return data({ ok: false, reason: res.error.message }, { status: 500 });
    const r = res.data as { ok: boolean; reason?: string };
    return r.ok ? { ok: true as const } : data({ ok: false, reason: r.reason }, { status: 400 });
  }

  return data({ ok: false, reason: "bad_intent" }, { status: 400 });
}

const TABS = ["pending_admin", "approved", "refunded", "rejected", "closed"] as const;

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
      <PageHeader
        title={t("rf.title")}
        count={loaderData.rfqs.length}
        subtitle={t("rf.subtitle")}
      />

      <nav className="flex flex-wrap gap-1.5 rounded-lg border border-border bg-surface p-2 shadow-1" aria-label={t("rf.title")}>
        {TABS.map((s) => (
          <a
            key={s}
            href={`/${lang}/admin/refunds?status=${s}`}
            aria-current={loaderData.status === s ? "page" : undefined}
            className={`rounded-md border px-3.5 py-1.5 text-xs font-bold transition-all duration-150 ${
              loaderData.status === s
                ? "border-action bg-action text-on-action shadow-1"
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
                {r.source === "admin" ? <Badge tone="info">{t("ret.source_admin")}</Badge> : null}
                {r.source === "cancel" ? <Badge tone="warning">{t("rf.sourceCancel")}</Badge> : null}
                {r.resolution !== "refund" ? <Badge tone="info">{t(`exchange.res_${r.resolution}`)}</Badge> : null}
                {r.status === "approved" ? <Badge tone={r.logistics_status === "awaiting_return" ? "warning" : "neutral"}>{t(`ret.log_${r.logistics_status}`)}</Badge> : null}
                {r.status === "approved" || r.status === "refunded" ? <span className="num text-sm font-black text-action">{money(r.refund_total_piastres)}</span> : null}
                <span className="text-xs text-text-muted" dir="ltr">{r.created_at.slice(0, 10)}</span>
              </div>
              {r.description ? <p className="mt-1.5 text-sm text-text-muted">{r.description}</p> : null}
              {r.exchange_order ? (
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-border bg-surface-tint px-3 py-2 text-xs">
                  <span className="font-bold text-text">
                    {t("exchange.newOrder")}{" "}
                    <a href={`/${lang}/admin/orders/${encodeURIComponent(r.exchange_order.number)}`} className="text-action hover:underline" dir="ltr">{r.exchange_order.number}</a>
                  </span>
                  <span className="text-text-muted">{t("exchange.creditApplied")}: <span className="num font-bold text-text" dir="ltr">{money(r.exchange_applied_piastres)}</span></span>
                  <span className="text-text-muted">{t("exchange.leftToPay")}: <span className="num font-bold text-text" dir="ltr">{money(["paid", "cod_collected", "partially_refunded", "refunded"].includes(r.exchange_order.payment_status) || r.exchange_order.status === "cancelled" ? 0 : Math.max(0, r.exchange_order.total_piastres - r.exchange_order.wallet_paid_piastres))}</span></span>
                  {r.exchange_wallet_piastres > 0 ? (
                    <span className="text-text-muted">{t("exchange.keptInWallet")}: <span className="num font-bold text-text" dir="ltr">{money(r.exchange_wallet_piastres)}</span></span>
                  ) : null}
                  {r.exchange_hold_piastres > 0 ? (
                    <span className="font-bold text-warning-strong">{t("exchange.heldAdmin", { amount: money(r.exchange_hold_piastres) })}</span>
                  ) : null}
                  <span className="text-text-muted">{t(`order.pay_${r.exchange_order.payment_status}`, { defaultValue: r.exchange_order.payment_status })}</span>
                </div>
              ) : null}
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
                          <input id={`amt-${it.id}`} name={`amount_${it.id}`} type="number" min={0} step="0.01" inputMode="decimal" dir="ltr"
                            placeholder={t("ret.amountAuto")}
                            className="w-28 rounded-md border border-border bg-surface px-2 py-1.5 text-sm" />
                          <label className="flex items-center gap-1.5 text-xs text-text">
                            <input type="checkbox" name={`restock_${it.id}`} defaultChecked className="size-4 accent-[var(--color-action)]" />
                            {t("rf.restock")}
                          </label>
                          <span className="text-xs text-text-muted" dir="ltr">{money(it.line_total_piastres)}</span>
                        </div>
                      </fieldset>
                    ))}
                    {r.resolution !== "refund" ? (
                      <ExchangeDecision r={r} money={money} />
                    ) : null}
                    <div className="grid gap-2 sm:grid-cols-3">
                      <label className="flex flex-col gap-1 text-xs font-bold text-text-muted">
                        {t("ret.shippingRefund")}
                        <input name="shipping_refund" inputMode="decimal" dir="ltr" placeholder="0" className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm" />
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-bold text-text-muted">
                        {t("ret.deduction")}
                        <input name="deduction" inputMode="decimal" dir="ltr" placeholder="0" className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm" />
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-bold text-text-muted">
                        {t("ret.logistics")}
                        <select name="logistics_status" defaultValue="awaiting_return" className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm">
                          {["awaiting_return", "received", "not_required"].map((v) => <option key={v} value={v}>{t(`ret.logChoice_${v}`)}</option>)}
                        </select>
                      </label>
                    </div>
                    <p className="text-xs text-text-muted">{t("rf.faultNote")} {t("ret.amountHelp")}</p>
                    <div>
                      <Button type="submit" disabled={busy}>{t("rf.submit")}</Button>
                    </div>
                    {fetcher.data && !fetcher.data.ok ? (
                      <p role="alert" className="text-xs font-bold text-danger">{decisionError(String(fetcher.data.reason ?? ""), t)}</p>
                    ) : null}
                  </fetcher.Form>
                ) : r.status === "approved" && r.logistics_status === "awaiting_return" ? (
                  <fetcher.Form method="post" className="mt-2 flex flex-wrap items-center gap-2">
                    <input type="hidden" name="intent" value="received" />
                    <input type="hidden" name="request_id" value={r.id} />
                    <span className="text-xs text-text-muted">{t("ret.awaitingHint")}</span>
                    <Button type="submit" size="sm" variant="outline" disabled={busy}>{t("ret.markReceived")}</Button>
                  </fetcher.Form>
                ) : r.status === "approved" ? (
                  <fetcher.Form method="post" className="mt-2 flex flex-wrap items-center gap-2">
                    <input type="hidden" name="intent" value="execute" />
                    <input type="hidden" name="request_id" value={r.id} />
                    <span className="text-xs font-bold text-text">
                      {t("exchange.toRefund")}: <span className="num" dir="ltr">{money(Math.max(0, r.refund_total_piastres - r.exchange_applied_piastres - r.exchange_wallet_piastres))}</span>
                    </span>
                    <label htmlFor={`m-${r.id}`} className="sr-only">{t("ret.method")}</label>
                    <select id={`m-${r.id}`} name="method" defaultValue={r.resolution !== "refund" && r.credit_destination === "original" ? "original" : "store_wallet"} className="rounded-md border border-border bg-surface px-2 py-2 text-sm">
                      {["store_wallet", "original", "bank_transfer", "wallet", "cash", "other"].map((m) => <option key={m} value={m}>{t(`ret.method_${m}`)}</option>)}
                    </select>
                    <input name="reference" dir="ltr" placeholder={t("ret.reference")} className="w-36 rounded-md border border-border bg-surface px-2.5 py-2 text-sm" />
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
 * The exchange part of a decision: the replacements at today's price, the
 * choice to turn it into a plain refund, and where any leftover credit goes
 * (the admin decides; nothing is automatic).
 */
function ExchangeDecision({ r, money }: { r: Rfq; money: (p: number) => string }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"exchange" | "refund">("exchange");
  const total = r.replacements.reduce((sum, x) => sum + (x.unit_piastres ?? 0) * x.qty, 0);
  return (
    <fieldset className="rounded-md border border-action/40 bg-surface-tint p-3 text-sm">
      <legend className="px-1 font-bold text-text">{t(`exchange.res_${r.resolution}`)}</legend>
      <ul className="flex flex-col gap-1">
        {r.replacements.map((x) => (
          <li key={x.variant_id} className="flex flex-wrap justify-between gap-2">
            <span className="text-text">{x.name}{x.label ? ` (${x.label})` : ""} × {x.qty}</span>
            <span className="num font-bold text-text" dir="ltr">
              {x.unit_piastres == null ? t("exchange.unavailableNow") : money(x.unit_piastres * x.qty)}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-xs text-text-muted">{t("exchange.todayTotal")}: <span className="num font-bold text-text" dir="ltr">{money(total)}</span> · {t("exchange.shippingRule")}</p>
      <div className="mt-2 flex flex-wrap gap-3">
        <label className="flex items-center gap-1.5 text-xs font-bold text-text">
          <input type="radio" name="resolution_override" value="exchange" checked={mode === "exchange"} onChange={() => setMode("exchange")} className="size-4 accent-[var(--color-action)]" />
          {t("exchange.doExchange")}
        </label>
        <label className="flex items-center gap-1.5 text-xs font-bold text-text">
          <input type="radio" name="resolution_override" value="refund" checked={mode === "refund"} onChange={() => setMode("refund")} className="size-4 accent-[var(--color-action)]" />
          {t("exchange.turnToRefund")}
        </label>
      </div>
      {mode === "exchange" ? (
        <div className="mt-2">
          <p className="text-xs font-bold text-text">{t("exchange.leftoverQuestion")}</p>
          <div className="mt-1 flex flex-wrap gap-3">
            <label className="flex items-center gap-1.5 text-xs text-text">
              <input type="radio" name="credit_destination" value="wallet" required className="size-4 accent-[var(--color-action)]" />
              {t("exchange.destWallet")}
            </label>
            <label className="flex items-center gap-1.5 text-xs text-text">
              <input type="radio" name="credit_destination" value="original" required className="size-4 accent-[var(--color-action)]" />
              {t("exchange.destOriginal")}
            </label>
          </div>
        </div>
      ) : null}
    </fieldset>
  );
}

/** Server reasons from a decision, in words (exchange_* carry the checkout reason). */
function decisionError(reason: string, t: (k: string, o?: Record<string, unknown>) => string): string {
  const [head = "", names = ""] = reason.split(":");
  const key = head.split(" — ")[0] ?? head;
  const known: Record<string, string> = {
    destination_required: "exchange.err_destination_required",
    no_replacements: "exchange.err_no_replacements",
    exchange_insufficient_stock: "exchange.err_stock",
    exchange_items_unavailable: "exchange.err_items_unavailable",
    exchange_area_unavailable: "exchange.err_area",
    exchange_phone_invalid: "exchange.err_address",
    exchange_phones_equal: "exchange.err_address",
    exchange_address_incomplete: "exchange.err_address",
    exchange_cod_cap: "exchange.err_cod_cap",
    exchange_cod_vendor_ship: "exchange.err_cod_vendor",
    exchange_cod_disabled: "exchange.err_cod_disabled",
    group_not_delivered: "exchange.err_not_delivered",
    qty_exceeded: "returns.qtyExceeded",
  };
  const k = known[key];
  return k ? t(k, { names: names.split(" — ")[0] ?? "" }) : t("returns.failed") + (reason ? ` (${reason})` : "");
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

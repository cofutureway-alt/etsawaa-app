import { data, useFetcher } from "react-router";
import type { Route } from "./+types/wallet";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { egpToPiastres, formatPiastres } from "~/lib/money";
import { Button } from "~/components/ui/Button";
import { Dialog } from "~/components/ui/Overlay";
import { Input } from "~/components/ui/Input";
import { EmptyState } from "~/components/ui/EmptyState";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonPage } from "~/components/ui/Skeleton";
import { ListSkeleton, useListLoading } from "~/components/ui/ListLoading";


/**
 * Vendor wallet (VO-07/08/11, VO-12/13) — bank-card style card (available /
 * pending / level progress / last 5), full transactions table with type +
 * signed amount + reason + reference (rows link into the order), withdrawal
 * dialog (min + server-side ≤ available), withdrawals list with cancel while
 * pending. Balances come from fn_vendor_wallet_view (definer); the ledger is
 * the source of truth (AGENT §7).
 */

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "vendor", request);

  const { data: vendorId } = await client.rpc("own_vendor_id");
  if (!vendorId) throw new Response("Forbidden", { status: 403 });

  const [{ data: view }, txRes, wdRes, balRes] = await Promise.all([
    client.rpc("fn_vendor_wallet_view"),
    client.from("wallet_transactions").select("id, type, amount_piastres, reference, reason, order_id, created_at, meta").order("created_at", { ascending: false }).limit(200),
    client.from("withdrawal_requests").select("id, amount_piastres, method, status, cancel_reason, created_at, reviewed_at").order("created_at", { ascending: false }).limit(30),
    // 50% packaging plans still owed: collected with the next delivered order
    client.from("packaging_balances").select("id, amount_piastres, packaging_orders(number)").eq("status", "open"),
  ]);
  if (view.error) throw new Error(view.error.message);

  const url = new URL(request.url);
  const type = url.searchParams.get("type") ?? "";
  const allTxs = (txRes.data ?? []) as WalletTx[];
  // a filter chip is a group of ledger types (or one exact type)
  const groups: Record<string, string[]> = {
    in: ["earning", "shipping_revenue", "withdrawal_refund", "packaging_refund", "ad_refund", "service_refund"],
    out: ["commission", "pickup_fee", "penalty", "refund_clawback", "packaging_balance", "ad_purchase", "service_purchase"],
    withdrawals: ["withdrawal", "withdrawal_refund"],
    ads: ["ad_purchase", "ad_refund", "service_purchase", "service_refund"],
  };
  const txs = type ? allTxs.filter((x) => (groups[type] ?? [type]).includes(x.type)) : allTxs;

  // reasons live in wallet rows; the negative-balance explainer picks the
  // latest debit (US-06 edge)
  const lastDebit = txs.find((x) => x.amount_piastres < 0) ?? null;

  return {
    lang,
    view: JSON.parse(JSON.stringify(view ?? {})),
    txs: JSON.parse(JSON.stringify(txs)),
    allTxs: JSON.parse(JSON.stringify(allTxs)),
    withdrawals: JSON.parse(JSON.stringify(wdRes.data ?? [])),
    filterType: type,
    lastDebit: lastDebit ? JSON.parse(JSON.stringify(lastDebit)) : null,
    openBalances: ((balRes.data ?? []) as unknown as Array<{ id: string; amount_piastres: number; packaging_orders: { number: string } | null }>)
      .map((b) => ({ id: b.id, amount: b.amount_piastres, number: b.packaging_orders?.number ?? "" })),
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "vendor", request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "withdraw") {
    const amount = egpToPiastres(form.get("amount")) ?? 0;
    const method = String(form.get("method") ?? "");
    const details = {
      account: String(form.get("account") ?? "").slice(0, 120),
      holder: String(form.get("holder") ?? "").slice(0, 120),
    };
    if (amount <= 0) return data({ ok: false, reason: "bad_amount" }, { status: 400 });
    const { data: res, error } = await client.rpc("fn_request_withdrawal", {
      p_amount_piastres: amount, p_method: method, p_details: details,
    });
    if (error) return data({ ok: false, reason: "server_error" }, { status: 500 });
    const r = res as { ok: boolean; reason?: string; min_piastres?: number; available_piastres?: number };
    return r.ok ? { ok: true as const } : data({ ok: false, reason: r.reason, min_piastres: r.min_piastres, available_piastres: r.available_piastres }, { status: 400 });
  }

  if (intent === "cancel_withdrawal") {
    const { data: res, error } = await client.rpc("fn_cancel_withdrawal", {
      p_id: String(form.get("id") ?? ""), p_reason: "vendor_cancelled",
    });
    if (error) return data({ ok: false, reason: "server_error" }, { status: 500 });
    const r = res as { ok: boolean; reason?: string };
    return r.ok ? { ok: true as const } : data({ ok: false, reason: r.reason }, { status: 400 });
  }

  return data({ ok: false, reason: "bad_intent" }, { status: 400 });
}

interface WalletTx {
  id: string; type: string; amount_piastres: number;
  reference: string | null; reason: string | null;
  order_id: string | null; created_at: string;
  meta?: { kind?: string; billing_mode?: string; units?: number; rate_piastres?: number; packaging_order?: string; order_number?: string } | null;
}
interface Withdrawal {
  id: string; amount_piastres: number; method: string; status: string;
  cancel_reason: string | null; created_at: string; reviewed_at: string | null;
}
interface WalletView {
  wallet: { available_piastres: number; pending_piastres: number };
  level: {
    name_ar: string; name_en: string; commission_percent: number; hold_days: number;
    min_successful_orders: number; next_min_orders: number | null; next_name_en: string | null;
  } | null;
  successful_orders: number;
  pending_withdrawals: number;
}

export default function WalletPage({ loaderData }: Route.ComponentProps) {
  const listLoading = useListLoading();
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const money = (p: number) => formatPiastres(p, en ? "en" : "ar");
  const view = loaderData.view as WalletView;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [tab, setTab] = useState<"tx" | "wd">("tx");
  const withdrawFetcher = useFetcher<typeof action>();
  const cancelFetcher = useFetcher<typeof action>();
  const busy = withdrawFetcher.state !== "idle";

  const available = view.wallet?.available_piastres ?? 0;
  const pending = view.wallet?.pending_piastres ?? 0;
  const level = view.level;
  const min = 5000; // client mirror; the server enforces the live setting
  const wdResult = withdrawFetcher.data as { ok: boolean; reason?: string; min_piastres?: number } | undefined;
  const [method, setMethod] = useState("bank");
  const [amount, setAmount] = useState("");
  const progessPct = level?.next_min_orders
    ? Math.min(100, Math.round((view.successful_orders / level.next_min_orders) * 100))
    : null;

  // the last 30 days at a glance (from the ledger rows loaded for this page)
  const since = Date.now() - 30 * 86_400_000;
  const recent = (loaderData.allTxs as WalletTx[]).filter((x) => new Date(x.created_at).getTime() >= since);
  const sumOf = (types: readonly string[]) => recent.filter((x) => types.includes(x.type)).reduce((n, x) => n + x.amount_piastres, 0);
  const earned30 = sumOf(["earning", "shipping_revenue"]);
  const fees30 = -sumOf(["commission", "pickup_fee", "penalty", "refund_clawback"]);
  const withdrawals = loaderData.withdrawals as Withdrawal[];
  const withdrawn = withdrawals.filter((w) => w.status === "approved").reduce((n, w) => n + w.amount_piastres, 0);
  const pendingWd = withdrawals.filter((w) => w.status === "pending");
  const day = (v: string) => new Date(v).toLocaleDateString(en ? "en-GB" : "ar-EG-u-nu-latn", { day: "numeric", month: "short", year: "numeric" });
  const methods = ["bank", "instapay", "wallet"] as const;
  const methodLabel = (m: string) => t(`wallet.method${m.charAt(0).toUpperCase()}${m.slice(1)}`);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-text">{t("wallet.title")}</h1>
          <p className="mt-1 text-sm text-text-muted">{t("wallet.subtitle")}</p>
        </div>
        <Button type="button" size="md" onClick={() => setDialogOpen(true)} disabled={available < min}>{t("wallet.withdraw")}</Button>
      </div>

      {/* balances */}
      <section className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]" aria-label={t("wallet.title")}>
        <div className="relative flex flex-col justify-between gap-6 overflow-hidden rounded-2xl bg-action p-6 text-on-action shadow-2">
          <span aria-hidden="true" className="pointer-events-none absolute -end-10 -top-10 size-40 rounded-full bg-white/10" />
          <span aria-hidden="true" className="pointer-events-none absolute -bottom-16 end-16 size-40 rounded-full bg-white/5" />
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-bold opacity-85">{t("wallet.available")}</p>
            {level ? <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-extrabold">{en ? level.name_en : level.name_ar}</span> : null}
          </div>
          <p className="num text-4xl font-black tracking-tight" dir="ltr">{money(available)}</p>
          <p className="text-xs opacity-85">{available >= min ? t("wallet.readyToWithdraw") : t("wallet.minWarn", { min: money(min) })}</p>
        </div>
        <div className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-5 shadow-1">
          <p className="text-sm font-bold text-text-muted">{t("wallet.pending")}</p>
          <p className="num text-2xl font-black text-text" dir="ltr">{money(pending)}</p>
          <p className="text-xs leading-5 text-text-muted">{level ? t("wallet.holdDays", { days: level.hold_days }) : t("wallet.pendingHint")}</p>
        </div>
        <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5 shadow-1">
          <p className="text-sm font-bold text-text-muted">{t("wallet.last30")}</p>
          <dl className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between gap-2"><dt className="text-text-muted">{t("wallet.earned")}</dt><dd className="num font-extrabold text-success" dir="ltr">+{money(earned30)}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-text-muted">{t("wallet.fees")}</dt><dd className="num font-extrabold text-danger" dir="ltr">−{money(fees30)}</dd></div>
            <div className="flex justify-between gap-2 border-t border-border pt-2"><dt className="text-text-muted">{t("wallet.withdrawnTotal")}</dt><dd className="num font-extrabold text-text" dir="ltr">{money(withdrawn)}</dd></div>
          </dl>
        </div>
      </section>

      {level?.next_min_orders ? (
        <section className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-5 shadow-1">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <p className="font-extrabold text-text">{t("wallet.levelProgress")}</p>
            <p className="num text-text-muted">{t("wallet.progress", { done: view.successful_orders, next: level.next_min_orders })}</p>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-tint" role="progressbar" aria-valuenow={progessPct ?? 0} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-action transition-all duration-300" style={{ width: `${progessPct}%` }} />
          </div>
          <p className="text-xs text-text-muted">{t("wallet.levelHint", { commission: level.commission_percent, days: level.hold_days })}</p>
        </section>
      ) : null}

      {/* US-06 edge: negative balance explained by its cause, not a generic warning */}
      {available < 0 && loaderData.lastDebit ? (
        <p role="status" className="rounded-xl border border-danger/40 bg-danger-soft p-3 text-sm text-danger">
          {t("wallet.negative")}: {t(`tx.type_${loaderData.lastDebit.type}`)} {money(loaderData.lastDebit.amount_piastres)} — {loaderData.lastDebit.reason}
        </p>
      ) : null}
      {loaderData.openBalances.length > 0 ? (
        <p role="status" className="rounded-xl border border-warning/40 bg-warning-soft p-3 text-sm text-text">
          {t("pkg.walletOpen", { amount: money(loaderData.openBalances.reduce((s, b) => s + b.amount, 0)) })}{" "}
          {loaderData.openBalances.map((b) => (
            <a key={b.id} href={`/${loaderData.lang}/vendor/packaging/orders/${encodeURIComponent(b.number)}`} className="num font-bold text-action hover:underline" dir="ltr">{b.number} </a>
          ))}
        </p>
      ) : null}
      {pendingWd.length > 0 ? (
        <p role="status" className="rounded-xl border border-border bg-surface-tint/60 p-3 text-sm text-text">
          {t("wallet.pendingWithdrawal", { amount: money(pendingWd.reduce((n, w) => n + w.amount_piastres, 0)) })}
        </p>
      ) : null}

      <nav className="flex gap-1.5 rounded-xl border border-border bg-surface p-1.5 shadow-1" role="tablist">
        {(["tx", "wd"] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`flex-1 cursor-pointer rounded-lg px-3 py-2 text-sm font-extrabold sm:flex-none ${tab === k ? "bg-action text-on-action" : "text-text-muted hover:bg-surface-tint"}`}>
            {k === "tx" ? t("wallet.transactions") : t("wallet.withdrawals")}
          </button>
        ))}
      </nav>

      {tab === "tx" ? (
        <section className="flex flex-col gap-3" aria-label={t("wallet.transactions")}>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0">
            {["", "in", "out", "withdrawals", "ads"].map((g) => (
              <a key={g || "all"} href={g ? `?type=${g}` : "?"} aria-current={loaderData.filterType === g ? "page" : undefined}
                className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-bold ${loaderData.filterType === g ? "border-action bg-action text-on-action" : "border-border bg-surface text-text hover:border-action/50"}`}>
                {t(g ? `wallet.group.${g}` : "wallet.allTypes")}
              </a>
            ))}
          </div>
          {listLoading ? <ListSkeleton /> : loaderData.txs.length === 0 ? (
            <EmptyState title={t("wallet.empty")} />
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface shadow-1">
              {(loaderData.txs as WalletTx[]).map((x) => {
                const inflow = x.amount_piastres >= 0;
                return (
                  <li key={x.id} className="flex items-center gap-3 px-4 py-3">
                    <span className={`grid size-10 shrink-0 place-items-center rounded-full text-lg font-black ${inflow ? "bg-success-soft text-success" : "bg-danger-soft text-danger"}`} aria-hidden="true">
                      {inflow ? "↓" : "↑"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-extrabold text-text">{t(`tx.type_${x.type}`)}</p>
                      <p className="truncate text-xs text-text-muted">{x.reason}<TxMeta meta={x.meta} money={money} /></p>
                      <p className="num truncate text-2xs text-text-faint">
                        {day(x.created_at)}
                        {x.reference ? <> · {x.order_id ? <a href={`/${loaderData.lang}/vendor/orders?q=${(x.reference ?? "").split(":")[0]}`} className="font-bold text-action hover:underline" dir="ltr">{x.reference}</a> : <span dir="ltr">{x.reference}</span>}</> : null}
                      </p>
                    </div>
                    <span className={`num shrink-0 text-sm font-black ${inflow ? "text-success" : "text-danger"}`} dir="ltr">
                      {inflow ? "+" : "−"}{money(Math.abs(x.amount_piastres))}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : (
        <section className="flex flex-col gap-3" aria-label={t("wallet.withdrawals")}>
          {listLoading ? <ListSkeleton /> : withdrawals.length === 0 ? (
            <EmptyState title={t("wallet.noWithdrawals")} body={t("wallet.noWithdrawalsHint")} />
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface shadow-1">
              {withdrawals.map((w) => (
                <li key={w.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="num text-base font-black text-text" dir="ltr">{money(w.amount_piastres)}</p>
                    <p className="text-xs text-text-muted">{methodLabel(w.method)} · <span className="num">{day(w.created_at)}</span></p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${w.status === "approved" ? "bg-success-soft text-success" : w.status === "cancelled" ? "bg-danger-soft text-danger" : "bg-warning-soft text-text"}`}>
                    {t(`withdrawal.status_${w.status}`)}
                  </span>
                  {w.status === "pending" ? (
                    <cancelFetcher.Form method="post" preventScrollReset>
                      <input type="hidden" name="intent" value="cancel_withdrawal" />
                      <input type="hidden" name="id" value={w.id} />
                      <Button type="submit" variant="ghost" size="sm" disabled={cancelFetcher.state !== "idle"}>{t("wallet.cancelWithdrawal")}</Button>
                    </cancelFetcher.Form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* withdraw dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title={t("wallet.withdrawTitle")}>
        <withdrawFetcher.Form method="post" preventScrollReset className="flex flex-col gap-4">
          <input type="hidden" name="intent" value="withdraw" />
          <input type="hidden" name="method" value={method} />
          <div className="flex items-center justify-between rounded-xl bg-surface-tint/60 p-3 text-sm">
            <span className="text-text-muted">{t("wallet.available")}</span>
            <span className="num font-black text-text" dir="ltr">{money(available)}</span>
          </div>
          <div className="flex flex-col gap-1.5">
            <Input id="wd-amount" name="amount" type="number" inputMode="decimal" min={min / 100} step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)}
              label={t("wallet.amountLabel")} hint={t("wallet.minWarn", { min: money(min) })} inputClassName="ltr:text-left" dir="ltr" />
            <button type="button" onClick={() => setAmount(String(Math.max(0, available) / 100))} className="w-fit cursor-pointer text-xs font-extrabold text-action hover:underline">{t("wallet.withdrawAll")}</button>
          </div>
          <div role="radiogroup" aria-label={t("wallet.method")} className="grid grid-cols-3 gap-2">
            {methods.map((m) => (
              <button key={m} type="button" role="radio" aria-checked={method === m} onClick={() => setMethod(m)}
                className={`cursor-pointer rounded-xl border-2 px-2 py-3 text-xs font-extrabold ${method === m ? "border-action bg-action/5 text-action" : "border-border text-text-muted"}`}>
                {methodLabel(m)}
              </button>
            ))}
          </div>
          <Input id="wd-holder" name="holder" required label={t("wallet.holderName")} />
          <Input id="wd-account" name="account" required label={t(`wallet.accountLabel_${method}`)} inputClassName="ltr:text-left" dir="ltr" />
          {wdResult && !wdResult.ok ? (
            <p role="alert" className="rounded-md border border-danger/40 bg-danger-soft p-2.5 text-sm font-bold text-danger">
              {wdResult.reason === "insufficient" ? t("wallet.overAvailable")
                : wdResult.reason === "below_min" ? t("wallet.minWarn", { min: money(wdResult.min_piastres ?? min) })
                : wdResult.reason === "pending_exists" ? t("wallet.pendingExists")
                : t("auth.errors.generic")}
            </p>
          ) : null}
          {wdResult?.ok ? <p role="status" className="rounded-md bg-success-soft p-2.5 text-sm font-bold text-success">{t("wallet.withdrawSent")}</p> : null}
          <Button type="submit" loading={busy} block>{t("wallet.withdraw")}</Button>
        </withdrawFetcher.Form>
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
  return <SkeletonPage />;
}

/** Structured detail of a ledger row (pickup billing basis, packaging order). */
function TxMeta({ meta, money }: { meta?: WalletTx["meta"]; money: (p: number) => string }) {
  const { t } = useTranslation();
  if (!meta) return null;
  if (meta.billing_mode && meta.rate_piastres !== undefined) {
    return (
      <span className="block text-2xs text-text-faint">
        {meta.billing_mode === "per_shipment"
          ? t("pkg.txPickupShipment", { rate: money(meta.rate_piastres) })
          : t("pkg.txPickupProducts", { n: meta.units ?? 0, rate: money(meta.rate_piastres) })}
      </span>
    );
  }
  if (meta.packaging_order) return <span className="num block text-2xs text-text-faint" dir="ltr">{meta.packaging_order}</span>;
  return null;
}

import { data, useFetcher } from "react-router";
import type { Route } from "./+types/wallet";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { formatPiastres } from "~/lib/money";
import { Button } from "~/components/ui/Button";
import { Dialog } from "~/components/ui/Overlay";
import { Input } from "~/components/ui/Input";
import { EmptyState } from "~/components/ui/EmptyState";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonPage } from "~/components/ui/Skeleton";


/**
 * Vendor wallet (VO-07/08/11, VO-12/13) — bank-card style card (available /
 * pending / level progress / last 5), full transactions table with type +
 * signed amount + reason + reference (rows link into the order), withdrawal
 * dialog (min + server-side ≤ available), withdrawals list with cancel while
 * pending. Balances come from fn_vendor_wallet_view (definer); the ledger is
 * the source of truth (AGENT §7).
 */
const TX_TYPES = ["earning", "commission", "pickup_fee", "shipping_revenue", "penalty", "ad_purchase", "withdrawal", "withdrawal_refund", "refund_clawback", "admin_adjustment"] as const;

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "vendor", request);

  const { data: vendorId } = await client.rpc("own_vendor_id");
  if (!vendorId) throw new Response("Forbidden", { status: 403 });

  const [{ data: view }, txRes, wdRes] = await Promise.all([
    client.rpc("fn_vendor_wallet_view"),
    client.from("wallet_transactions").select("id, type, amount_piastres, reference, reason, order_id, created_at").order("created_at", { ascending: false }).limit(100),
    client.from("withdrawal_requests").select("id, amount_piastres, method, status, cancel_reason, created_at, reviewed_at").order("created_at", { ascending: false }).limit(30),
  ]);
  if (view.error) throw new Error(view.error.message);

  const url = new URL(request.url);
  const type = url.searchParams.get("type") ?? "";
  let txs = (txRes.data ?? []) as WalletTx[];
  if (type) txs = txs.filter((x) => x.type === type);

  // reasons live in wallet rows; the negative-balance explainer picks the
  // latest debit (US-06 edge)
  const lastDebit = txs.find((x) => x.amount_piastres < 0) ?? null;

  return {
    lang,
    view: JSON.parse(JSON.stringify(view ?? {})),
    txs: JSON.parse(JSON.stringify(txs)),
    withdrawals: JSON.parse(JSON.stringify(wdRes.data ?? [])),
    filterType: type,
    lastDebit: lastDebit ? JSON.parse(JSON.stringify(lastDebit)) : null,
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
    const amount = Math.trunc(Number(form.get("amount") ?? 0));
    const method = String(form.get("method") ?? "");
    const details = {
      account: String(form.get("account") ?? "").slice(0, 120),
      holder: String(form.get("holder") ?? "").slice(0, 120),
    };
    if (!Number.isFinite(amount) || amount <= 0) return data({ ok: false, reason: "bad_amount" }, { status: 400 });
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
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const money = (p: number) => formatPiastres(p, en ? "en" : "ar");
  const view = loaderData.view as WalletView;
  const [dialogOpen, setDialogOpen] = useState(false);
  const withdrawFetcher = useFetcher<typeof action>();
  const cancelFetcher = useFetcher<typeof action>();
  const busy = withdrawFetcher.state !== "idle";

  const available = view.wallet?.available_piastres ?? 0;
  const pending = view.wallet?.pending_piastres ?? 0;
  const level = view.level;
  const min = 5000; // client mirror; the server enforces the live setting
  const wdResult = withdrawFetcher.data as { ok: boolean; reason?: string; min_piastres?: number } | undefined;

  const progessPct = level?.next_min_orders
    ? Math.min(100, Math.round((view.successful_orders / level.next_min_orders) * 100))
    : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-text">{t("wallet.title")}</h1>
          <p className="mt-1 text-xs text-text-muted">
            {en
              ? "Your store balance, payout requests, transaction ledger, and level tier progress."
              : "رصيد متجرك المتاح، طلبات سحب الأرباح، سجل المعاملات المالية، ومستوى التاجر."}
          </p>
        </div>
        <Button type="button" size="md" onClick={() => setDialogOpen(true)}>{t("wallet.withdraw")}</Button>
      </div>

      {/* VO-07 bank-card style wallet card (flat tokens, no gradients) */}
      <section className="rounded-lg bg-ink p-6 text-white shadow-xl relative overflow-hidden" aria-label={t("wallet.title")}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
          <p className="text-xs font-bold text-white/70">{t("wallet.available")}</p>
          {level ? (
            <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-bold text-white">
              {en ? level.name_en : level.name_ar}
            </span>
          ) : null}
        </div>

        <p className="mt-3 text-3xl font-black tabular-nums tracking-tight">{money(available)}</p>

        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-white/80">
          <span>
            <span className="opacity-70">{t("wallet.pending")}: </span>
            <span className="font-bold tabular-nums text-white">{money(pending)}</span>
          </span>
          {level ? (
            <span className="opacity-70">{t("wallet.holdDays", { days: level.hold_days })}</span>
          ) : null}
        </div>

        {level?.next_min_orders ? (
          <div className="mt-4 border-t border-white/10 pt-3">
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/20" role="progressbar" aria-valuenow={progessPct ?? 0} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${progessPct}%` }} />
            </div>
            <p className="mt-2 text-xs text-white/75">
              {t("wallet.progress", { done: view.successful_orders, next: level.next_min_orders })} · {t("wallet.nextLevel")}: {level.next_name_en && en ? level.next_name_en : ""}
            </p>
          </div>
        ) : null}
      </section>

      {/* US-06 edge: negative balance explained by its cause, not a generic warning */}
      {available < 0 && loaderData.lastDebit ? (
        <p role="status" className="mt-2 rounded-md border border-danger/40 bg-danger-soft p-3 text-sm text-danger">
          {t("wallet.negative")}: {t(`tx.type_${loaderData.lastDebit.type}`)} {money(loaderData.lastDebit.amount_piastres)} — {loaderData.lastDebit.reason}
        </p>
      ) : null}

      {/* VO-12/13 withdrawals list */}
      <section className="mt-5" aria-label={t("wallet.withdrawals")}>
        <h2 className="text-sm font-extrabold text-text">{t("wallet.withdrawals")}</h2>
        {loaderData.withdrawals.length === 0 ? (
          <p className="mt-2 text-sm text-text-muted">{t("wallet.empty")}</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {loaderData.withdrawals.map((w: Withdrawal) => (
              <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface p-3 text-sm">
                <span className="font-bold tabular-nums text-text">{money(w.amount_piastres)}</span>
                <span className="text-text-muted">{t(`wallet.method${w.method.charAt(0).toUpperCase()}${w.method.slice(1)}`)}</span>
                <span className={`rounded-md px-2 py-0.5 text-xs font-bold ${w.status === "approved" ? "bg-surface-tint text-primary" : w.status === "cancelled" ? "bg-surface-tint text-danger" : "bg-surface-tint text-text"}`}>
                  {t(`withdrawal.status_${w.status}`)}
                </span>
                <span className="num text-xs text-text-muted">{new Date(w.created_at).toLocaleDateString(en ? "en-EG" : "ar-EG")}</span>
                {w.status === "pending" ? (
                  <cancelFetcher.Form method="post" preventScrollReset>
                    <input type="hidden" name="intent" value="cancel_withdrawal" />
                    <input type="hidden" name="id" value={w.id} />
                    <Button type="submit" variant="ghost" size="sm" disabled={cancelFetcher.state !== "idle"}>
                      {t("wallet.cancelWithdrawal")}
                    </Button>
                  </cancelFetcher.Form>
                ) : (
                  <span className="text-xs text-text-muted">{w.status === "approved" ? t("wallet.approvedNote") : t("wallet.cancelledNote")}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* VO-08 transactions (table ≥768 cards at 390 via grid) */}
      <section className="mt-5" aria-label={t("wallet.transactions")}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-extrabold text-text">{t("wallet.transactions")}</h2>
          <select
            value={loaderData.filterType}
            onChange={(e) => {
              const next = new URLSearchParams();
              if (e.target.value) next.set("type", e.target.value);
              window.location.search = next.toString();
            }}
            aria-label={t("wallet.type")}
            className="rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-text"
          >
            <option value="">{t("wallet.allTypes")}</option>
            {TX_TYPES.map((ty) => (
              <option key={ty} value={ty}>{t(`tx.type_${ty}`)}</option>
            ))}
          </select>
        </div>
        {loaderData.txs.length === 0 ? (
          <EmptyState title={t("wallet.empty")} body={t("report.netHint")} />
        ) : (
          <>
            {/* desktop table */}
            <div className="mt-2 hidden overflow-x-auto md:block">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-start text-xs text-text-muted">
                    <th className="p-2 text-start font-bold">{t("wallet.type")}</th>
                    <th className="p-2 text-start font-bold">{t("wallet.amount")}</th>
                    <th className="p-2 text-start font-bold">{t("wallet.reason")}</th>
                    <th className="p-2 text-start font-bold">{t("wallet.reference")}</th>
                    <th className="p-2 text-start font-bold">{t("wallet.date")}</th>
                  </tr>
                </thead>
                <tbody>
                  {loaderData.txs.map((x: WalletTx) => (
                    <tr key={x.id} className="border-b border-border">
                      <td className="p-2 font-bold text-text">{t(`tx.type_${x.type}`)}</td>
                      <td className={`p-2 tabular-nums font-bold ${x.amount_piastres < 0 ? "text-danger" : "text-primary"}`} dir="ltr">
                        {x.amount_piastres < 0 ? "−" : "+"}{money(Math.abs(x.amount_piastres))}
                      </td>
                      <td className="p-2 text-text-muted">{x.reason}</td>
                      <td className="p-2 text-text-muted" dir="ltr">
                        {x.order_id && x.reference ? (
                          <a href={`/${loaderData.lang}/vendor/orders?q=${(x.reference ?? "").split(":")[0]}`} className="font-bold text-action hover:underline">{x.reference}</a>
                        ) : (x.reference ?? "—")}
                      </td>
                      <td className="p-2 text-xs text-text-muted num">{new Date(x.created_at).toLocaleString(en ? "en-EG" : "ar-EG")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* mobile cards (VO-16) */}
            <ul className="mt-2 flex flex-col gap-2 md:hidden">
              {loaderData.txs.map((x: WalletTx) => (
                <li key={x.id} className="rounded-md border border-border bg-surface p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-text">{t(`tx.type_${x.type}`)}</span>
                    <span className={`tabular-nums font-bold ${x.amount_piastres < 0 ? "text-danger" : "text-primary"}`} dir="ltr">
                      {x.amount_piastres < 0 ? "−" : "+"}{money(Math.abs(x.amount_piastres))}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-text-muted">{x.reason}</p>
                  <p className="mt-1 flex justify-between text-xs text-text-muted">
                    <span dir="ltr">{x.reference ?? "—"}</span>
                    <span className="num">{new Date(x.created_at).toLocaleDateString(en ? "en-EG" : "ar-EG")}</span>
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {/* VO-12 withdraw dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title={t("wallet.withdrawTitle")}>
        <withdrawFetcher.Form method="post" preventScrollReset className="flex flex-col gap-3 p-1">
          <input type="hidden" name="intent" value="withdraw" />
          <Input id="wd-amount" name="amount" type="number" inputMode="numeric" min={min} step={1} required
            label={t("wallet.amountLabel")} hint={t("wallet.minWarn", { min: money(min) })} inputClassName="ltr:text-left" />
          <div>
            <label htmlFor="wd-method" className="mb-1 block text-sm font-bold text-text">{t("wallet.method")}</label>
            <select id="wd-method" name="method" required defaultValue="bank"
              className="w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-text">
              <option value="bank">{t("wallet.methodBank")}</option>
              <option value="instapay">{t("wallet.methodInstapay")}</option>
              <option value="wallet">{t("wallet.methodWallet")}</option>
            </select>
          </div>
          <Input id="wd-holder" name="holder" required label={t("wallet.details")} />
          <Input id="wd-account" name="account" required label={t("wallet.details")} inputClassName="ltr:text-left" />
          {wdResult && !wdResult.ok ? (
            <p role="alert" className="rounded-md border border-danger/40 bg-danger-soft p-2.5 text-sm font-bold text-danger">
              {wdResult.reason === "insufficient" ? t("wallet.overAvailable")
                : wdResult.reason === "below_min" ? t("wallet.minWarn", { min: money(wdResult.min_piastres ?? min) })
                : wdResult.reason === "pending_exists" ? t("wallet.pendingExists")
                : t("auth.errors.generic")}
            </p>
          ) : null}
          {wdResult?.ok ? (
            <p role="status" className="text-sm font-bold text-primary">{t("wallet.withdrawSent")}</p>
          ) : null}
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

import { data, useFetcher } from "react-router";
import type { Route } from "./+types/customer-wallets_.$id";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { egpToPiastres, formatPiastres, signedEgpToPiastres } from "~/lib/money";
import { Button } from "~/components/ui/Button";
import { Input } from "~/components/ui/Input";
import { Dialog } from "~/components/ui/Overlay";
import { Badge } from "~/components/ui/Badge";
import { EmptyState } from "~/components/ui/EmptyState";
import { SkeletonPage } from "~/components/ui/Skeleton";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { useActionToast } from "~/components/layout/ActionFeedback";
import { SYSTEM_REASONS, nearestExpiry, walletAvailable } from "~/features/wallet/split";

/**
 * Admin → Customer wallets → one customer (Phase A): balances, gift lots and
 * the ledger, plus three money actions — adjust (refund bucket), grant a gift
 * with a required expiry date, and cancel the rest of a gift. Every action is
 * a definer RPC that locks, audits and notifies.
 */

interface GiftLot {
  id: string;
  amount_piastres: number;
  remaining_piastres: number;
  expires_at: string;
  reason: string;
  status: string;
}
interface WalletTx {
  id: string;
  bucket: string;
  type: string;
  amount_piastres: number;
  reference: string | null;
  reason: string | null;
  order_number: string | null;
  created_at: string;
}

async function loadWallet(client: ReturnType<typeof createSupabaseServerClient>["client"], id: string) {
  if (!client) throw data({ reason: "db" }, { status: 503 });
  const { data: res, error } = await client.rpc("fn_admin_customer_wallet", { p_user: id });
  if (error) throw new Error(error.message);
  const r = (res ?? {}) as {
    ok?: boolean;
    user?: { id: string; full_name: string; phone: string | null; email: string | null };
    refund_piastres?: number;
    gift_piastres?: number;
    gifts?: GiftLot[];
    transactions?: WalletTx[];
  };
  if (r.ok === false) throw new Response("Not found", { status: 404 });
  return r;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  await requirePanelAccess(client!, lang, "admin", request);
  const r = await loadWallet(client, params.id ?? "");
  return {
    lang,
    id: params.id ?? "",
    user: r.user ?? { id: params.id ?? "", full_name: "", phone: null, email: null },
    refund: Number(r.refund_piastres ?? 0),
    gift: Number(r.gift_piastres ?? 0),
    gifts: (r.gifts ?? []) as GiftLot[],
    txs: (r.transactions ?? []) as WalletTx[],
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const userId = params.id ?? "";

  // one id per opened form: a retried submit is applied once
  const opRaw = String(form.get("op") ?? "");
  const op = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(opRaw) ? opRaw : null;

  if (intent === "adjust") {
    // signed: a positive amount credits, a negative one debits
    const amount = signedEgpToPiastres(form.get("amount"));
    if (amount == null || amount === 0) return data({ ok: false, reason: "bad_amount" }, { status: 400 });
    const res = await client.rpc("fn_admin_wallet_adjust", {
      p_user: userId, p_amount: amount, p_reason: String(form.get("reason") ?? ""), p_op: op,
    });
    if (res.error) return data({ ok: false, reason: res.error.message }, { status: 500 });
    const r = res.data as { ok: boolean; reason?: string };
    return r.ok ? { ok: true as const } : data({ ok: false, reason: r.reason }, { status: 400 });
  }

  if (intent === "gift") {
    const amount = egpToPiastres(form.get("amount"));
    if (amount == null || amount <= 0) return data({ ok: false, reason: "bad_amount" }, { status: 400 });
    const date = String(form.get("expires_on") ?? "").trim();
    // the admin picks a day; the lot runs to the end of that day (Cairo time)
    const expiresAt = date ? new Date(`${date}T23:59:59+02:00`).toISOString() : null;
    if (!expiresAt) return data({ ok: false, reason: "bad_expiry" }, { status: 400 });
    const res = await client.rpc("fn_admin_wallet_gift", {
      p_user: userId, p_amount: amount, p_expires_at: expiresAt,
      p_reason: String(form.get("reason") ?? ""), p_op: op,
    });
    if (res.error) return data({ ok: false, reason: res.error.message }, { status: 500 });
    const r = res.data as { ok: boolean; reason?: string };
    return r.ok ? { ok: true as const } : data({ ok: false, reason: r.reason }, { status: 400 });
  }

  if (intent === "cancel_gift") {
    const res = await client.rpc("fn_admin_wallet_gift_cancel", {
      p_gift_id: String(form.get("gift_id") ?? ""), p_reason: String(form.get("reason") ?? ""),
    });
    if (res.error) return data({ ok: false, reason: res.error.message }, { status: 500 });
    const r = res.data as { ok: boolean; reason?: string };
    return r.ok ? { ok: true as const } : data({ ok: false, reason: r.reason }, { status: 400 });
  }

  return data({ ok: false, reason: "bad_intent" }, { status: 400 });
}

export default function AdminCustomerWallet({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const money = (p: number) => formatPiastres(p, en ? "en" : "ar");
  const day = (v: string) =>
    new Date(v).toLocaleDateString(en ? "en-GB" : "ar-EG-u-nu-latn", { day: "numeric", month: "short", year: "numeric" });
  const lang = loaderData.lang;
  const fetcher = useFetcher<typeof action>();
  useActionToast(fetcher);
  const busy = fetcher.state !== "idle";
  const [dialog, setDialog] = useState<null | "adjust" | "gift" | "cancel">(null);
  const [cancelGift, setCancelGift] = useState<GiftLot | null>(null);
  const [op, setOp] = useState("");
  const openForm = (d: "adjust" | "gift") => { setOp(crypto.randomUUID()); setDialog(d); };
  const total = walletAvailable({ refund_piastres: loaderData.refund, gift_piastres: loaderData.gift });
  const next = nearestExpiry(loaderData.gifts);
  const activeGifts = loaderData.gifts.filter((g) => g.status === "active");

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-text">{loaderData.user.full_name || t("cw.title")}</h1>
          <p className="text-xs text-text-muted" dir="ltr">{loaderData.user.phone || loaderData.user.email || "—"}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => openForm("adjust")}>{t("cw.adjustTitle")}</Button>
          <Button size="sm" variant="outline" onClick={() => openForm("gift")}>{t("cw.giftTitle")}</Button>
        </div>
      </div>

      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border border-t-[3px] border-t-action bg-surface p-4 shadow-1">
          <dt className="text-xs font-bold text-text-muted">{t("cw.totalAvailable")}</dt>
          <dd className="num mt-1 text-xl font-black text-action" dir="ltr">{money(total)}</dd>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4 shadow-1">
          <dt className="text-xs font-bold text-text-muted">{t("cw.refundBalance")}</dt>
          <dd className="num mt-1 text-xl font-black text-text" dir="ltr">{money(loaderData.refund)}</dd>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4 shadow-1">
          <dt className="text-xs font-bold text-text-muted">{t("cw.giftBalance")}</dt>
          <dd className="num mt-1 text-xl font-black text-text" dir="ltr">{money(loaderData.gift)}</dd>
          {next ? <dd className="mt-0.5 text-2xs text-text-faint">{t("cw.expiresOn", { date: day(next) })}</dd> : null}
        </div>
      </dl>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-extrabold text-text">{t("cw.gifts")}</h2>
        {loaderData.gifts.length === 0 ? (
          <EmptyState title={t("cw.noGifts")} body={t("cw.noGiftsHint")} />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface shadow-1">
            {loaderData.gifts.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="num font-black text-text" dir="ltr">{money(g.remaining_piastres)} / {money(g.amount_piastres)}</p>
                  <p className="truncate text-xs text-text-muted">{g.reason}</p>
                </div>
                <span className="text-xs text-text-muted">{t(g.status === "active" ? "cw.expiresOn" : "cw.expiredOn", { date: day(g.expires_at) })}</span>
                <Badge tone={g.status === "active" ? "success" : g.status === "used" ? "neutral" : "warning"}>
                  {t(`cw.giftStatus_${g.status}`)}
                </Badge>
                {g.status === "active" && g.remaining_piastres > 0 ? (
                  <Button size="sm" variant="ghost" onClick={() => { setCancelGift(g); setDialog("cancel"); }}>
                    {t("cw.cancelGift")}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-extrabold text-text">{t("cw.transactions")}</h2>
        {loaderData.txs.length === 0 ? (
          <EmptyState title={t("cw.emptyLedger")} body={t("cw.emptyHint")} />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-surface shadow-1">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-start text-xs text-text-muted">
                  <th className="p-3 text-start">{t("cw.date")}</th>
                  <th className="p-3 text-start">{t("cw.description")}</th>
                  <th className="p-3 text-start">{t("cw.order")}</th>
                  <th className="p-3 text-end">{t("cw.amount")}</th>
                </tr>
              </thead>
              <tbody>
                {loaderData.txs.map((x) => {
                  const credit = x.amount_piastres >= 0;
                  return (
                    <tr key={x.id} className="border-b border-border/60 last:border-0">
                      <td className="p-3 text-xs text-text-muted" dir="ltr">{day(x.created_at)}</td>
                      <td className="p-3">
                        <span className="font-bold text-text">{t(`cw.tx_${x.type}`)}</span>
                        {x.reason && !SYSTEM_REASONS.has(x.reason) ? <span className="block text-xs text-text-muted">{x.reason}</span> : null}
                      </td>
                      <td className="p-3">
                        {x.order_number ? (
                          <a href={`/${lang}/admin/orders/${encodeURIComponent(x.order_number)}`} className="num font-bold text-action hover:underline" dir="ltr">{x.order_number}</a>
                        ) : "—"}
                      </td>
                      <td className={`num p-3 text-end font-black ${credit ? "text-success" : "text-danger"}`} dir="ltr">
                        {credit ? "+" : "−"}{money(Math.abs(x.amount_piastres))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* adjust the refund balance */}
      <Dialog open={dialog === "adjust"} onClose={() => setDialog(null)} title={t("cw.adjustTitle")}>
        <fetcher.Form method="post" className="flex flex-col gap-3" onSubmit={() => setDialog(null)}>
          <input type="hidden" name="intent" value="adjust" />
          <input type="hidden" name="op" value={op} />
          <p className="text-xs text-text-muted">{t("cw.adjustHint")}</p>
          <Input id="cw-amount" name="amount" required label={t("cw.amount")} dir="ltr" inputClassName="ltr:text-left" hint={t("cw.adjustSignHint")} />
          <div className="flex flex-col gap-1">
            <label htmlFor="cw-adjust-reason" className="text-sm font-bold text-text">{t("cw.reason")}</label>
            <textarea id="cw-adjust-reason" name="reason" required rows={3} className="rounded-md border border-border bg-surface p-2 text-sm text-text" />
          </div>
          <Button type="submit" loading={busy} block>{t("common.save")}</Button>
        </fetcher.Form>
      </Dialog>

      {/* grant a gift with its own expiry */}
      <Dialog open={dialog === "gift"} onClose={() => setDialog(null)} title={t("cw.giftTitle")}>
        <fetcher.Form method="post" className="flex flex-col gap-3" onSubmit={() => setDialog(null)}>
          <input type="hidden" name="intent" value="gift" />
          <input type="hidden" name="op" value={op} />
          <p className="text-xs text-text-muted">{t("cw.giftFirst")}</p>
          <Input id="cw-gift-amount" name="amount" required label={t("cw.amount")} dir="ltr" inputClassName="ltr:text-left" />
          <div className="flex flex-col gap-1">
            <label htmlFor="cw-gift-expiry" className="text-sm font-bold text-text">{t("cw.expiryDate")}</label>
            <input id="cw-gift-expiry" name="expires_on" type="date" required dir="ltr"
              className="rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-text" />
            <span className="text-xs text-text-muted">{t("cw.expiryHint")}</span>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="cw-gift-reason" className="text-sm font-bold text-text">{t("cw.reason")}</label>
            <textarea id="cw-gift-reason" name="reason" required rows={3} className="rounded-md border border-border bg-surface p-2 text-sm text-text" />
          </div>
          <Button type="submit" loading={busy} block>{t("cw.grantGift")}</Button>
        </fetcher.Form>
      </Dialog>

      {/* cancel what is left of a gift */}
      <Dialog open={dialog === "cancel" && cancelGift !== null} onClose={() => setDialog(null)} title={t("cw.cancelGift")}>
        {cancelGift ? (
          <fetcher.Form method="post" className="flex flex-col gap-3" onSubmit={() => setDialog(null)}>
            <input type="hidden" name="intent" value="cancel_gift" />
            <input type="hidden" name="gift_id" value={cancelGift.id} />
            <p className="text-sm text-text">
              {t("cw.cancelGiftHint", { amount: money(cancelGift.remaining_piastres), date: day(cancelGift.expires_at) })}
            </p>
            <div className="flex flex-col gap-1">
              <label htmlFor="cw-cancel-reason" className="text-sm font-bold text-text">{t("cw.reason")}</label>
              <textarea id="cw-cancel-reason" name="reason" required rows={3} className="rounded-md border border-border bg-surface p-2 text-sm text-text" />
            </div>
            <Button type="submit" variant="outline" loading={busy} block>{t("cw.cancelGift")}</Button>
          </fetcher.Form>
        ) : null}
      </Dialog>

      {fetcher.data && !fetcher.data.ok ? (
        <p role="alert" className="text-xs font-bold text-danger">{String(fetcher.data.reason)}</p>
      ) : null}
      <p className="text-2xs text-text-faint">
        {activeGifts.length > 0 ? t("cw.activeGifts", { count: activeGifts.length }) : null}
      </p>
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

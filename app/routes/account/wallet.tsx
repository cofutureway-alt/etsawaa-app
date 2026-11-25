import { data } from "react-router";
import type { Route } from "./+types/wallet";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { formatPiastres } from "~/lib/money";
import { EmptyState } from "~/components/ui/EmptyState";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonPage } from "~/components/ui/Skeleton";
import { nearestExpiry, walletAvailable } from "~/features/wallet/split";

/**
 * Customer wallet (Phase A): refund balance (own money, never expires) and
 * gift balance (admin grants, each with its own expiry). Readings come from
 * fn_my_wallet (definer); the ledger is the source of truth. There is no
 * withdrawal — the balance is spent at checkout only.
 */

interface WalletTx {
  id: string;
  bucket: "refund" | "gift";
  type: string;
  amount_piastres: number;
  reference: string | null;
  reason: string | null;
  order_id: string | null;
  order_number: string | null;
  created_at: string;
}
interface GiftLot {
  id: string;
  amount_piastres: number;
  remaining_piastres: number;
  expires_at: string;
  reason: string;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "account", request);
  const { data: wallet, error } = await client.rpc("fn_my_wallet");
  if (error) throw new Error(error.message);
  const w = (wallet ?? {}) as {
    refund_piastres?: number; gift_piastres?: number;
    gifts?: GiftLot[]; transactions?: WalletTx[];
  };
  return {
    lang,
    refund: Number(w.refund_piastres ?? 0),
    gift: Number(w.gift_piastres ?? 0),
    gifts: (w.gifts ?? []) as GiftLot[],
    txs: (w.transactions ?? []) as WalletTx[],
  };
}

export default function CustomerWallet({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const money = (p: number) => formatPiastres(p, en ? "en" : "ar");
  const day = (v: string) =>
    new Date(v).toLocaleDateString(en ? "en-GB" : "ar-EG-u-nu-latn", { day: "numeric", month: "short", year: "numeric" });
  const lang = loaderData.lang;
  const total = walletAvailable({ refund_piastres: loaderData.refund, gift_piastres: loaderData.gift });
  const nextExpiry = nearestExpiry(loaderData.gifts);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-black text-text">{t("cw.customerTitle")}</h1>
        <p className="mt-1 text-sm text-text-muted">{t("cw.customerSubtitle")}</p>
        <p className="mt-1 text-xs text-text-faint">{t("cw.noWithdrawal")}</p>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label={t("cw.customerTitle")}>
        <div className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-5 shadow-1">
          <p className="text-sm font-bold text-text-muted">{t("cw.refundBalance")}</p>
          <p className="num text-2xl font-black text-text" dir="ltr">{money(loaderData.refund)}</p>
          <p className="text-xs text-text-muted">{t("cw.refundHint")}</p>
        </div>
        <div className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-5 shadow-1">
          <p className="text-sm font-bold text-text-muted">{t("cw.giftBalance")}</p>
          <p className="num text-2xl font-black text-action" dir="ltr">{money(loaderData.gift)}</p>
          <p className="text-xs text-text-muted">
            {nextExpiry ? t("cw.giftExpiresOn", { date: day(nextExpiry) }) : t("cw.giftHint")}
          </p>
        </div>
        <div className="flex flex-col gap-2 rounded-2xl border border-border bg-action/5 p-5 shadow-1">
          <p className="text-sm font-bold text-text-muted">{t("cw.totalAvailable")}</p>
          <p className="num text-2xl font-black text-text" dir="ltr">{money(total)}</p>
          <a href={`/${lang}/cart`} className="text-xs font-extrabold text-action hover:underline">{t("cw.spendHint")}</a>
        </div>
      </section>

      <section className="flex flex-col gap-3" aria-label={t("cw.gifts")}>
        <h2 className="text-sm font-extrabold text-text">{t("cw.gifts")}</h2>
        {loaderData.gifts.length === 0 ? (
          <EmptyState title={t("cw.noGifts")} body={t("cw.noGiftsHint")} />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface shadow-1">
            {loaderData.gifts.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div className="min-w-0">
                  <p className="num text-sm font-black text-text" dir="ltr">{money(g.remaining_piastres)}</p>
                  <p className="truncate text-xs text-text-muted">{g.reason}</p>
                </div>
                <span className="rounded-full bg-warning-soft px-2.5 py-1 text-xs font-bold text-text">
                  {t("cw.expiresOn", { date: day(g.expires_at) })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-label={t("cw.transactions")}>
        <h2 className="text-sm font-extrabold text-text">{t("cw.transactions")}</h2>
        {loaderData.txs.length === 0 ? (
          <EmptyState title={t("cw.emptyLedger")} body={t("cw.emptyHint")} />
        ) : (
          <>
            {/* table on wide screens, cards below (design skill: table→card) */}
            <div className="hidden overflow-x-auto rounded-2xl border border-border bg-surface shadow-1 md:block">
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
                          {x.reason ? <span className="block text-xs text-text-muted">{x.reason}</span> : null}
                          <span className="block text-2xs text-text-faint">{t(x.bucket === "gift" ? "cw.giftBalance" : "cw.refundBalance")}</span>
                        </td>
                        <td className="p-3">
                          {x.order_number ? (
                            <a href={`/${lang}/account/orders/${encodeURIComponent(x.order_number)}`} className="num font-bold text-action hover:underline" dir="ltr">
                              {x.order_number}
                            </a>
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
            <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface shadow-1 md:hidden">
              {loaderData.txs.map((x) => {
                const credit = x.amount_piastres >= 0;
                return (
                  <li key={x.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-extrabold text-text">{t(`cw.tx_${x.type}`)}</p>
                      <p className="truncate text-xs text-text-muted">{x.reason || (x.bucket === "gift" ? t("cw.giftBalance") : t("cw.refundBalance"))}</p>
                      <p className="num truncate text-2xs text-text-faint">
                        {day(x.created_at)}
                        {x.order_number ? <> · <span dir="ltr">{x.order_number}</span></> : null}
                      </p>
                    </div>
                    <span className={`num shrink-0 text-sm font-black ${credit ? "text-success" : "text-danger"}`} dir="ltr">
                      {credit ? "+" : "−"}{money(Math.abs(x.amount_piastres))}
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
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

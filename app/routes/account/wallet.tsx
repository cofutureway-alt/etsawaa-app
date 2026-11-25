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
import type { ReactNode } from "react";
import { nearestExpiry, walletAvailable } from "~/features/wallet/split";
import { Tabs } from "~/components/ui/Tabs";
import { CartIcon, ClockIcon, GiftIcon, HistoryIcon, InfoIcon, WalletIcon } from "~/components/ui/icons";

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
/** Reasons the database writes for automatic movements: not for the customer to read. */
const SYSTEM_REASONS = new Set(["order_payment", "order_cancelled", "order_cancelled_admin", "expired", "refund"]);

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

  const balancePanel = (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <BalanceCard
          tone="refund"
          icon={<WalletIcon aria-hidden="true" className="size-5" />}
          label={t("cw.refundBalance")}
          amount={money(loaderData.refund)}
          foot={t("cw.refundHint")}
        />
        <BalanceCard
          tone="gift"
          icon={<GiftIcon aria-hidden="true" className="size-5" />}
          label={t("cw.giftBalance")}
          amount={money(loaderData.gift)}
          foot={nextExpiry ? t("cw.cardExpiry", { date: day(nextExpiry) }) : ""}
        />
      </div>
      <p className="flex items-start gap-1.5 text-xs text-text-muted">
        <InfoIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        {t("cw.noWithdrawal")}
      </p>
    </div>
  );

  const giftsPanel = loaderData.gifts.length === 0 ? (
    <EmptyState title={t("cw.noGifts")} body={t("cw.noGiftsHint")} />
  ) : (
    <ul className="flex flex-col gap-2.5">
      {loaderData.gifts.map((g) => (
        <li key={g.id} className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3.5 shadow-1">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-action/10 text-action">
            <GiftIcon aria-hidden="true" className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="num text-base font-black text-text" dir="ltr">{money(g.remaining_piastres)}</p>
            <p className="truncate text-xs text-text-muted">{g.reason}</p>
          </div>
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-warning-soft px-2.5 py-1 text-xs font-bold text-text">
            <ClockIcon aria-hidden="true" className="size-3.5" />
            {day(g.expires_at)}
          </span>
        </li>
      ))}
    </ul>
  );

  const movementsPanel = loaderData.txs.length === 0 ? (
    <EmptyState title={t("cw.emptyLedger")} body={t("cw.emptyHint")} />
  ) : (
    <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface shadow-1">
      {loaderData.txs.map((x) => {
        const credit = x.amount_piastres >= 0;
        const Mark = x.bucket === "gift" ? GiftIcon : WalletIcon;
        return (
          <li key={x.id} className="flex items-center gap-3 px-4 py-3">
            <span className={`grid size-9 shrink-0 place-items-center rounded-full ${credit ? "bg-success/10 text-success" : "bg-danger/10 text-danger"}`}>
              <Mark aria-hidden="true" className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-extrabold text-text">{t(`cw.tx_${x.type}`)}</p>
              <p className="truncate text-xs text-text-muted">
                {x.reason && !SYSTEM_REASONS.has(x.reason) ? x.reason : t(x.bucket === "gift" ? "cw.giftBalance" : "cw.refundBalance")}
              </p>
              <p className="num truncate text-2xs text-text-faint">
                {day(x.created_at)}
                {x.order_number ? (
                  <> · <a href={`/${lang}/account/orders/${encodeURIComponent(x.order_number)}`} className="font-bold text-action hover:underline" dir="ltr">{x.order_number}</a></>
                ) : null}
              </p>
            </div>
            <span className={`num shrink-0 text-sm font-black ${credit ? "text-success" : "text-danger"}`} dir="ltr">
              {credit ? "+" : "−"}{money(Math.abs(x.amount_piastres))}
            </span>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-text">{t("cw.customerTitle")}</h1>
          <p className="mt-1 text-sm text-text-muted">{t("cw.totalLead")}</p>
          <p className="num mt-0.5 text-3xl font-black text-text" dir="ltr">{money(total)}</p>
        </div>
        <a href={`/${lang}/cart`} className="inline-flex min-h-10 items-center gap-1.5 rounded-md bg-action px-4 text-sm font-extrabold text-on-action hover:bg-action-hover">
          <CartIcon aria-hidden="true" className="size-4" />
          {t("cw.spendHint")}
        </a>
      </div>

      <Tabs
        items={[
          { id: "balance", label: <TabLabel icon={<WalletIcon aria-hidden="true" className="size-4" />} text={t("cw.tabBalance")} />, content: balancePanel },
          { id: "gifts", label: <TabLabel icon={<GiftIcon aria-hidden="true" className="size-4" />} text={t("cw.tabGifts")} count={loaderData.gifts.length} />, content: giftsPanel },
          { id: "movements", label: <TabLabel icon={<HistoryIcon aria-hidden="true" className="size-4" />} text={t("cw.tabMovements")} />, content: movementsPanel },
        ]}
      />
    </div>
  );
}

function TabLabel({ icon, text, count }: { icon: ReactNode; text: string; count?: number }) {
  return (
    <span className="flex items-center gap-1.5">
      {icon}
      <span>{text}</span>
      {count ? <span className="num rounded-full bg-action px-1.5 text-2xs font-black leading-5 text-on-action">{count}</span> : null}
    </span>
  );
}

/**
 * A balance shown as a payment card. The gradients are fixed brand colours,
 * so the card reads the same in light and dark mode: a chip, the store mark,
 * the amount, and one line at the bottom (no expiry / nearest expiry).
 */
function BalanceCard({ tone, icon, label, amount, foot }: {
  tone: "refund" | "gift"; icon: ReactNode; label: string; amount: string; foot: string;
}) {
  const bg = tone === "refund"
    ? "linear-gradient(135deg, #1b1f2a 0%, #3a1216 55%, #b3121b 100%)"
    : "linear-gradient(135deg, #b3121b 0%, #e2452f 50%, #f2a33a 100%)";
  return (
    <div
      className="relative isolate flex aspect-[1.586/1] w-full flex-col justify-between overflow-hidden rounded-2xl p-5 text-white shadow-lg"
      style={{ backgroundImage: bg }}
    >
      <span aria-hidden="true" className="pointer-events-none absolute -end-12 -top-16 -z-10 size-48 rounded-full bg-white/10" />
      <span aria-hidden="true" className="pointer-events-none absolute -bottom-20 -start-10 -z-10 size-56 rounded-full bg-black/10" />
      <div className="flex items-start justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-extrabold">
          <span className="grid size-9 place-items-center rounded-xl bg-white/15">{icon}</span>
          {label}
        </span>
        <span className="text-xs font-black tracking-widest opacity-80" dir="ltr">ETSAWAA</span>
      </div>
      <span aria-hidden="true" className="h-7 w-10 rounded-md bg-gradient-to-br from-amber-200 to-amber-400 opacity-90 shadow-inner" />
      <div>
        <p className="num text-3xl font-black leading-tight" dir="ltr">{amount}</p>
        <p className="mt-1 min-h-4 text-xs font-bold opacity-85">{foot}</p>
      </div>
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

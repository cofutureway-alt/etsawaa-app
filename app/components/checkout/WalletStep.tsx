import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatMoney } from "~/components/checkout/money";
import { Button } from "~/components/ui/Button";
import { nearestExpiry, walletAvailable, walletCap, walletRemainder } from "~/features/wallet/split";
import type { WalletSnapshot } from "~/features/checkout/checkout.server";

/**
 * "Use wallet balance" block (owner decision, Phase A). Rendered only when the
 * balance is above zero. The customer may take the whole balance or a smaller
 * part; the totals below update live and fn_create_order re-caps server-side.
 */
export function WalletStep({
  wallet,
  total,
  amount,
  onAmount,
}: {
  wallet: WalletSnapshot;
  /** the order total the wallet can be applied to */
  total: number;
  /** piastres the customer chose to take from the wallet */
  amount: number;
  onAmount: (value: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const money = (p: number) => formatMoney(i18n.language, p);
  const available = walletAvailable(wallet);
  // what the field shows while typing; the buttons set it from outside
  const [text, setText] = useState(amount > 0 ? (amount / 100).toFixed(2) : "");
  useEffect(() => {
    setText((cur) => (Math.round(Number(cur || 0) * 100) === amount ? cur : amount > 0 ? (amount / 100).toFixed(2) : ""));
  }, [amount]);
  if (available <= 0) return null;

  const applied = walletCap(amount, available, total);
  const coversAll = total > 0 && applied >= total;
  const expiry = nearestExpiry(wallet.gifts);
  const expiryText = expiry
    ? new Date(expiry).toLocaleDateString(i18n.language?.startsWith("en") ? "en-GB" : "ar-EG-u-nu-latn", {
        day: "numeric", month: "short", year: "numeric",
      })
    : "";

  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-1">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-extrabold text-text">{t("walletCheckout.title")}</h2>
        <span className="num text-sm font-black text-action" dir="ltr">{money(available)}</span>
      </div>
      <p className="mt-1 text-xs text-text-muted">
        {t("walletCheckout.breakdown", { refund: money(wallet.refund_piastres), gift: money(wallet.gift_piastres) })}
      </p>
      {expiry ? <p className="mt-0.5 text-xs text-text-muted">{t("walletCheckout.giftExpiry", { date: expiryText })}</p> : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label htmlFor="ck-wallet-amount" className="text-sm font-bold text-text">{t("walletCheckout.amountLabel")}</label>
        <input
          id="ck-wallet-amount"
          type="number"
          inputMode="decimal"
          min={0}
          max={available / 100}
          step="0.01"
          dir="ltr"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const egp = Number(e.target.value);
            onAmount(Number.isFinite(egp) && egp > 0 ? Math.round(egp * 100) : 0);
          }}
          className="w-32 rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-text"
          aria-describedby="ck-wallet-hint"
        />
        <Button type="button" size="sm" variant="outline" onClick={() => onAmount(walletCap(available, available, total))}>
          {t("walletCheckout.useAll")}
        </Button>
        {amount > 0 ? (
          <Button type="button" size="sm" variant="ghost" onClick={() => onAmount(0)}>{t("walletCheckout.clear")}</Button>
        ) : null}
      </div>

      <dl className="mt-3 flex flex-col gap-1 border-t border-border pt-2 text-sm">
        <div className="flex justify-between">
          <dt className="text-text-muted">{t("walletCheckout.fromWallet")}</dt>
          <dd className="num font-bold text-success" dir="ltr">−{money(applied)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="font-extrabold text-text">{t("walletCheckout.remaining")}</dt>
          <dd className="num text-base font-extrabold text-text" dir="ltr">{money(walletRemainder(total, applied))}</dd>
        </div>
      </dl>
      <p id="ck-wallet-hint" className="mt-1.5 text-2xs text-text-faint">
        {coversAll ? t("walletCheckout.coversAll") : t("walletCheckout.note")}
      </p>
      <p className="mt-1 text-2xs text-text-faint">{t("cw.noWithdrawal")}</p>
    </section>
  );
}

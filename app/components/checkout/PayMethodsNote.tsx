import { useTranslation } from "react-i18next";

/**
 * What the Kashier hosted page will offer (cards + mobile wallets), and a
 * loud banner when this payment runs in Kashier TEST mode — so nobody
 * mistakes a sandbox payment for a real one. Spans only: it sits inside
 * radio labels.
 */
export function PayMethodsNote({ test }: { test: boolean }) {
  const { t } = useTranslation();
  // real brand marks for what Kashier's hosted page accepts; wallets stay text
  const logos = [
    { src: "/payments/visa.webp", alt: "Visa" },
    { src: "/payments/mastercard.webp", alt: "Mastercard" },
    { src: "/payments/fawry.webp", alt: "Fawry" },
    { src: "/payments/vodafone-cash.webp", alt: "Vodafone Cash" },
  ];
  return (
    <span className="flex flex-col gap-2">
      <span className="flex flex-wrap items-center gap-1.5">
        {logos.map((l) => (
          <img
            key={l.src}
            src={l.src}
            alt={l.alt}
            width={60}
            height={36}
            loading="lazy"
            decoding="async"
            className="h-9 w-[60px] rounded-md border border-border bg-white"
          />
        ))}
        <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-2xs font-bold text-text-muted">Meeza</span>
        <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-2xs font-bold text-text-muted">{t("pay.wallets")}</span>
      </span>
      {test ? (
        <span role="note" className="block rounded-md border border-warning/40 bg-warning-soft px-2.5 py-2 text-xs font-bold text-warning-strong">
          {t("pay.testBanner")}
        </span>
      ) : null}
    </span>
  );
}

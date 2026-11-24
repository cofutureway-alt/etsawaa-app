import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Live "ends in" timer for a discount or event. Renders nothing once the end
 * has passed (and before hydration it shows the static end date, so the SSR
 * HTML never disagrees with the client clock). Never shows a start date.
 */
export function Countdown({ endsAt, label, tone = "sale" }: { endsAt: string; label?: string; tone?: "sale" | "event" }) {
  const { t, i18n } = useTranslation();
  const end = new Date(endsAt).getTime();
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  if (now !== null && now >= end) return null;
  const left = now === null ? null : Math.max(0, end - now);
  const parts = left === null ? null : {
    d: Math.floor(left / 86_400_000),
    h: Math.floor(left / 3_600_000) % 24,
    m: Math.floor(left / 60_000) % 60,
    s: Math.floor(left / 1000) % 60,
  };
  const colors = tone === "event"
    ? "border-[#6B3FA0]/30 bg-[#6B3FA0]/10 text-[#6B3FA0]"
    : "border-danger/30 bg-danger-soft text-danger";
  const cell = (value: number, unit: string) => (
    <span className="flex min-w-10 flex-col items-center rounded-md bg-surface px-1.5 py-1 leading-none shadow-1">
      <span className="num text-base font-black tabular-nums" dir="ltr">{String(value).padStart(2, "0")}</span>
      <span className="mt-0.5 text-[10px] font-bold opacity-80">{unit}</span>
    </span>
  );
  return (
    <div className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 ${colors}`} role="timer" aria-live="off">
      <span className="text-xs font-extrabold">{label ?? t("countdown.endsIn")}</span>
      {parts ? (
        <span className="flex items-center gap-1">
          {parts.d > 0 ? cell(parts.d, t("countdown.days")) : null}
          {cell(parts.h, t("countdown.hours"))}
          {cell(parts.m, t("countdown.minutes"))}
          {cell(parts.s, t("countdown.seconds"))}
        </span>
      ) : (
        <span className="num text-xs font-bold">
          {new Date(endsAt).toLocaleDateString(i18n.language?.startsWith("en") ? "en-GB" : "ar-EG-u-nu-latn", { day: "numeric", month: "long" })}
        </span>
      )}
    </div>
  );
}

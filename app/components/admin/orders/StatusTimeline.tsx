import { useTranslation } from "react-i18next";
import type { HistoryRow } from "~/features/orders/api";
import { ReceiptIcon } from "~/components/ui/icons";

/** Admin order detail — status history timeline for the whole order. */
export function StatusTimeline({
  history,
  en,
}: {
  history: HistoryRow[];
  en: boolean | undefined;
}) {
  const { t } = useTranslation();

  return (
    <section className="rounded-lg border border-border bg-surface p-4 sm:p-6 shadow-1">
      {/* Activity & History Timeline */}
      <h2 className="text-sm font-extrabold text-text flex items-center gap-2">
        <ReceiptIcon className="size-4 text-action" />
        {t("order.historyTitle")}
      </h2>

      <div className="mt-4 flow-root">
        <ol className="relative border-s border-border ms-3 space-y-4">
          {history.map((h, idx) => (
            <li key={h.id || idx} className="ms-5">
              <span className="absolute -start-2 flex size-4 items-center justify-center rounded-full bg-surface border-2 border-action ring-2 ring-surface" />
              <div className="flex flex-wrap items-center justify-between gap-1">
                <span className="text-xs font-bold text-text">
                  {t(`order.status_${h.status}`)}
                </span>
                <time className="text-2xs font-mono text-text-muted" dir="ltr">
                  {new Date(h.created_at).toLocaleString(en ? "en-EG" : "ar-EG-u-nu-latn")}
                </time>
              </div>
              {h.note && h.note !== "order_created" ? (
                <p className="mt-1 text-xs text-text-muted bg-surface-tint/40 p-2 rounded-lg border border-border/40">
                  {h.note}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

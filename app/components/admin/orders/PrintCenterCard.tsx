import { useTranslation } from "react-i18next";
import type { GroupRow } from "~/features/orders/api";
import { FileIcon, PackageIcon, ReceiptIcon, TruckIcon } from "~/components/ui/icons";
import { type OrderDocumentRow } from "./shared";

/**
 * Admin order detail — print center (AGENT §28): copies + pieces inputs,
 * print links (invoice A4, carrier label A5, one label per vendor group) and
 * the print log. Copies/pieces live in the route so the header quick actions
 * build their URLs from the same state.
 */
export function PrintCenterCard({
  groups,
  documents,
  en,
  copies,
  pieces,
  setCopies,
  setPieces,
  piecesAuto,
  print,
}: {
  groups: GroupRow[];
  documents: OrderDocumentRow[];
  en: boolean | undefined;
  copies: number;
  pieces: number | "auto";
  setCopies: (v: number) => void;
  setPieces: (v: number | "auto") => void;
  piecesAuto: number;
  print: (doc: string, vendor?: string) => string;
}) {
  const { t } = useTranslation();

  return (
    <section className="rounded-lg border border-border bg-surface p-4 sm:p-6 shadow-1 space-y-4">
      {/* Print Center */}
      <h2 className="text-sm font-extrabold text-text flex items-center gap-2 border-b border-border/60 pb-3">
        <FileIcon className="size-4 text-action" />
        {t("order.printCenter")}
      </h2>

      <div className="space-y-2.5 text-xs">
        <label className="flex items-center justify-between gap-2">
          <span className="text-text-muted font-medium">{t("order.copies")}</span>
          <input
            type="number"
            min={1}
            max={50}
            value={copies}
            onChange={(e) => setCopies(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
            className="w-20 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-center font-mono text-text shadow-1 focus:border-action focus:outline-none"
          />
        </label>

        <label className="flex items-center justify-between gap-2">
          <span className="text-text-muted font-medium">{t("order.pieces")}</span>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={1}
              max={999}
              value={pieces === "auto" ? piecesAuto : pieces}
              onChange={(e) => setPieces(Math.max(1, Math.min(999, Number(e.target.value) || 1)))}
              className="w-20 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-center font-mono text-text shadow-1 focus:border-action focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setPieces("auto")}
              className={`text-2xs font-bold cursor-pointer ${pieces === "auto" ? "text-action" : "text-text-faint hover:text-text"}`}
            >
              {t("order.piecesAuto")}
            </button>
          </div>
        </label>

        <div className="space-y-2 pt-2">
          <a
            href={print("invoice_admin")}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-1.5 rounded-lg border border-action bg-surface px-3 py-2 text-center text-xs font-bold text-action hover:bg-surface-tint transition-colors shadow-1"
          >
            <ReceiptIcon className="size-4" />
            {t("order.printInvoiceA4")}
          </a>

          <a
            href={print("label_carrier")}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-1.5 rounded-lg border border-action bg-surface px-3 py-2 text-center text-xs font-bold text-action hover:bg-surface-tint transition-colors shadow-1"
          >
            <TruckIcon className="size-4" />
            {t("order.printCarrierA5")}
          </a>

          {groups.map((g) => (
            <a
              key={g.id}
              href={print("label_vendor", g.vendor_id)}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-center text-xs font-semibold text-text hover:bg-surface-tint transition-colors shadow-1"
            >
              <PackageIcon className="size-3.5 text-text-muted" />
              <span>{t("order.printVendorLabel")} — {en ? g.vendor.store_name_en : g.vendor.store_name_ar}</span>
            </a>
          ))}
        </div>
      </div>

      {documents.length > 0 ? (
        <details className="border-t border-border/60 pt-3 text-xs">
          <summary className="cursor-pointer font-bold text-text-muted hover:text-text">
            {t("order.printLog")} ({documents.length})
          </summary>
          <ul className="mt-2 space-y-1 font-mono text-2xs text-text-faint">
            {documents.map((d) => (
              <li key={d.id} className="flex justify-between gap-2 border-b border-border/20 py-1">
                <span>{t(`order.doc_${d.doc_type}`)}</span>
                <span dir="ltr">×{d.copies} · {new Date(d.created_at).toLocaleTimeString(en ? "en-EG" : "ar-EG-u-nu-latn")}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

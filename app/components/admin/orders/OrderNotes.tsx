import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { Badge } from "~/components/ui/Badge";
import { FileIcon } from "~/components/ui/icons";
import { type OrderActionData, type OrderNoteRow } from "./shared";

/**
 * Admin order detail — A-15 order notes: add form with a private/public
 * visibility toggle plus the chronological note log.
 */
export function OrderNotes({
  notes,
  en,
}: {
  notes: OrderNoteRow[];
  en: boolean | undefined;
}) {
  const { t } = useTranslation();
  const noteFetcher = useFetcher<OrderActionData>();

  return (
    <section className="rounded-lg border border-border bg-surface p-4 sm:p-6 shadow-1">
      {/* Internal / Public Order Notes (A-15) */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-extrabold text-text flex items-center gap-2">
          <FileIcon className="size-4 text-action" />
          {t("note.title")}
        </h2>
        <span className="text-xs font-mono text-text-muted">
          {notes.length}
        </span>
      </div>

      <div className="mt-4">
        <noteFetcher.Form method="post" preventScrollReset className="space-y-3">
          <input type="hidden" name="intent" value="add_note" />
          <textarea
            name="body"
            rows={2}
            required
            maxLength={2000}
            placeholder={t("note.placeholder")}
            className="w-full rounded-lg border border-border bg-surface p-3 text-xs text-text placeholder:text-text-faint focus:border-action focus:outline-none focus:ring-1 focus:ring-action shadow-1"
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-xs text-text font-medium cursor-pointer">
              <input type="hidden" name="visibility" value="private" />
              <input
                type="checkbox"
                name="visibility"
                value="public"
                className="size-4 rounded border-border accent-action cursor-pointer"
              />
              {t("note.makePublic")}
            </label>

            <button
              type="submit"
              className="cursor-pointer rounded-lg bg-action px-4 py-2 text-xs font-bold text-on-action hover:bg-action-hover transition-colors shadow-1"
            >
              {t("note.save")}
            </button>
          </div>
          {noteFetcher.data && !noteFetcher.data.ok ? (
            <p role="alert" className="text-xs font-semibold text-danger">
              {t("order.updateFailed")}
            </p>
          ) : null}
        </noteFetcher.Form>
      </div>

      {notes.length > 0 ? (
        <div className="mt-4 space-y-2.5 divide-y divide-border/40 pt-2">
          {notes.map((n) => (
            <div key={n.id} className="pt-2.5 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Badge tone={n.is_internal ? "danger" : "success"} dot>
                  {n.is_internal ? t("note.private") : t("note.public")}
                </Badge>
                <time className="text-2xs font-mono text-text-muted" dir="ltr">
                  {new Date(n.created_at).toLocaleString(en ? "en-EG" : "ar-EG-u-nu-latn")}
                </time>
              </div>
              <p className="text-xs text-text font-normal leading-relaxed">{n.body}</p>
              <p className="text-2xs text-text-faint">
                بواسطة: {n.author || "—"}
              </p>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

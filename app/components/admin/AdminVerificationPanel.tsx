import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { Badge, Button, Dialog, Input } from "~/components/ui";
import { AlertIcon, CheckIcon, FileIcon, ShieldIcon, XIcon } from "~/components/ui/icons";
import { useActionToast } from "~/components/layout/ActionFeedback";

/**
 * Admin → user profile → Verification: the seller's documents (always shown,
 * also after approval), a decision per image (approve / reject with reason +
 * note), the store-level verification status (pending review / needs
 * changes / verified), full rejection with suspension or reinstatement, and
 * the history of every change with the admin who made it.
 */

const DOC_TYPES = ["commercial_register", "tax_card", "national_id"] as const;
const REASONS = ["blurry", "unreadable", "expired", "mismatch", "incomplete", "wrong_document", "other"] as const;

export interface AdminDoc {
  id: string; type: string; path: string; original_name: string; mime: string; status: string;
  reject_reason: string | null; review_note: string | null; created_at: string; reviewed_at: string | null;
}
export interface HistoryRow { id: string; field: string; from_value: string | null; to_value: string; reason: string | null; created_at: string; actor_name: string | null }

type Dialogs =
  | { kind: "reject_doc"; doc: AdminDoc }
  | { kind: "needs_changes" }
  | { kind: "suspend" }
  | { kind: "reinstate" }
  | { kind: "reject_application" };

export function AdminVerificationPanel({ vendorId, status, verification, note, suspension, documents, history, lang }: {
  vendorId: string;
  status: string;
  verification: string;
  note: string | null;
  suspension: string | null;
  documents: AdminDoc[];
  history: HistoryRow[];
  lang: "ar" | "en";
}) {
  const { t } = useTranslation();
  const fetcher = useFetcher<{ ok: boolean; reason?: string }>();
  useActionToast(fetcher);
  const busy = fetcher.state !== "idle";
  const [dialog, setDialog] = useState<Dialogs | null>(null);
  useEffect(() => { if (fetcher.state === "idle" && fetcher.data?.ok) setDialog(null); }, [fetcher.state, fetcher.data]);
  const post = (fields: Record<string, string>) => fetcher.submit({ vendor_id: vendorId, ...fields }, { method: "post" });
  const date = (v: string) => new Date(v).toLocaleString(lang === "en" ? "en-GB" : "ar-EG-u-nu-latn", { dateStyle: "medium", timeStyle: "short" });
  const isImage = (d: AdminDoc) => d.mime.startsWith("image/");
  const suspended = status === "suspended";
  const vTone = verification === "verified" ? "success" : verification === "needs_changes" || verification === "submitted" ? "warning" : "danger";

  return (
    <div className="flex flex-col gap-5">
      {/* status + actions */}
      <section className={`flex flex-col gap-3 rounded-xl border-2 p-4 ${suspended ? "border-danger bg-danger-soft" : "border-border bg-surface-tint/30"}`}>
        <div className="flex flex-wrap items-center gap-2">
          <ShieldIcon className="size-5 text-action" />
          <span className="text-sm font-bold text-text-muted">{t("adminVerify.store")}:</span>
          <Badge tone={suspended ? "danger" : status === "active" ? "success" : "warning"}>{t(`verify.value.${status}`, status)}</Badge>
          <span className="text-sm font-bold text-text-muted">{t("adminVerify.verification")}:</span>
          <Badge tone={vTone}>{t(`verify.value.${verification}`, verification)}</Badge>
        </div>
        {suspended && suspension ? <p className="text-sm text-text"><b>{t("adminVerify.suspensionReason")}:</b> {suspension}</p> : null}
        {!suspended && note ? <p className="text-sm text-text"><b>{t("adminVerify.noteToSeller")}:</b> {note}</p> : null}
        <div className="flex flex-wrap gap-2">
          {status === "pending" ? (
            <Button size="sm" loading={busy} onClick={() => post({ intent: "store_review", decision: "approve" })}>
              <CheckIcon className="size-4" />{t("adminVerify.approveStore")}
            </Button>
          ) : null}
          {!suspended ? (
            <>
              {verification !== "verified" ? (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => post({ intent: "set_verification", status: "verified" })}>
                  <CheckIcon className="size-4" />{t("adminVerify.markVerified")}
                </Button>
              ) : null}
              {verification !== "submitted" ? (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => post({ intent: "set_verification", status: "submitted" })}>
                  {t("adminVerify.backToReview")}
                </Button>
              ) : null}
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setDialog({ kind: "needs_changes" })}>
                {t("adminVerify.requestChanges")}
              </Button>
              <Button size="sm" variant="ghost" className="text-danger" disabled={busy} onClick={() => setDialog({ kind: "suspend" })}>
                <AlertIcon className="size-4" />{t("adminVerify.rejectSuspend")}
              </Button>
            </>
          ) : (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setDialog({ kind: "reinstate" })}>{t("adminVerify.reinstate")}</Button>
          )}
        </div>
      </section>

      {/* documents per type */}
      {DOC_TYPES.map((type) => {
        const docs = documents.filter((d) => d.type === type || (type === "national_id" && d.type === "residence"));
        return (
          <section key={type} className="rounded-xl border border-border bg-surface p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-extrabold text-text">
              {t(`verify.doc.${type}`)} <span className="num text-xs font-bold text-text-muted">({docs.length})</span>
            </h3>
            {docs.length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-text-muted">{t("adminVerify.notUploaded")}</p>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {docs.map((d, i) => {
                  const url = `/api/document?path=${encodeURIComponent(d.path)}&redirect=1`;
                  return (
                    <li key={d.id} className={`flex flex-col overflow-hidden rounded-lg border ${d.status === "rejected" ? "border-danger/60" : d.status === "verified" ? "border-success/50" : "border-border"}`}>
                      <a href={url} target="_blank" rel="noreferrer" className="block bg-surface-tint">
                        {isImage(d) ? (
                          <img src={url} alt={`${t(`verify.doc.${type}`)} ${i + 1}`} loading="lazy" className="aspect-[4/3] w-full object-contain" />
                        ) : (
                          <span className="flex aspect-[4/3] items-center justify-center gap-2 text-sm font-bold text-action"><FileIcon className="size-6" />PDF</span>
                        )}
                      </a>
                      <div className="flex flex-1 flex-col gap-2 p-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs text-text-muted">{t("verify.imageN", { n: i + 1 })} · {date(d.created_at)}</span>
                          <Badge tone={d.status === "verified" ? "success" : d.status === "rejected" ? "danger" : "warning"}>{t(`vendorOnboarding.docs.status.${d.status}`)}</Badge>
                        </div>
                        {d.status === "rejected" ? (
                          <p className="text-xs"><b className="text-danger">{t(`verify.reason.${d.reject_reason ?? "other"}`)}</b>{d.review_note ? ` — ${d.review_note}` : ""}</p>
                        ) : null}
                        <div className="mt-auto flex gap-1.5">
                          <Button size="sm" variant={d.status === "verified" ? "ghost" : "outline"} disabled={busy || d.status === "verified"}
                            onClick={() => post({ intent: "doc_review", doc_id: d.id, decision: "verified" })}>
                            <CheckIcon className="size-3.5" />{t("adminVerify.approve")}
                          </Button>
                          <Button size="sm" variant="ghost" className="text-danger" disabled={busy}
                            onClick={() => setDialog({ kind: "reject_doc", doc: d })}>
                            <XIcon className="size-3.5" />{t("adminVerify.reject")}
                          </Button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}

      {/* history */}
      <section className="rounded-xl border border-border bg-surface">
        <h3 className="border-b border-border px-4 py-3 text-sm font-extrabold text-text">{t("verify.history")}</h3>
        {history.length === 0 ? <p className="px-4 py-4 text-xs text-text-muted">{t("adminVerify.noHistory")}</p> : (
          <ol className="divide-y divide-border">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-4 py-2.5 text-sm">
                <span className="font-bold text-text">
                  {t(h.field === "status" ? "verify.histStatus" : "verify.histVerification")}:{" "}
                  {h.from_value ? `${t(`verify.value.${h.from_value}`, h.from_value)} → ` : ""}{t(`verify.value.${h.to_value}`, h.to_value)}
                </span>
                <span className="text-xs text-text-muted">{h.actor_name ?? t("adminVerify.system")} · <span className="num">{date(h.created_at)}</span></span>
                {h.reason ? <span className="w-full text-xs text-text-muted">{h.reason}</span> : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* dialogs */}
      <Dialog open={dialog !== null} onClose={() => setDialog(null)}
        title={dialog ? t(`adminVerify.dialog.${dialog.kind}`) : ""}>
        {dialog ? (
          <fetcher.Form method="post" className="flex flex-col gap-3 p-1">
            <input type="hidden" name="vendor_id" value={vendorId} />
            {dialog.kind === "reject_doc" ? (
              <>
                <input type="hidden" name="intent" value="doc_review" />
                <input type="hidden" name="doc_id" value={dialog.doc.id} />
                <input type="hidden" name="decision" value="rejected" />
                <label className="flex flex-col gap-1.5 text-sm font-bold text-text">
                  {t("adminVerify.problem")}<span className="sr-only">*</span>
                  <select name="reason" required defaultValue="blurry" className="rounded-md border border-border bg-surface px-3 py-2 text-sm font-normal">
                    {REASONS.map((r) => <option key={r} value={r}>{t(`verify.reason.${r}`)}</option>)}
                  </select>
                </label>
                <Input id="vr-note" name="note" label={t("adminVerify.noteForSeller")} placeholder={t("adminVerify.notePlaceholder")} />
              </>
            ) : dialog.kind === "needs_changes" ? (
              <>
                <input type="hidden" name="intent" value="set_verification" />
                <input type="hidden" name="status" value="needs_changes" />
                <p className="text-xs text-text-muted">{t("adminVerify.needsChangesHint")}</p>
                <label className="flex flex-col gap-1.5 text-sm font-bold text-text">
                  {t("adminVerify.noteForSeller")} *
                  <textarea name="note" required minLength={5} rows={4} className="rounded-md border border-border bg-surface px-3 py-2 text-sm font-normal" />
                </label>
              </>
            ) : dialog.kind === "suspend" ? (
              <>
                <input type="hidden" name="intent" value="suspend" />
                <p className="rounded-md bg-danger-soft px-3 py-2 text-xs font-bold text-danger">{t("adminVerify.suspendWarning")}</p>
                <label className="flex flex-col gap-1.5 text-sm font-bold text-text">
                  {t("adminVerify.rejectionReason")} *
                  <textarea name="reason" required minLength={5} rows={4} className="rounded-md border border-border bg-surface px-3 py-2 text-sm font-normal" />
                </label>
              </>
            ) : (
              <>
                <input type="hidden" name="intent" value="reinstate" />
                <p className="text-sm text-text">{t("adminVerify.reinstateHint")}</p>
                <Input id="vr-rnote" name="note" label={t("adminVerify.noteForSeller")} />
              </>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={() => setDialog(null)}>{t("common.cancel")}</Button>
              <Button type="submit" loading={busy} className={dialog.kind === "suspend" || dialog.kind === "reject_doc" ? "bg-danger hover:bg-danger" : ""}>
                {t(`adminVerify.confirm.${dialog.kind}`)}
              </Button>
            </div>
          </fetcher.Form>
        ) : null}
      </Dialog>
    </div>
  );
}

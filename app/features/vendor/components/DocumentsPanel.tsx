import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button, useToast } from "~/components/ui";
import { FileIcon, PlusIcon, TrashIcon } from "~/components/ui/icons";
import { deleteVendorDocument, uploadVendorDocument } from "~/features/account/client";
import { DOCUMENT_TYPES, type VendorConfig } from "~/features/vendor/config";
import type { VendorDocumentRow } from "~/features/vendor/api";
import { DOCUMENTS_BUCKET_MAX_MB } from "~/lib/media.shared";

/**
 * Seller verification documents — one section per type (commercial register,
 * tax card, national ID), each holding several images. Every image shows its
 * review state; a rejected one shows the reason and the admin's note and can
 * be replaced on its own. Verified images stay on file and can't be removed.
 */

const DOC_MIMES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

export function DocumentsPanel({ config, documents, onChanged, readOnly = false }: {
  config: VendorConfig;
  documents: VendorDocumentRow[];
  onChanged: () => void;
  readOnly?: boolean;
}) {
  const types = DOCUMENT_TYPES.filter((type) => config.required_documents[type]);
  const maxMb = Math.min(config.max_document_mb, DOCUMENTS_BUCKET_MAX_MB);
  return (
    <div className="flex flex-col gap-4">
      {types.map((type) => (
        <DocTypeSection key={type} type={type} docs={documents.filter((d) => d.type === type)}
          maxMb={maxMb} onChanged={onChanged} readOnly={readOnly} />
      ))}
    </div>
  );
}

function DocTypeSection({ type, docs, maxMb, onChanged, readOnly }: {
  type: string; docs: VendorDocumentRow[]; maxMb: number; onChanged: () => void; readOnly: boolean;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [replacing, setReplacing] = useState<string | null>(null);
  const [pct, setPct] = useState<number | null>(null);
  const rejected = docs.filter((d) => d.status === "rejected");
  const state = docs.length === 0 ? "missing" : rejected.length ? "rejected" : docs.every((d) => d.status === "verified") ? "verified" : "pending";
  const tone = { missing: "neutral", rejected: "danger", verified: "success", pending: "warning" }[state] as "neutral" | "danger" | "success" | "warning";

  async function upload(files: FileList) {
    for (const file of Array.from(files)) {
      if (!DOC_MIMES.includes(file.type)) { toast.showToast("error", t("vendorOnboarding.docs.badType")); continue; }
      if (file.size > maxMb * 1024 * 1024) { toast.showToast("error", t("vendorOnboarding.docs.tooLarge", { max: maxMb })); continue; }
      setPct(0);
      const res = await uploadVendorDocument(file, type, setPct, replacing ?? undefined);
      setPct(null);
      if (!res.ok) {
        toast.showToast("error", res.reason === "store_suspended" ? t("verify.suspendedAction") : t("errors.generic"));
        break;
      }
    }
    setReplacing(null);
    toast.showToast("success", t("vendorOnboarding.docs.uploaded"));
    onChanged();
  }

  async function remove(id: string) {
    const res = await deleteVendorDocument(id);
    if (!res.ok) toast.showToast("error", t("errors.generic"));
    onChanged();
  }

  return (
    <section className={`rounded-xl border bg-surface p-4 ${state === "rejected" ? "border-danger/50" : "border-border"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-extrabold text-text">
          {t(`verify.doc.${type}`)}<span className="text-danger">*</span>
          <Badge tone={tone}>{t(`verify.docState.${state}`)}</Badge>
        </h3>
        {!readOnly ? (
          <Button type="button" size="sm" variant="outline" onClick={() => { setReplacing(null); input.current?.click(); }}>
            <PlusIcon className="size-4" />{t("verify.addImages")}
          </Button>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-text-muted">{t(`verify.docHint.${type}`)}</p>

      {docs.length ? (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {docs.map((d, i) => (
            <li key={d.id} className={`flex flex-col gap-1.5 rounded-lg border p-2.5 ${d.status === "rejected" ? "border-danger/50 bg-danger-soft/40" : "border-border"}`}>
              <div className="flex items-center gap-2">
                <FileIcon className="size-5 shrink-0 text-text-muted" />
                <a href={`/api/document?path=${encodeURIComponent(d.path)}&redirect=1`} target="_blank" rel="noreferrer"
                  className="min-w-0 flex-1 truncate text-sm font-bold text-action hover:underline">
                  {t("verify.imageN", { n: i + 1 })} · {d.original_name || d.mime}
                </a>
                <Badge tone={d.status === "verified" ? "success" : d.status === "rejected" ? "danger" : "warning"}>{t(`vendorOnboarding.docs.status.${d.status}`)}</Badge>
              </div>
              {d.status === "rejected" ? (
                <div className="text-xs">
                  <p className="font-extrabold text-danger">{t(`verify.reason.${d.reject_reason ?? "other"}`)}</p>
                  {d.review_note ? <p className="mt-0.5 text-text">{d.review_note}</p> : null}
                </div>
              ) : null}
              {!readOnly && d.status !== "verified" ? (
                <div className="flex gap-2">
                  {d.status === "rejected" ? (
                    <button type="button" onClick={() => { setReplacing(d.id); input.current?.click(); }}
                      className="cursor-pointer text-xs font-bold text-action hover:underline">{t("verify.replace")}</button>
                  ) : null}
                  <button type="button" onClick={() => void remove(d.id)}
                    className="inline-flex cursor-pointer items-center gap-1 text-xs font-bold text-text-muted hover:text-danger">
                    <TrashIcon className="size-3.5" />{t("common.remove")}
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 rounded-md border border-dashed border-border px-3 py-3 text-xs text-text-muted">{t("verify.noImages")}</p>
      )}

      {pct !== null ? (
        <div className="mt-2 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border"><div className="h-full bg-action" style={{ width: `${pct}%` }} /></div>
          <span className="num text-xs font-bold text-text-muted">{pct}%</span>
        </div>
      ) : null}
      <input ref={input} type="file" multiple={!replacing} accept={DOC_MIMES.join(",")} className="hidden"
        onChange={(e) => { const files = e.target.files; e.target.value = ""; if (files?.length) void upload(files); }} />
      <p className="mt-2 text-2xs text-text-faint">{t("vendorOnboarding.docs.limits", { max: maxMb })}</p>
    </section>
  );
}

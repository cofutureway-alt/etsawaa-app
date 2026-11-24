import { useState } from "react";
import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui";
import { Dialog } from "~/components/ui/Overlay";
import type { SaveActionData, WizardProduct } from "./types";

/**
 * Status banners above the wizard card: the "under review — edits pull it out
 * of the queue" notice, the explicit reopen banner for a live product, the
 * rejection reason for returned drafts, and the two-tab staleness warning.
 */

export interface WizardBannersProps {
  product: WizardProduct | null;
  editable: boolean;
  stale: boolean;
}

export function WizardBanners({ product, editable, stale }: WizardBannersProps) {
  const { t } = useTranslation();
  const isRejected = product?.status === "rejected";
  // a submitted / published product is edited by reopening it as a draft:
  // every edit goes back through review (a live product leaves the store meanwhile)
  const reopen = useFetcher<SaveActionData>();
  const [confirm, setConfirm] = useState(false);
  const live = product?.status === "approved";
  const pending = product?.status === "pending";
  const canReopen = !editable && live;
  const failed = reopen.state === "idle" && reopen.data?.intent === "reopen" && !reopen.data.ok;
  return (
    <>
      {!editable ? (
        <div role="status" className="flex flex-col gap-3 rounded-md border border-info/40 bg-info-soft p-3 text-sm text-text sm:flex-row sm:items-center sm:justify-between">
          <p className="font-bold">
            {canReopen ? t(live ? "productWizard.reopenLiveNote" : "productWizard.reopenPendingNote") : t("productWizard.readOnly")}
          </p>
          {canReopen ? (
            <Button type="button" size="sm" className="shrink-0" onClick={() => setConfirm(true)}>
              {t(live ? "productWizard.reopenLive" : "productWizard.reopenPending")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {failed ? (
        <div role="alert" className="rounded-md border border-danger/40 bg-danger-soft p-3 text-sm font-bold text-danger">
          {t("productWizard.reopenFailed")}
        </div>
      ) : null}
      <Dialog open={confirm} onClose={() => setConfirm(false)} title={t(live ? "productWizard.reopenLiveTitle" : "productWizard.reopenPendingTitle")}>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text">{t(live ? "productWizard.reopenLiveBody" : "productWizard.reopenPendingBody")}</p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setConfirm(false)}>{t("common.cancel")}</Button>
            <Button type="button" loading={reopen.state !== "idle"}
              onClick={() => {
                reopen.submit({ intent: "reopen", productId: product?.id ?? "" }, { method: "post" });
                setConfirm(false);
              }}>
              {t(live ? "productWizard.reopenLiveConfirm" : "productWizard.reopenPendingConfirm")}
            </Button>
          </div>
        </div>
      </Dialog>
      {pending && editable ? (
        <div role="status" className="rounded-md border border-info/40 bg-info-soft p-3 text-sm font-bold text-text">
          {t("productWizard.pendingEditable")}
        </div>
      ) : null}
      {isRejected && product?.rejection_reason ? (
        <div role="alert" className="flex items-start gap-3 rounded-lg border-2 border-warning bg-warning-soft p-4 text-sm text-text">
          <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-warning font-black text-ink">!</span>
          <div>
            <p className="font-black text-warning-strong">{t("productWizard.needsChangesTitle")}</p>
            <p className="mt-0.5 font-bold">{product.rejection_reason}</p>
            <p className="mt-1 text-xs text-text-muted">{t("productWizard.needsChangesHint")}</p>
          </div>
        </div>
      ) : null}
      {stale ? (
        <div role="alert" className="rounded-md border border-warning/40 bg-warning-soft p-3 text-sm font-bold text-warning-strong">
          {t("productWizard.staleWarning")}
        </div>
      ) : null}
    </>
  );
}

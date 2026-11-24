import { useTranslation } from "react-i18next";
import { EmptyState, ShieldIcon } from "~/components/ui";
import type { VendorConfig } from "~/features/vendor/config";
import { DocumentsPanel } from "~/features/vendor/components/DocumentsPanel";
import type { VendorDocumentRow } from "~/features/vendor/api";

/**
 * step3-verification.tsx — wizard step 3 "verification": document uploads
 * (several images per type, see DocumentsPanel) with a persistent
 * grace-warning, gated on the vendor row already existing (created by the
 * first autosave).
 */

export function Step3Verification({
  vendorId,
  config,
  documents,
  graceLabel,
  onSkip,
  onDocumentUploaded,
}: {
  vendorId: string;
  config: VendorConfig;
  documents: VendorDocumentRow[];
  graceLabel: string;
  /** kept for the route's wiring; the step has no skip button any more */
  onSkip: () => void;
  onDocumentUploaded: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div className="flex items-start gap-2 rounded-md border border-info/30 bg-info-soft p-3.5">
        <ShieldIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-info" />
        <div className="text-sm leading-relaxed text-text">
          <p className="font-extrabold">{t("vendorOnboarding.step3.idRequiredTitle")}</p>
          <p className="mt-1 text-text-muted">{t("vendorOnboarding.step3.idRequiredBody", { grace: graceLabel })}</p>
        </div>
      </div>
      {vendorId ? (
        <DocumentsPanel config={config} documents={documents} onChanged={onDocumentUploaded} />
      ) : (
        <EmptyState title={t("vendorOnboarding.docs.needStore")} body={t("vendorOnboarding.docs.needStoreBody")} />
      )}
    </>
  );
}

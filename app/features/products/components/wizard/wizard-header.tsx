import { useTranslation } from "react-i18next";
import { Badge } from "~/components/ui";
import type { WizardProduct } from "./types";

/**
 * Wizard header: title (new vs edit), product status badge and the live
 * autosave indicator ("saving…" / "saved at HH:MM", locale-aware).
 * Admin mode adds the store name + an "editing as administration" badge and
 * has no autosave to report.
 */

export interface WizardHeaderProps {
  productId: string | null;
  product: WizardProduct | null;
  isAr: boolean;
  /** Save fetcher in flight or unsaved local changes present. */
  saving: boolean;
  /** ISO timestamp of the last successful autosave, if any. */
  savedAt: string | null;
  mode?: "seller" | "admin";
  /** admin mode: the store the product belongs to */
  storeName?: string;
}

export function WizardHeader({ productId, product, isAr, saving, savedAt, mode = "seller", storeName }: WizardHeaderProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-extrabold text-text">
          {productId ? t("productWizard.editTitle") : t("productWizard.newTitle")}
        </h1>
        {mode === "admin" ? <Badge tone="warning">{t("adminProductEdit.badge")}</Badge> : null}
        {mode === "admin" && storeName ? <span className="text-sm font-bold text-text-muted">{storeName}</span> : null}
      </div>
      <div className="flex items-center gap-2 text-xs text-text-faint" aria-live="polite">
        {product?.status ? <Badge tone={product.status === "rejected" ? "danger" : product.status === "approved" ? "success" : "warning"}>{t(`vendorStates.status.${product.status}`)}</Badge> : null}
        {mode === "seller" ? (
          <span>
            {saving
              ? t("vendorOnboarding.saving")
              : savedAt
                ? t("vendorOnboarding.savedAt", { time: new Date(savedAt).toLocaleTimeString(isAr ? "ar-EG-u-nu-latn" : "en-GB") })
                : ""}
          </span>
        ) : null}
      </div>
    </div>
  );
}

import { useTranslation } from "react-i18next";
import { Button, Select } from "~/components/ui";
import { isBaseOffer, type ChildDraft } from "./children";
import { categoryLabel } from "./helpers";
import type { PickerCategory, WizardForm } from "./types";

/**
 * Wizard step 5 — shipping & review: shipping class and fulfilment
 * mode (platform by default; some categories allow platform only), followed by a compact review summary and the
 * save-draft / submit actions.
 */

export interface ShippingStepProps {
  form: WizardForm;
  patch: (partial: Partial<WizardForm>) => void;
  categories: PickerCategory[];
  isAr: boolean;
  /** Child products — feed the review counts and price range. */
  childList: ChildDraft[];
  /** V-17: drafts/rejected only — pending/approved hide the submit action. */
  editable: boolean;
  /** True while the save fetcher is in flight (submit button spinner). */
  saving: boolean;
  /** "Save draft" button — just flags the form dirty so autosave fires. */
  onMarkDirty: () => void;
  onSubmit: () => void;
  /** this category ships with the platform only */
  shippingBlocked: boolean;
  /** admin mode: the sticky admin bar owns the save action */
  showActions?: boolean;
}

export function ShippingStep({
  form,
  patch,
  categories,
  isAr,
  childList,
  editable,
  saving,
  onMarkDirty,
  onSubmit,
  shippingBlocked,
  showActions = true,
}: ShippingStepProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          id="p_ship_class"
          label={t("productWizard.shipping.class")}
          value={form.shipping_class}
          onChange={(e) => patch({ shipping_class: e.target.value })}
          options={[
            { value: "standard", label: t("productWizard.shipping.classStandard") },
            { value: "heavy", label: t("productWizard.shipping.classHeavy") },
            { value: "fragile", label: t("productWizard.shipping.classFragile") },
          ]}
        />
      </div>
      <Select
        id="p_ship_mode"
        label={t("productWizard.shipping.mode")}
        value={shippingBlocked ? "platform" : form.shipping_mode}
        disabled={shippingBlocked}
        onChange={(e) => patch({ shipping_mode: e.target.value as "platform" | "vendor" })}
        options={[
          { value: "platform", label: t("productWizard.shipping.modePlatform") },
          ...(shippingBlocked ? [] : [{ value: "vendor", label: t("productWizard.shipping.modeVendor") }]),
        ]}
      />
      {shippingBlocked ? (
        <p className="-mt-2 rounded-md bg-surface-tint px-3 py-2 text-xs font-bold text-text-muted">{t("productWizard.shipping.platformOnly")}</p>
      ) : null}

      <div className="rounded-md border border-border bg-surface-tint p-3.5">
        <p className="text-sm font-extrabold text-text">{t("productWizard.review.title")}</p>
        <dl className="mt-2 grid gap-1.5 sm:grid-cols-2">
          <ReviewRow label={t("productWizard.basics.nameAr")} value={form.name_ar} />
          <ReviewRow label={t("productWizard.basics.nameEn")} value={form.name_en} />
          <ReviewRow label={t("productWizard.classification.category")} value={categoryLabel(categories, form.leaf_category_id, isAr)} />
          <ReviewRow label={t("children.title")} value={String(isBaseOffer(childList) ? 0 : childList.length)} />
          <ReviewRow label={t("children.reviewSizes")} value={String(childList.reduce((n, c) => n + c.sizes.length, 0))} />
          <ReviewRow label={t("children.price")} value={priceRange(childList)} />
          <ReviewRow label={t("children.reviewStock")} value={String(childList.reduce((n, c) => n + c.sizes.reduce((m, sz) => m + (Number(sz.stock) || 0), 0), 0))} />
          <ReviewRow label={t("productWizard.classification.media")} value={String(form.media.length)} />
        </dl>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        {editable && showActions ? (
          <Button type="button" variant="outline" onClick={onMarkDirty}>
            {t("productWizard.review.saveDraft")}
          </Button>
        ) : null}
        {editable && showActions ? (
          <Button type="button" size="lg" loading={saving} onClick={onSubmit}>
            {t("productWizard.review.submit")}
          </Button>
        ) : null}
      </div>
      {showActions ? <p className="text-xs text-text-faint">{t("productWizard.review.note")}</p> : null}
    </div>
  );
}

function priceRange(children: ChildDraft[]): string {
  const prices = children.map((c) => Number(c.price)).filter((n) => n > 0);
  if (prices.length === 0) return "—";
  const lo = Math.min(...prices), hi = Math.max(...prices);
  return lo === hi ? `${lo} EGP` : `${lo} – ${hi} EGP`;
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-2xs font-bold text-text-faint">{label}</dt>
      <dd className="text-sm text-text">{value || "—"}</dd>
    </div>
  );
}

import { useTranslation } from "react-i18next";
import type { FormState } from "../useOnboarding";

/**
 * step5-review.tsx — wizard step 5 "review": a read-only summary of steps 1-4
 * with an edit link per block, plus the submit note. Owns ReviewBlock, its
 * only consumer.
 */

export function Step5Review({
  form,
  documentsCount,
  graceLabel,
  termsVersion,
  onEdit,
}: {
  form: FormState;
  documentsCount: number;
  graceLabel: string;
  termsVersion: string;
  onEdit: (step: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3 text-sm">
      <ReviewBlock
        title={t("vendorOnboarding.steps.store")}
        onEdit={() => onEdit(1)}
        rows={[
          [t("vendorOnboarding.step1.nameAr"), form.store_name_ar],
          [t("vendorOnboarding.step1.nameEn"), form.store_name_en],
          [t("vendorOnboarding.step1.slug"), form.slug],
          [t("vendorOnboarding.step1.categories"), String(form.category_ids.length)],
        ]}
      />
      <ReviewBlock
        title={t("vendorOnboarding.steps.details")}
        onEdit={() => onEdit(2)}
        rows={[
          [t("vendorOnboarding.step2.firstName"), `${form.first_name} ${form.last_name}`],
          [t("vendorOnboarding.step2.phone"), form.phone],
          [
            t("vendorOnboarding.step2.address1"),
            `${form.address1}${form.address2 ? ` — ${form.address2}` : ""}`,
          ],
        ]}
      />
      <ReviewBlock
        title={t("vendorOnboarding.steps.verification")}
        onEdit={() => onEdit(3)}
        rows={[
          [
            t("vendorOnboarding.step3.documents"),
            String(documentsCount),
          ],
          [t("vendorOnboarding.step3.grace"), graceLabel],
        ]}
      />
      <ReviewBlock
        title={t("vendorOnboarding.steps.terms")}
        onEdit={() => onEdit(4)}
        rows={[
          [t("vendorOnboarding.step4.signature"), form.terms_signature],
          [
            t("vendorOnboarding.step4.version"),
            termsVersion,
          ],
        ]}
      />
      <p className="text-xs text-text-faint">{t("vendorOnboarding.step5.note")}</p>
    </div>
  );
}

function ReviewBlock({ title, rows, onEdit }: { title: string; rows: string[][]; onEdit: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-md border border-border bg-surface-tint p-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-extrabold text-text">{title}</p>
        <button type="button" onClick={onEdit} className="cursor-pointer text-xs font-bold text-action hover:underline">
          {t("common.edit")}
        </button>
      </div>
      <dl className="mt-2 grid gap-1.5 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex flex-col">
            <dt className="text-2xs font-bold text-text-faint">{label}</dt>
            <dd className="truncate text-sm text-text">{value || "—"}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

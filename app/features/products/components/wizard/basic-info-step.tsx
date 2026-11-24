import { useTranslation } from "react-i18next";
import { Input } from "~/components/ui";
import { RichTextEditor } from "~/components/editor/RichTextEditor";
import type { WizardForm } from "./types";

/**
 * Wizard step 1 — basics: bilingual name and full descriptions (rich text). Arabic fields flow RTL naturally; English fields are forced LTR.
 */

export interface BasicInfoStepProps {
  form: WizardForm;
  patch: (partial: Partial<WizardForm>) => void;
}

export function BasicInfoStep({ form, patch }: BasicInfoStepProps) {
  const { t } = useTranslation();
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input id="p_name_ar" required label={t("productWizard.basics.nameAr")} value={form.name_ar} onChange={(e) => patch({ name_ar: e.target.value })} />
        <Input id="p_name_en" required label={t("productWizard.basics.nameEn")} value={form.name_en} dir="ltr" onChange={(e) => patch({ name_en: e.target.value })} />
      </div>
      {/* full descriptions: TinyMCE (formatting, lists, tables, links); stored as
          HTML and sanitized with sanitizeProductHtml wherever it is shown */}
      <RichTextEditor
        id="p_desc_ar"
        label={t("productWizard.basics.descAr")}
        variant="product"
        dir="rtl"
        value={form.desc_ar}
        onChange={(html) => patch({ desc_ar: html })}
      />
      <RichTextEditor
        id="p_desc_en"
        label={t("productWizard.basics.descEn")}
        variant="product"
        dir="ltr"
        value={form.desc_en}
        onChange={(html) => patch({ desc_en: html })}
      />
    </>
  );
}

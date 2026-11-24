import { useTranslation } from "react-i18next";
import { AttributeField } from "./attribute-field";
import type { TemplateAttr, WizardForm } from "./types";

/**
 * Wizard step — specifications: every non-axis attribute of the leaf
 * template (colour/size live on the child products step). Required ones are
 * marked * and checked before moving on.
 */
export function AttributesStep({ template, form, patch, isAr }: {
  template: TemplateAttr[];
  form: WizardForm;
  patch: (partial: Partial<WizardForm>) => void;
  isAr: boolean;
}) {
  const { t } = useTranslation();
  const specs = template.filter((attr) => !attr.is_variant_axis);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-extrabold text-text">{t("productWizard.steps.attributes")}</h2>
        <p className="mt-0.5 text-xs text-text-muted">{t("productWizard.attributes.requiredHint")}</p>
      </div>
      {specs.length === 0 ? <p className="text-sm text-text-muted">{t("productWizard.attributes.noTemplate")}</p> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        {specs.map((attr) => (
          <div key={attr.id} className={attr.type === "bool" ? "sm:col-span-2" : ""}>
            <AttributeField
              attr={attr}
              isAr={isAr}
              value={form.attributes[attr.id] ?? { option_id: "", option_ids: [], value_text: "", value_text_en: "", value_number: "", value_bool: null }}
              onChange={(value) => patch({ attributes: { ...form.attributes, [attr.id]: value } })}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

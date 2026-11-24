import type { useTranslation } from "react-i18next";
import { childProblems, SIZES_MODE, type ChildDraft, type VariantMode } from "./children";
import { attrLabel } from "./helpers";
import type { TemplateAttr, WizardForm } from "./types";
import { choiceIds } from "./helpers";

/**
 * Step-gate validation for the product wizard: the cumulative checks behind
 * "Next"/submit — basics (1), classification+media (2), specifications (3),
 * child products (4). Returns translated error strings for the summary
 * alert; empty array = the gate passes. Pure — no state.
 */

/** The `t` function exactly as `useTranslation` provides it. */
export type Translate = ReturnType<typeof useTranslation>["t"];

export interface ValidateStepArgs {
  /** Cumulative gate: validates every step up to and including `target`. */
  target: number;
  form: WizardForm;
  childList: ChildDraft[];
  template: TemplateAttr[];
  hasColor: boolean;
  hasSize: boolean;
  /** phones / computers: configuration rows (storage + RAM, own prices) */
  mode?: VariantMode;
  isAr: boolean;
  t: Translate;
}

export function validateStep({ target, form, childList, template, hasColor, hasSize, mode = SIZES_MODE, isAr, t }: ValidateStepArgs): string[] {
  const errors: string[] = [];
  if (target >= 1) {
    if (form.name_ar.trim().length < 2 || form.name_en.trim().length < 2) errors.push(t("productWizard.errors.name"));
  }
  if (target >= 2) {
    if (!form.leaf_category_id) errors.push(t("productWizard.errors.category"));
    if (form.media.length === 0) errors.push(t("productWizard.errors.media"));
  }
  if (target >= 3) {
    for (const attr of template) {
      if (!attr.is_variant_axis && attr.is_required) {
        const value = form.attributes[attr.id];
        const filled =
          value &&
          (attr.type === "enum" || attr.type === "color"
            ? choiceIds(attr, value).length > 0
            : attr.type === "number"
              ? value.value_number !== ""
              : attr.type === "bool"
                ? value.value_bool !== null
                : value.value_text !== "" || value.value_text_en !== "");
        if (!filled) errors.push(t("productWizard.errors.attributeRequired", { code: attrLabel(attr, isAr) }));
      }
    }
  }
  if (target >= 4) {
    // no variants and no price yet → ask for the price + stock
    if (childList.length === 0) errors.push(t("children.err.none"));
    childList.forEach((child, index) => {
      for (const key of childProblems(child, childList, hasColor, hasSize, mode)) {
        errors.push(`${t("children.childN", { n: index + 1 })}: ${t(key)}`);
      }
    });
  }
  return errors;
}

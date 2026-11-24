import { useTranslation } from "react-i18next";
import { Input } from "~/components/ui";
import { SelectMenu } from "~/components/ui/SelectMenu";
import { attrLabel, choiceIds } from "./helpers";
import { unitLabel } from "~/lib/units";
import type { TemplateAttr, WizardAttributeValue } from "./types";

/**
 * Attribute form field generated from the leaf template (V-14: vendors pick
 * admin-defined options only — no free-form attributes). Renders the right
 * control per attribute type: enum/color → searchable dropdown (multi-select
 * with checkboxes when the spec allows several options), number → numeric input,
 * bool → checkbox, text → input.
 */

export interface AttributeFieldProps {
  attr: TemplateAttr;
  isAr: boolean;
  value: WizardAttributeValue;
  onChange: (value: WizardAttributeValue) => void;
}

export function AttributeField({ attr, isAr, value, onChange }: AttributeFieldProps) {
  const { t } = useTranslation();
  const label = (
    <>
      {attrLabel(attr, isAr)}
      {unitLabel(attr.unit, isAr ? "ar" : "en") ? <span className="font-normal text-text-faint"> ({unitLabel(attr.unit, isAr ? "ar" : "en")})</span> : null}
    </>
  );

  if (attr.type === "enum" || attr.type === "color") {
    // controlled values: a dropdown (searchable on long lists, e.g. countries),
    // sorted alphabetically when the list is long so it can be scanned
    const options = attr.options.map((option) => ({
      value: option.id,
      label: (isAr ? option.label_ar || option.label_en : option.label_en || option.label_ar) ?? "",
      swatch: attr.type === "color" ? option.color_hex : undefined,
      last: option.code === "other" || option.code === "mixed",
    }));
    // catch-alls ("other", "mixed") stay at the end of an alphabetised list
    if (options.length > 12) options.sort((a, b) => Number(a.last) - Number(b.last) || a.label.localeCompare(b.label, isAr ? "ar" : "en"));
    const fieldLabel = <>{attrLabel(attr, isAr)}{unitLabel(attr.unit, isAr ? "ar" : "en") ? <span className="font-normal text-text-faint"> ({unitLabel(attr.unit, isAr ? "ar" : "en")})</span> : null}</>;
    const chosen = choiceIds(attr, value);
    if (attr.is_multi) {
      return (
        <SelectMenu
          id={`attr_${attr.id}`}
          multiple
          label={fieldLabel}
          required={attr.is_required}
          options={options}
          value={chosen}
          placeholder={t("common.choose")}
          hint={t("productWizard.attributes.multiHint")}
          onChange={(ids) => onChange({ ...value, option_ids: ids, option_id: ids[0] ?? "" })}
        />
      );
    }
    return (
      <SelectMenu
        id={`attr_${attr.id}`}
        label={fieldLabel}
        required={attr.is_required}
        options={options}
        value={chosen[0] ?? null}
        placeholder={t("common.choose")}
        onChange={(v) => onChange({ ...value, option_id: v ?? "", option_ids: v ? [v] : [] })}
      />
    );
  }
  if (attr.type === "number") {
    return (
      <Input
        id={`attr_${attr.id}`}
        label={label}
        required={attr.is_required}
        type="number"
        inputMode="decimal"
        dir="ltr"
        value={value.value_number}
        onChange={(e) => onChange({ ...value, value_number: e.target.value })}
      />
    );
  }
  if (attr.type === "bool") {
    return (
      <label className="flex items-center gap-2 text-sm text-text">
        <input
          id={`attr_${attr.id}`}
          type="checkbox"
          className="size-4 accent-[var(--color-action)]"
          checked={value.value_bool === true}
          onChange={(e) => onChange({ ...value, value_bool: e.target.checked })}
        />
        {attrLabel(attr, isAr)}
      </label>
    );
  }
  // free text is written in both languages: each shopper reads their own
  return (
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      <Input
        id={`attr_${attr.id}`}
        label={<>{label} <span className="text-2xs font-bold text-text-muted">({isAr ? "عربي" : "Arabic"})</span></>}
        required={attr.is_required}
        dir="rtl"
        value={value.value_text}
        onChange={(e) => onChange({ ...value, value_text: e.target.value })}
      />
      <Input
        id={`attr_${attr.id}_en`}
        label={<>{label} <span className="text-2xs font-bold text-text-muted">({isAr ? "إنجليزي" : "English"})</span></>}
        dir="ltr"
        value={value.value_text_en ?? ""}
        onChange={(e) => onChange({ ...value, value_text_en: e.target.value })}
      />
    </div>
  );
}

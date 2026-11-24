/**
 * Create/edit form body for one attribute definition, used by the def dialog
 * of the route `app/routes/admin/catalog/attributes.tsx`. Field `name`s double
 * as the formData keys of the `def_create` / `def_update` action intents —
 * renaming one without the other breaks the action.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/Button";
import { Input } from "~/components/ui/Input";
import { slugifyCode } from "./attributes.shared";
import type { DefRow } from "./attributes.shared";

/** The five attribute types as pickable cards (a <select> hid what they mean). */
const TYPE_CARDS: Array<{ value: DefRow["type"]; titleKey: string; hintKey: string }> = [
  { value: "enum", titleKey: "catalog.typeEnum", hintKey: "catalog.typeEnumHint" },
  { value: "color", titleKey: "catalog.typeColor", hintKey: "catalog.typeColorHint" },
  { value: "bool", titleKey: "catalog.typeBool", hintKey: "catalog.typeBoolHint" },
  { value: "text", titleKey: "catalog.typeText", hintKey: "catalog.typeTextHint" },
  { value: "number", titleKey: "catalog.typeNumber", hintKey: "catalog.typeNumberHint" },
];

/**
 * Create/edit form for one attribute. Split into four visual blocks so the
 * admin knows what each field does: naming, type, behaviour, live preview.
 * The code is derived from the English label and kept in an "advanced" fold —
 * it is a machine key (product_attribute_values, filter URLs), not user copy.
 */
export function AttributeForm({
  mode, def, defs, busy, onCancel,
}: {
  mode: "create" | "edit";
  def: DefRow | null;
  defs: DefRow[];
  busy: boolean;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [labelAr, setLabelAr] = useState(def?.label_ar ?? "");
  const [labelEn, setLabelEn] = useState(def?.label_en ?? "");
  const [type, setType] = useState<DefRow["type"]>(def?.type ?? "enum");
  const [code, setCode] = useState(def?.code ?? "");
  const [codeTouched, setCodeTouched] = useState(mode === "edit");

  // Axis attributes must be enum/color/bool (DB constraint attribute_defs_axis_type),
  // so free text/number hides the axis checkbox instead of failing on save.
  const axisAllowed = type !== "text" && type !== "number";
  const derivedCode = codeTouched ? code : slugifyCode(labelEn);
  const canSave = labelAr.trim().length > 0 && labelEn.trim().length > 0 && derivedCode.length >= 2;

  return (
    <>
      {/* 1 — naming */}
      <section className="flex flex-col gap-2">
        <p className="text-2xs font-black uppercase tracking-wide text-text-faint">{t("catalog.blockNaming")}</p>
        <label className="flex flex-col gap-1 text-sm font-bold text-text">
          {t("catalog.labelAr")}
          <input
            name="label_ar"
            value={labelAr}
            onChange={(e) => setLabelAr(e.target.value)}
            placeholder={t("catalog.labelArPlaceholder")}
            required
            maxLength={60}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus:border-action focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-bold text-text">
          {t("catalog.labelEn")}
          <input
            name="label_en"
            value={labelEn}
            onChange={(e) => setLabelEn(e.target.value)}
            placeholder={t("catalog.labelEnPlaceholder")}
            required
            maxLength={60}
            dir="ltr"
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus:border-action focus:outline-none"
          />
        </label>
        <details className="rounded-md border border-border/60 px-3 py-2">
          <summary className="cursor-pointer text-xs font-bold text-text-muted">{t("catalog.advanced")}</summary>
          <label className="mt-2 flex flex-col gap-1 text-xs font-bold text-text">
            {t("catalog.code")}
            <input
              name="code"
              value={derivedCode}
              onChange={(e) => { setCodeTouched(true); setCode(e.target.value); }}
              pattern="[a-z0-9_]{2,40}"
              dir="ltr"
              readOnly={mode === "edit"}
              className={`rounded-md border border-border px-3 py-2 font-mono text-xs ${mode === "edit" ? "bg-surface-alt text-text-muted" : "bg-surface text-text"}`}
            />
            <span className="font-normal text-text-muted">{t("catalog.codeHint")}</span>
          </label>
        </details>
      </section>

      {/* 2 — type as cards */}
      <section className="mt-4 flex flex-col gap-2">
        <p className="text-2xs font-black uppercase tracking-wide text-text-faint">{t("catalog.blockType")}</p>
        <div role="radiogroup" aria-label={t("catalog.type")} className="grid grid-cols-2 gap-2">
          {TYPE_CARDS.map((card) => (
            <label
              key={card.value}
              className={`flex cursor-pointer flex-col gap-0.5 rounded-md border p-2.5 text-start transition-colors ${
                type === card.value
                  ? "border-action bg-surface-tint"
                  : "border-border bg-surface hover:bg-surface-alt"
              }`}
            >
              <input
                type="radio"
                name="type"
                value={card.value}
                checked={type === card.value}
                onChange={() => setType(card.value)}
                className="sr-only"
              />
              <span className="text-sm font-extrabold text-text">{t(card.titleKey)}</span>
              <span className="text-2xs leading-snug text-text-muted">{t(card.hintKey)}</span>
            </label>
          ))}
        </div>
        {type === "number" ? (
          <Input label={t("catalog.unit")} name="unit" defaultValue={def?.unit ?? ""} maxLength={20} placeholder={t("catalog.unitPlaceholder")} inputClassName="bg-surface" />
        ) : null}
      </section>

      {/* 3 — behaviour */}
      <section className="mt-4 flex flex-col gap-2">
        <p className="text-2xs font-black uppercase tracking-wide text-text-faint">{t("catalog.blockBehaviour")}</p>
        <label className="flex items-start gap-2 rounded-md border border-border bg-surface p-2.5 text-sm font-bold text-text">
          <input type="checkbox" name="is_required" defaultChecked={def?.is_required ?? false} className="mt-0.5 size-4 shrink-0 accent-[var(--color-action)]" />
          <span>
            {t("catalog.required")}
            <span className="block font-normal text-2xs leading-snug text-text-muted">{t("catalog.requiredHint")}</span>
          </span>
        </label>
        <label className="flex items-start gap-2 rounded-md border border-border bg-surface p-2.5 text-sm font-bold text-text">
          <input type="checkbox" name="is_filterable" defaultChecked={def?.is_filterable ?? false} className="mt-0.5 size-4 shrink-0 accent-[var(--color-action)]" />
          <span>
            {t("catalog.filterable")}
            <span className="block font-normal text-2xs leading-snug text-text-muted">{t("catalog.filterableHint")}</span>
          </span>
        </label>
        {type === "enum" ? (
          <label className="flex items-start gap-2 rounded-md border border-border bg-surface p-2.5 text-sm font-bold text-text">
            <input type="checkbox" name="is_multi" defaultChecked={def?.is_multi ?? false} className="mt-0.5 size-4 shrink-0 accent-[var(--color-action)]" />
            <span>
              {t("catalog.multi")}
              <span className="block font-normal text-2xs leading-snug text-text-muted">{t("catalog.multiHint")}</span>
            </span>
          </label>
        ) : null}
        {axisAllowed ? (
          <label className="flex items-start gap-2 rounded-md border border-border bg-surface p-2.5 text-sm font-bold text-text">
            <input type="checkbox" name="is_variant_axis" defaultChecked={def?.is_variant_axis ?? false} className="mt-0.5 size-4 shrink-0 accent-[var(--color-action)]" />
            <span>
              {t("catalog.axis")}
              <span className="block font-normal text-2xs leading-snug text-text-muted">{t("catalog.axisHint")}</span>
            </span>
          </label>
        ) : (
          <p className="rounded-md border border-dashed border-border px-2.5 py-2 text-2xs leading-snug text-text-muted">
            {t("catalog.axisNotAllowed")}
          </p>
        )}
      </section>

      {/* 4 — live preview */}
      <section className="mt-4 rounded-md border border-border bg-surface-alt p-3">
        <p className="text-2xs font-black uppercase tracking-wide text-text-faint">{t("catalog.blockPreview")}</p>
        <div className="mt-1.5 flex flex-col gap-1">
          <span className="text-sm font-bold text-text">
            {labelAr || t("catalog.labelAr")}
            <span className="text-danger" aria-hidden="true"> *</span>
          </span>
          <span className="text-2xs text-text-muted">
            {type === "enum" || type === "color" ? t("catalog.previewPick") : type === "bool" ? t("catalog.typeBool") : type === "number" ? `0 ${def?.unit || ""}`.trim() : "…"}
          </span>
        </div>
      </section>

      <input type="hidden" name="sort" value={def?.sort ?? defs.length} />
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>{t("common.cancel")}</Button>
        <Button type="submit" loading={busy} disabled={!canSave}>{t("common.save")}</Button>
      </div>
    </>
  );
}

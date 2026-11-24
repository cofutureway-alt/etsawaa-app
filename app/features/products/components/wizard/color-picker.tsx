import { useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { Button, Input } from "~/components/ui";
import { PlusIcon } from "~/components/ui/icons";
import { SelectMenu } from "~/components/ui/SelectMenu";
import type { TemplateOption } from "./types";

/**
 * Variant colour picker: a searchable dropdown with a swatch beside every
 * name (colours another variant uses are listed but disabled), plus a
 * "custom colour" link that opens the device's own colour picker and a name.
 */

/** Swatch fill: the hex, or a pattern for multicolour / printed / transparent. */
export function swatchStyle(c: Pick<TemplateOption, "color_hex" | "code">): CSSProperties {
  if (c.color_hex) return { backgroundColor: c.color_hex };
  if (c.code === "multicolor") return { background: "conic-gradient(#e53935, #fbc02d, #43a047, #1e88e5, #8e24aa, #e53935)" };
  if (c.code === "printed") return { background: "repeating-linear-gradient(45deg, #6d4c41 0 4px, #d7ccc8 4px 8px)" };
  if (c.code === "transparent") return { background: "repeating-conic-gradient(#d9d9d9 0 25%, #ffffff 0 50%) 0 0 / 10px 10px" };
  return { background: "var(--color-surface-tint)" };
}


export function ColorPicker({
  label, colors, value, taken, isAr, onChange, onCreate, creating, createError, required = true,
}: {
  label: string;
  colors: TemplateOption[];
  value: string;
  /** colour ids another variant already uses */
  taken: Set<string>;
  isAr: boolean;
  onChange: (id: string) => void;
  /** add a custom colour (hex + name); the parent selects it once created */
  /** a seller's own colour, named in Arabic and English */
  onCreate: (hex: string, name: string, nameEn: string) => void;
  creating: boolean;
  createError?: string | null;
  /** base offer: colour is optional */
  required?: boolean;
}) {
  const { t } = useTranslation();
  const name = (c: TemplateOption) => (isAr ? c.label_ar || c.label_en : c.label_en || c.label_ar);
  const [custom, setCustom] = useState(false);
  const [hex, setHex] = useState("#6D4C41");
  const [customName, setCustomName] = useState("");
  const [customNameEn, setCustomNameEn] = useState("");
  const options = colors.map((c) => {
    const isTaken = taken.has(c.id) && c.id !== value;
    return { value: c.id, label: isTaken ? `${name(c)} — ${t("children.colorTaken")}` : name(c), swatch: c.color_hex, disabled: isTaken };
  });

  return (
    <div className="flex flex-col gap-2">
      <SelectMenu
        required={required}
        searchable
        label={label}
        options={options}
        value={value || null}
        placeholder={t("children.pickColor")}
        onChange={(v) => onChange(v ?? "")}
      />
      <button type="button" onClick={() => setCustom((v) => !v)} aria-expanded={custom}
        className="flex w-fit cursor-pointer items-center gap-1 text-xs font-extrabold text-action hover:underline">
        <PlusIcon className="size-3.5" />{t("children.customColor")}
      </button>

      {custom ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3 sm:flex-row sm:items-end">
          <label className="flex flex-col gap-1.5 text-sm font-bold text-text">
            {t("children.customColorPick")}
            <span className="flex items-center gap-2">
              <input type="color" value={hex} onChange={(e) => setHex(e.target.value.toUpperCase())}
                aria-label={t("children.customColorPick")}
                className="h-11 w-16 cursor-pointer rounded-md border border-border bg-surface p-1" />
              <span className="num text-xs font-bold text-text-muted" dir="ltr">{hex}</span>
            </span>
          </label>
          <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
            <Input id="custom-color-name" label={t("children.customColorName")} value={customName} maxLength={40} dir="rtl"
              placeholder={t("children.customColorNamePh")} onChange={(e) => setCustomName(e.target.value)}
              error={createError ?? undefined} />
            <Input id="custom-color-name-en" label={t("children.customColorNameEn")} value={customNameEn} maxLength={40} dir="ltr"
              placeholder="Navy" onChange={(e) => setCustomNameEn(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => setCustom(false)}>{t("common.cancel")}</Button>
            <Button type="button" loading={creating} disabled={customName.trim().length < 2}
              onClick={() => { onCreate(hex, customName.trim(), customNameEn.trim()); setCustom(false); setCustomName(""); setCustomNameEn(""); }}>
              {t("children.customColorAdd")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

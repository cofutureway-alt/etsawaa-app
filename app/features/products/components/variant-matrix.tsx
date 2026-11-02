import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import { MediaImage, MediaPickerDialog } from "~/features/media/components/media-ui";
import type { MediaSettings } from "~/lib/media.shared";

/**
 * VariantMatrixEditor (V-16): one row per generated combination — SKU, price,
 * sale, stock, image — desktop table that becomes cards on phones (G5).
 * Rows are memoized so a 100-row matrix stays smooth while typing.
 */

export interface VariantMatrixRow {
  id?: string;
  option_key: string;
  option_ids: string[];
  labels: string[];
  color?: string | null;
  sku: string;
  price: string; // EGP decimal string in the form; converted to piastres on save
  sale_price: string;
  stock: string;
  image_path: string;
  is_active: boolean;
}

const CELL_CLASS =
  "w-full rounded-m border border-border bg-surface px-2.5 py-2 text-[13px] text-text outline-none transition-colors duration-150 placeholder:text-text-faint focus:shadow-focus";

export interface VariantMatrixProps {
  rows: VariantMatrixRow[];
  settings: MediaSettings;
  uid: string;
  supabaseUrl: string;
  onChange: (index: number, patch: Partial<VariantMatrixRow>) => void;
  onRestore: (optionKey: string) => void;
  skippedKeys: string[];
}

export function VariantMatrixEditor({
  rows,
  settings,
  uid,
  supabaseUrl,
  onChange,
  onRestore,
  skippedKeys,
}: VariantMatrixProps) {
  const { t } = useTranslation();

  if (rows.length === 0 && skippedKeys.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] font-extrabold text-text">
        {t("productWizard.variants.matrixTitle", { count: rows.length })}
      </p>

      {skippedKeys.length > 0 ? (
        <div className="rounded-m border border-warning/40 bg-warning-soft p-3 text-[12px] leading-relaxed text-text">
          <p className="font-extrabold text-warning-strong">{t("productWizard.variants.skippedTitle")}</p>
          <p className="mt-1 text-text-muted">{t("productWizard.variants.skippedBody")}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {skippedKeys.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => onRestore(key)}
                className="cursor-pointer rounded-full border border-warning/50 bg-surface px-2.5 py-1 text-[11px] font-bold text-warning-strong hover:bg-surface-tint"
              >
                {t("productWizard.variants.restoreOne")}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* desktop table (md+) */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[900px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border text-text-muted">
              <th scope="col" className="p-2 text-start font-bold">{t("productWizard.variants.combo")}</th>
              <th scope="col" className="w-44 p-2 text-start font-bold">{t("productWizard.variants.sku")}</th>
              <th scope="col" className="w-28 p-2 text-start font-bold">{t("productWizard.variants.price")}</th>
              <th scope="col" className="w-28 p-2 text-start font-bold">{t("productWizard.variants.sale")}</th>
              <th scope="col" className="w-24 p-2 text-start font-bold">{t("productWizard.variants.stock")}</th>
              <th scope="col" className="w-20 p-2 text-start font-bold">{t("productWizard.variants.image")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <MatrixRow
                key={row.option_key}
                row={row}
                index={index}
                settings={settings}
                uid={uid}
                supabaseUrl={supabaseUrl}
                onChange={onChange}
                layout="table"
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* mobile cards (G5: matrix becomes cards on phones) */}
      <div className="flex flex-col gap-2.5 md:hidden">
        {rows.map((row, index) => (
          <MatrixRow
            key={row.option_key}
            row={row}
            index={index}
            settings={settings}
            uid={uid}
            supabaseUrl={supabaseUrl}
            onChange={onChange}
            layout="card"
          />
        ))}
      </div>
    </div>
  );
}

interface MatrixRowProps {
  row: VariantMatrixRow;
  index: number;
  settings: MediaSettings;
  uid: string;
  supabaseUrl: string;
  onChange: (index: number, patch: Partial<VariantMatrixRow>) => void;
  layout: "table" | "card";
}

const MatrixRow = memo(function MatrixRow({
  row,
  index,
  settings,
  uid,
  supabaseUrl,
  onChange,
  layout,
}: MatrixRowProps) {
  const { t } = useTranslation();
  const [pickerOpen, setPickerOpen] = useState(false);
  const comboLabel = row.labels.join(" / ");

  const imageField = (
    <VariantImageField
      row={row}
      index={index}
      settings={settings}
      uid={uid}
      supabaseUrl={supabaseUrl}
      onChange={onChange}
      open={pickerOpen}
      setOpen={setPickerOpen}
    />
  );

  if (layout === "table") {
    return (
      <tr className="border-b border-border align-middle">
        <td className="p-2">
          <div className="flex items-center gap-2">
            {row.color ? (
              <span aria-hidden="true" className="size-4 shrink-0 rounded-full border border-border" style={{ backgroundColor: row.color }} />
            ) : null}
            <span className="text-[12px] font-bold text-text">{comboLabel}</span>
          </div>
        </td>
        <td className="p-2">
          <input
            className={CELL_CLASS}
            value={row.sku}
            dir="ltr"
            aria-label={`${comboLabel} — SKU`}
            onChange={(e) => onChange(index, { sku: e.target.value })}
          />
        </td>
        <td className="p-2">
          <input
            className={CELL_CLASS}
            value={row.price}
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            dir="ltr"
            aria-label={`${comboLabel} — ${t("productWizard.variants.price")}`}
            onChange={(e) => onChange(index, { price: e.target.value })}
          />
        </td>
        <td className="p-2">
          <input
            className={CELL_CLASS}
            value={row.sale_price}
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            dir="ltr"
            aria-label={`${comboLabel} — ${t("productWizard.variants.sale")}`}
            onChange={(e) => onChange(index, { sale_price: e.target.value })}
          />
        </td>
        <td className="p-2">
          <input
            className={CELL_CLASS}
            value={row.stock}
            type="number"
            inputMode="numeric"
            min="0"
            dir="ltr"
            aria-label={`${comboLabel} — ${t("productWizard.variants.stock")}`}
            onChange={(e) => onChange(index, { stock: e.target.value })}
          />
        </td>
        <td className="p-2">{imageField}</td>
      </tr>
    );
  }

  return (
    <div className="rounded-l border border-border bg-surface p-3">
      <div className="flex items-center gap-2">
        {row.color ? (
          <span aria-hidden="true" className="size-4 shrink-0 rounded-full border border-border" style={{ backgroundColor: row.color }} />
        ) : null}
        <p className="text-[13px] font-extrabold text-text">{comboLabel}</p>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-[11px] font-bold text-text-faint">
          {t("productWizard.variants.sku")}
          <input
            className={CELL_CLASS}
            value={row.sku}
            dir="ltr"
            onChange={(e) => onChange(index, { sku: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-bold text-text-faint">
          {t("productWizard.variants.price")}
          <input
            className={CELL_CLASS}
            value={row.price}
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            dir="ltr"
            onChange={(e) => onChange(index, { price: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-bold text-text-faint">
          {t("productWizard.variants.sale")}
          <input
            className={CELL_CLASS}
            value={row.sale_price}
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            dir="ltr"
            onChange={(e) => onChange(index, { sale_price: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-bold text-text-faint">
          {t("productWizard.variants.stock")}
          <input
            className={CELL_CLASS}
            value={row.stock}
            type="number"
            inputMode="numeric"
            min="0"
            dir="ltr"
            onChange={(e) => onChange(index, { stock: e.target.value })}
          />
        </label>
      </div>
      <div className="mt-2">{imageField}</div>
    </div>
  );
});

function VariantImageField({
  row,
  index,
  settings,
  uid,
  supabaseUrl,
  onChange,
  open,
  setOpen,
}: {
  row: VariantMatrixRow;
  index: number;
  settings: MediaSettings;
  uid: string;
  supabaseUrl: string;
  onChange: (index: number, patch: Partial<VariantMatrixRow>) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex size-11 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-m border border-border bg-surface-tint"
        aria-label={t("media.picker.choose")}
      >
        {row.image_path ? (
          <MediaImage path={row.image_path} alt="" width={44} height={44} supabaseUrl={supabaseUrl} className="size-full object-cover" />
        ) : (
          <span className="text-[10px] text-text-faint">+</span>
        )}
      </button>
      {row.image_path ? (
        <button
          type="button"
          onClick={() => onChange(index, { image_path: "" })}
          className="cursor-pointer text-[11px] font-bold text-danger hover:underline"
        >
          {t("common.remove")}
        </button>
      ) : null}
      <MediaPickerDialog
        open={open}
        onClose={() => setOpen(false)}
        title={t("productWizard.variants.image")}
        settings={settings}
        uid={uid}
        supabaseUrl={supabaseUrl}
        mode="single"
        kinds={["image"]}
        onConfirm={(files) => {
          if (files[0]) onChange(index, { image_path: files[0].path });
        }}
      />
    </div>
  );
}

import { useTranslation } from "react-i18next";
import type { ProductPage } from "~/features/storefront/api";
import { CheckIcon } from "~/components/ui/icons";

/**
 * Variant selector (S-05 / US-05): one group per axis, in template order.
 * Impossible combinations (no live in-stock variant for the current
 * selection + this option) are DISABLED with an out-of-stock tooltip —
 * never hidden (disabled-state rule: reduced opacity + cursor, not removal).
 */
export function VariantSelector({
  axes,
  variants,
  selected,
  lang,
  onSelect,
}: {
  axes: ProductPage["axes"];
  variants: ProductPage["variants"];
  selected: Map<string, string>;
  lang: "ar" | "en";
  onSelect: (attributeId: string, optionId: string) => void;
}) {
  const { t } = useTranslation();

  const optionAvailable = (axisId: string, optionId: string): boolean => {
    // a candidate selection = current picks with this axis resolved to the candidate
    return variants.some((variant) => {
      if (variant.stock <= 0) return false;
      const ids = variant.option_ids ?? [];
      if (!ids.includes(optionId)) return false;
      for (const [otherAxis, otherOption] of selected) {
        if (otherAxis === axisId) continue;
        if (otherOption && !ids.includes(otherOption)) return false;
      }
      return true;
    });
  };

  if (axes.length === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      {axes.map((axis) => {
        const current = selected.get(axis.attribute_id) ?? "";
        return (
          <fieldset key={axis.attribute_id} className="min-w-0">
            <legend className="mb-2 text-[13px] font-extrabold text-text">
              {t("store.product.selectAxis", { axis: lang === "ar" ? axis.label_ar : axis.label_en })}:
            </legend>
            <div className="flex flex-wrap gap-2">
              {axis.options.map((option) => {
                const active = current === option.id;
                const available = optionAvailable(axis.attribute_id, option.id);
                const label = t("store.product.optionState", {
                  option: lang === "ar" ? option.label_ar : option.label_en,
                });
                return (
                  <button
                    key={option.id}
                    type="button"
                    disabled={!available}
                    aria-pressed={active}
                    title={available ? label : t("store.product.outOfStockOption")}
                    onClick={() => onSelect(axis.attribute_id, option.id)}
                    className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-md border-2 px-3 py-2 text-[13px] font-bold transition-colors duration-150 ${
                      active
                        ? "border-action bg-surface-tint text-action"
                        : available
                          ? "border-border bg-surface text-text hover:border-border-strong"
                          : "cursor-not-allowed border-border bg-surface text-text-muted opacity-50"
                    }`}
                  >
                    {axis.type === "color" && option.color_hex ? (
                      <span
                        aria-hidden="true"
                        className="size-4 rounded-full border border-border"
                        style={{ backgroundColor: option.color_hex }}
                      />
                    ) : null}
                    <span>{lang === "ar" ? option.label_ar : option.label_en}</span>
                    {active ? <CheckIcon aria-hidden="true" className="size-3.5" /> : null}
                  </button>
                );
              })}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}

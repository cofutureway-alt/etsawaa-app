import type { PickerCategory, TemplateAttr, WizardForm, WizardProduct } from "./types";
import { parseChart } from "~/features/products/size-chart";

/**
 * Pure helpers for the product wizard: label resolution, money conversion
 * (EGP decimal strings <-> piastres integers) and form hydration from the
 * loader product. Child-product state lives in `./children`. No React, no
 * side effects.
 */

/**
 * The options a form value holds for an enum/colour spec, limited to the ones
 * the category still offers (a value saved before the admin narrowed the list
 * is dropped instead of being sent back and rejected), single specs keep one.
 */
export function choiceIds(attr: Pick<TemplateAttr, "options" | "is_multi">, value: { option_id: string; option_ids?: string[] } | undefined): string[] {
  if (!value) return [];
  const offered = new Set(attr.options.map((o) => o.id));
  const raw = value.option_ids?.length ? value.option_ids : value.option_id ? [value.option_id] : [];
  const ids = [...new Set(raw)].filter((id) => offered.has(id));
  return attr.is_multi ? ids : ids.slice(0, 1);
}

/** Human label of a template attribute (falls back to its code). */
export function attrLabel(attr: Pick<TemplateAttr, "label_ar" | "label_en" | "code">, isAr: boolean): string {
  return (isAr ? attr.label_ar : attr.label_en) || attr.code;
}

/** piastres → "12.50" for inputs ("" for null). */
export function piastresToEgp(value: number | null): string {
  return value == null ? "" : (value / 100).toFixed(2);
}

/** "12.5" → 1250; null for empty, non-numeric or non-positive input. */
export function egpToPiastres(value: string): number | null {
  const n = Number(String(value).replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

/** Loader product (or null for a new one) → the wizard's form state. */
export function formFromProduct(product: WizardProduct | null): WizardForm {
  const attributes: WizardForm["attributes"] = {};
  for (const value of product?.attribute_values ?? []) {
    attributes[value.attribute_id] = {
      option_id: value.option_id ?? "",
      option_ids: value.option_ids?.length ? value.option_ids : value.option_id ? [value.option_id] : [],
      value_text: value.value_text ?? "",
      value_text_en: value.value_text_en ?? "",
      value_number: value.value_number === null ? "" : String(value.value_number),
      value_bool: value.value_bool,
    };
  }
  return {
    name_ar: product?.name_ar ?? "",
    name_en: product?.name_en ?? "",
    desc_ar: product?.desc_ar ?? "",
    desc_en: product?.desc_en ?? "",
    short_ar: product?.short_ar ?? "",
    short_en: product?.short_en ?? "",
    leaf_category_id: product?.leaf_category_id ?? "",
    brand_id: product?.brand_id ?? "",
    tag_ids: product?.tag_ids ?? [],
    media: product?.media ?? [],
    is_fragile: product?.is_fragile ?? false,
    attributes,
    weight_g: product?.weight_g !== null && product?.weight_g !== undefined ? String(product.weight_g) : "",
    dims_l: product?.dims?.l_cm ? String(product.dims.l_cm) : "",
    dims_w: product?.dims?.w_cm ? String(product.dims.w_cm) : "",
    dims_h: product?.dims?.h_cm ? String(product.dims.h_cm) : "",
    shipping_class: product?.shipping_class ?? "standard",
    // platform shipping is the default for every new product
    shipping_mode: product?.shipping_mode ?? "platform",
    size_chart: parseChart(product?.size_chart ?? null),
  };
}

/** Category name for the review summary ("—" when unknown). */
export function categoryLabel(categories: PickerCategory[], id: string, isAr: boolean): string {
  const category = categories.find((c) => c.id === id);
  return category ? (isAr ? category.name_ar : category.name_en) : "—";
}

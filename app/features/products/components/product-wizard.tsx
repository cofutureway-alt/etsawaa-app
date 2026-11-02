import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  Card,
  CardBody,
  Dialog,
  Input,
  Select,
  Stepper,
  useToast,
} from "~/components/ui";
import { MediaImage, MediaPickerDialog } from "~/features/media/components/media-ui";
import { combinationCount, optionKeyOf, type AxisSelection } from "../variant";
import { VariantMatrixEditor, type VariantMatrixRow } from "./variant-matrix";
import type { MediaSettings } from "~/lib/media.shared";

/**
 * Product wizard (V-11..V-17): 5 steps — basics · classification/media ·
 * pricing · attributes+variants (template-generated) · shipping/review.
 * Autosave drafts via `fn_save_product`; variants via `fn_generate_variants`
 * / `fn_save_variants`. The form is generated from the leaf template —
 * vendors pick admin options only (AGENT §6.8).
 */

export interface TemplateOption {
  id: string;
  label_ar: string;
  label_en: string;
  color_hex: string | null;
}
export interface TemplateAttr {
  id: string;
  code: string;
  type: "text" | "number" | "bool" | "enum" | "color";
  unit: string;
  is_required: boolean;
  is_filterable: boolean;
  is_variant_axis: boolean;
  sort: number;
  options: TemplateOption[];
}
export interface PickerCategory {
  id: string;
  parent_id: string | null;
  depth: number;
  name_ar: string;
  name_en: string;
}
export interface LoaderVariant {
  id: string;
  option_key: string;
  option_ids: string[];
  sku: string | null;
  price_piastres: number | null;
  sale_price_piastres: number | null;
  stock: number;
  image_path: string | null;
}

export interface WizardProduct {
  id: string | null;
  status: string;
  rejection_reason: string | null;
  name_ar: string;
  name_en: string;
  desc_ar: string;
  desc_en: string;
  short_ar: string;
  short_en: string;
  leaf_category_id: string | null;
  brand_id: string | null;
  is_fragile: boolean;
  sale_starts_at: string | null;
  sale_ends_at: string | null;
  weight_g: number | null;
  dims: { l_cm: number | null; w_cm: number | null; h_cm: number | null };
  shipping_class: string;
  shipping_mode: "platform" | "vendor";
  updated_at: string;
  media: Array<{ kind: "image" | "video"; path: string }>;
  tag_ids: string[];
  attribute_values: Array<{ attribute_id: string; option_id: string | null; value_text: string | null; value_number: number | null; value_bool: boolean | null }>;
}

export interface WizardForm {
  name_ar: string;
  name_en: string;
  desc_ar: string;
  desc_en: string;
  short_ar: string;
  short_en: string;
  leaf_category_id: string;
  brand_id: string;
  tag_ids: string[];
  media: Array<{ kind: "image" | "video"; path: string }>;
  is_fragile: boolean;
  price: string;
  sale_price: string;
  sale_starts_at: string;
  sale_ends_at: string;
  attributes: Record<string, { option_id: string; value_text: string; value_number: string; value_bool: boolean | null }>;
  axes: Record<string, string[]>;
  weight_g: string;
  dims_l: string;
  dims_w: string;
  dims_h: string;
  shipping_class: string;
  shipping_mode: "platform" | "vendor";
}

const STEP_KEYS = [
  "productWizard.steps.basics",
  "productWizard.steps.classification",
  "productWizard.steps.pricing",
  "productWizard.steps.attributes",
  "productWizard.steps.shipping",
] as const;

export function piastresToEgp(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return (value / 100).toFixed(2);
}
export function egpToPiastres(value: string): number | null {
  const n = Number(String(value).replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

function formFromProduct(product: WizardProduct | null): WizardForm {
  const attributes: WizardForm["attributes"] = {};
  for (const value of product?.attribute_values ?? []) {
    attributes[value.attribute_id] = {
      option_id: value.option_id ?? "",
      value_text: value.value_text ?? "",
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
    price: "",
    sale_price: "",
    sale_starts_at: product?.sale_starts_at ? product.sale_starts_at.slice(0, 16) : "",
    sale_ends_at: product?.sale_ends_at ? product.sale_ends_at.slice(0, 16) : "",
    attributes,
    axes: {},
    weight_g: product?.weight_g !== null && product?.weight_g !== undefined ? String(product.weight_g) : "",
    dims_l: product?.dims?.l_cm ? String(product.dims.l_cm) : "",
    dims_w: product?.dims?.w_cm ? String(product.dims.w_cm) : "",
    dims_h: product?.dims?.h_cm ? String(product.dims.h_cm) : "",
    shipping_class: product?.shipping_class ?? "standard",
    shipping_mode: product?.shipping_mode ?? "platform",
  };
}

function rowsFromLoader(variants: LoaderVariant[], template: TemplateAttr[]): VariantMatrixRow[] {
  const optionById = new Map<string, TemplateOption>();
  for (const attr of template) for (const opt of attr.options) optionById.set(opt.id, opt);
  return variants.map((variant) => {
    const labels: string[] = [];
    let color: string | null = null;
    for (const optionId of variant.option_ids) {
      const option = optionById.get(optionId);
      if (option) {
        labels.push(option.label_ar);
        if (option.color_hex) color = option.color_hex;
      }
    }
    return {
      id: variant.id,
      option_key: variant.option_key,
      option_ids: variant.option_ids,
      labels: labels.length > 0 ? labels : ["—"],
      color,
      sku: variant.sku ?? "",
      price: piastresToEgp(variant.price_piastres),
      sale_price: piastresToEgp(variant.sale_price_piastres),
      stock: String(variant.stock),
      image_path: variant.image_path ?? "",
      is_active: true,
    };
  });
}

export interface ProductWizardProps {
  uid: string;
  supabaseUrl: string;
  media: MediaSettings;
  product: WizardProduct | null;
  template: TemplateAttr[];
  categories: PickerCategory[];
  brands: Array<{ id: string; name_ar: string; name_en: string }>;
  tags: Array<{ id: string; name_ar: string; name_en: string }>;
  variants: LoaderVariant[];
  isAr: boolean;
}

export function ProductWizard({
  uid,
  supabaseUrl,
  media,
  product,
  template,
  categories,
  brands,
  tags,
  variants,
  isAr,
}: ProductWizardProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const save = useFetcher<SaveActionData>();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<WizardForm>(() => formFromProduct(product));
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [stepErrors, setStepErrors] = useState<string[]>([]);
  const [rows, setRows] = useState<VariantMatrixRow[]>(() => rowsFromLoader(variants, template));
  const [skippedKeys, setSkippedKeys] = useState<string[]>([]);
  const [confirmGenerate, setConfirmGenerate] = useState<null | { removed: number }>(null);
  const [galleryPicker, setGalleryPicker] = useState(false);
  const submitRef = useRef<HTMLDivElement>(null);

  const productId = product?.id ?? null;
  const isRejected = product?.status === "rejected";
  // V-17: only drafts and rejected products are editable — pending/approved
  // open as read-only review (autosave off, submit hidden).
  const editable = !product || product.status === "draft" || product.status === "rejected";

  const axesSelections: AxisSelection[] = useMemo(
    () =>
      template
        .filter((attr) => attr.is_variant_axis)
        .filter((attr) => (form.axes[attr.id] ?? []).length > 0)
        .map((attr) => ({ attribute_id: attr.id, option_ids: form.axes[attr.id] ?? [] })),
    [template, form.axes],
  );
  const comboCount = combinationCount(axesSelections);
  const anyAxisSelected = template.some((attr) => attr.is_variant_axis && (form.axes[attr.id] ?? []).length > 0);

  const applyDefaultsPending = useRef(false);
  // staleness base: advanced after every successful save so consecutive
  // autosaves in THIS session never flag themselves as two-tab conflicts
  const baseUpdatedRef = useRef(product?.updated_at ?? "");
  const patch = (partial: Partial<WizardForm>) => {
    if ("price" in partial || "sale_price" in partial) applyDefaultsPending.current = true;
    setForm((current) => ({ ...current, ...partial }));
    setDirty(true);
  };

  /* autosave (debounced) — the draft survives refresh and re-login (V-17) */
  const timer = useRef<number | null>(null);
  useEffect(() => {
    if (!dirty || !editable) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      save.submit(
        { intent: "save", productId: productId ?? "", payload: JSON.stringify(payloadOf(form)), baseUpdatedAt: baseUpdatedRef.current },
        { method: "post" },
      );
      setDirty(false);
    }, 1200);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, dirty, editable]);

  useEffect(() => {
    if (save.state !== "idle" || !save.data) return;
    if (save.data.intent === "generate_variants") {
      setSkippedKeys(save.data.skipped ?? []);
      if (save.data.ok) toast.showToast("success", t("productWizard.variants.generated"));
      else toast.showToast("error", t("errors.generic"));
      return;
    }
    if (save.data.intent === "save_variants") {
      if (save.data.ok) toast.showToast("success", t("productWizard.variants.rowsSaved"));
      else toast.showToast("error", t("productWizard.errors.saveVariants"));
      return;
    }
    if (save.data.intent === "save") {
      if (save.data.ok) {
        applyDefaultsPending.current = false;
        if (save.data.updatedAt) baseUpdatedRef.current = save.data.updatedAt;
        setSavedAt(new Date().toISOString());
        if (save.data.stale) setStale(true);
        if (save.data.redirectTo) navigate(save.data.redirectTo, { replace: true });
      } else {
        toast.showToast("error", t("errors.generic"));
      }
      return;
    }
    if (save.data.intent === "submit") {
      if (save.data.ok && save.data.redirectTo) navigate(save.data.redirectTo, { replace: true });
      else if (!save.data.ok) toast.showToast("error", t("productWizard.errors.submitBlocked"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [save.state]);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (dirty || save.state !== "idle") event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty, save.state]);

  /* variants refresh after generate/restore (loader revalidation) */
  const loaderStamp = useRef("");
  useEffect(() => {
    const stamp = `${variants.length}:${variants.map((v) => v.id).join(",")}`;
    if (loaderStamp.current === "") {
      loaderStamp.current = stamp;
      return;
    }
    if (loaderStamp.current !== stamp) {
      loaderStamp.current = stamp;
      setRows(rowsFromLoader(variants, template));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variants]);

  function payloadOf(current: WizardForm): Record<string, unknown> {
    const attributes = template
      .map((attr) => {
        const value = current.attributes[attr.id];
        if (!value) return null;
        if (attr.type === "enum" || attr.type === "color") {
          return value.option_id ? { attribute_id: attr.id, option_id: value.option_id } : null;
        }
        if (attr.type === "number") {
          return value.value_number !== "" ? { attribute_id: attr.id, value_number: value.value_number } : null;
        }
        if (attr.type === "bool") {
          return value.value_bool !== null ? { attribute_id: attr.id, value_bool: value.value_bool } : null;
        }
        return value.value_text !== "" ? { attribute_id: attr.id, value_text: value.value_text } : null;
      })
      .filter(Boolean);
    const price = egpToPiastres(current.price);
    const sale = egpToPiastres(current.sale_price);
    return {
      name_ar: current.name_ar,
      name_en: current.name_en,
      desc_ar: current.desc_ar,
      desc_en: current.desc_en,
      short_ar: current.short_ar,
      short_en: current.short_en,
      leaf_category_id: current.leaf_category_id || undefined,
      brand_id: current.brand_id || undefined,
      tag_ids: current.tag_ids,
      is_fragile: current.is_fragile,
      media: current.media,
      sale_starts_at: current.sale_starts_at ? new Date(current.sale_starts_at).toISOString() : "",
      sale_ends_at: current.sale_ends_at ? new Date(current.sale_ends_at).toISOString() : "",
      attributes,
      weight_g: current.weight_g === "" ? null : Number(current.weight_g),
      dims: {
        l_cm: current.dims_l === "" ? null : Number(current.dims_l),
        w_cm: current.dims_w === "" ? null : Number(current.dims_w),
        h_cm: current.dims_h === "" ? null : Number(current.dims_h),
      },
      shipping_class: current.shipping_class,
      shipping_mode: current.shipping_mode,
      ...(price ? { default_price_piastres: price } : {}),
      ...(sale ? { default_sale_piastres: sale } : {}),
      apply_defaults: applyDefaultsPending.current,
    };
  }

  function validateStep(target: number): string[] {
    const errors: string[] = [];
    if (target >= 1) {
      if (form.name_ar.trim().length < 2 || form.name_en.trim().length < 2) errors.push(t("productWizard.errors.name"));
    }
    if (target >= 2) {
      if (!form.leaf_category_id) errors.push(t("productWizard.errors.category"));
      if (form.media.length === 0) errors.push(t("productWizard.errors.media"));
    }
    if (target >= 3) {
      if (rows.length <= 1) {
        const priceNow = egpToPiastres(form.price) ?? (rows[0] ? egpToPiastres(rows[0].price) : null);
        const saleNow = egpToPiastres(form.sale_price) ?? (rows[0] ? egpToPiastres(rows[0].sale_price) : null);
        if (!priceNow) errors.push(t("productWizard.errors.price"));
        if (saleNow !== null && priceNow !== null && saleNow >= priceNow) {
          errors.push(t("productWizard.errors.saleLower"));
        }
      }
      if (form.sale_starts_at && form.sale_ends_at && new Date(form.sale_ends_at) <= new Date(form.sale_starts_at)) {
        errors.push(t("productWizard.errors.schedule"));
      }
    }
    if (target >= 4) {
      for (const attr of template) {
        if (!attr.is_variant_axis && attr.is_required) {
          const value = form.attributes[attr.id];
          const filled =
            value &&
            (attr.type === "enum" || attr.type === "color"
              ? value.option_id !== ""
              : attr.type === "number"
                ? value.value_number !== ""
                : attr.type === "bool"
                  ? value.value_bool !== null
                  : value.value_text !== "");
          if (!filled) errors.push(t("productWizard.errors.attributeRequired", { code: attr.code }));
        }
      }
      if (anyAxisSelected) {
        for (const attr of template.filter((a) => a.is_variant_axis)) {
          if ((form.axes[attr.id] ?? []).length === 0) errors.push(t("productWizard.errors.axisEmpty", { code: attr.code }));
        }
      }
      if (rows.some((row) => row.sku.trim() === "")) errors.push(t("productWizard.errors.sku"));
      if (rows.some((row) => !egpToPiastres(row.price))) errors.push(t("productWizard.errors.rowPrice"));
      const skuSet = new Set(rows.map((row) => row.sku.trim()).filter(Boolean));
      if (skuSet.size !== rows.filter((row) => row.sku.trim() !== "").length) errors.push(t("productWizard.errors.skuDup"));
    }
    return errors;
  }

  function goNext() {
    const errors = validateStep(step);
    if (errors.length > 0) {
      setStepErrors(errors);
      submitRef.current?.scrollIntoView({ block: "center" });
      return;
    }
    setStepErrors([]);
    setDirty(true);
    setStep((s) => Math.min(s + 1, 5));
  }

  function requestGenerate() {
    if (!productId) {
      toast.showToast("error", t("productWizard.errors.saveFirst"));
      return;
    }
    // how many live rows fall outside the desired set? (they get tombstoned)
    const desired = new Set(
      (axesSelections.length === 0 ? [[""]] : combinationKeys(axesSelections)).map((combo) => optionKeyOf(combo)),
    );
    const removed = rows.filter((row) => !desired.has(row.option_key)).length;
    if (removed > 0) {
      setConfirmGenerate({ removed });
    } else {
      void generate();
    }
  }

  function combinationKeys(axes: AxisSelection[]): string[][] {
    let combos: string[][] = [[]];
    for (const axis of axes) {
      const next: string[][] = [];
      for (const combo of combos) {
        for (const optionId of axis.option_ids) next.push([...combo, optionId].sort());
      }
      combos = next;
    }
    return combos;
  }

  async function generate() {
    setConfirmGenerate(null);
    save.submit(
      {
        intent: "generate_variants",
        productId: productId ?? "",
        axes: JSON.stringify(axesSelections),
        defaults: JSON.stringify({
          price_piastres: egpToPiastres(form.price),
          sale_price_piastres: egpToPiastres(form.sale_price),
        }),
      },
      { method: "post" },
    );
  }

  async function restoreVariant(optionKey: string) {
    save.submit({ intent: "restore_variant", productId: productId ?? "", optionKey }, { method: "post" });
  }

  async function submitProduct() {
    const errors = validateStep(4);
    if (errors.length > 0) {
      setStepErrors(errors);
      return;
    }
    save.submit({ intent: "submit", productId: productId ?? "" }, { method: "post" });
  }

  const errorSummary = stepErrors.length > 0 ? (
    <div ref={submitRef} tabIndex={-1} role="alert" className="rounded-m border border-danger/40 bg-danger-soft p-3">
      <p className="text-[13px] font-extrabold text-danger">{t("common.errorSummary", { count: stepErrors.length })}</p>
      <ul className="mt-1.5 list-inside list-disc">
        {stepErrors.map((error) => (
          <li key={error} className="text-[13px] font-bold text-danger">{error}</li>
        ))}
      </ul>
    </div>
  ) : null;

  return (
    <div className="flex flex-col gap-5">
      <meta name="robots" content="noindex, nofollow" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-extrabold text-text">
          {productId ? t("productWizard.editTitle") : t("productWizard.newTitle")}
        </h1>
        <div className="flex items-center gap-2 text-[12px] text-text-faint" aria-live="polite">
          {product?.status ? <Badge tone={product.status === "rejected" ? "danger" : product.status === "approved" ? "success" : "warning"}>{t(`vendorStates.status.${product.status}`)}</Badge> : null}
          <span>
            {save.state !== "idle" || dirty
              ? t("vendorOnboarding.saving")
              : savedAt
                ? t("vendorOnboarding.savedAt", { time: new Date(savedAt).toLocaleTimeString(isAr ? "ar-EG" : "en-GB") })
                : ""}
          </span>
        </div>
      </div>

      {!editable ? (
        <div role="status" className="rounded-m border border-info/40 bg-info-soft p-3 text-[13px] font-bold text-text">
          {t("productWizard.readOnly")}
        </div>
      ) : null}
      {isRejected && product?.rejection_reason ? (
        <div role="alert" className="rounded-m border border-danger/40 bg-danger-soft p-3 text-[13px] font-bold text-danger">
          {t("productWizard.rejectionReason")}: {product.rejection_reason}
        </div>
      ) : null}
      {stale ? (
        <div role="alert" className="rounded-m border border-warning/40 bg-warning-soft p-3 text-[13px] font-bold text-warning-strong">
          {t("productWizard.staleWarning")}
        </div>
      ) : null}

      <Stepper steps={STEP_KEYS.map((key) => t(key))} current={step - 1} label={t("productWizard.progressLabel")} />
      {errorSummary}

      <Card>
        <CardBody className="flex flex-col gap-4 p-5">
          {step === 1 ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Input id="p_name_ar" label={t("productWizard.basics.nameAr")} value={form.name_ar} onChange={(e) => patch({ name_ar: e.target.value })} />
                <Input id="p_name_en" label={t("productWizard.basics.nameEn")} value={form.name_en} dir="ltr" onChange={(e) => patch({ name_en: e.target.value })} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5 text-[13px] font-bold text-text">
                  {t("productWizard.basics.descAr")}
                  <textarea className="min-h-24 rounded-m border border-border bg-surface p-2.5 text-sm text-text outline-none focus:shadow-focus" value={form.desc_ar} onChange={(e) => patch({ desc_ar: e.target.value })} />
                </label>
                <label className="flex flex-col gap-1.5 text-[13px] font-bold text-text">
                  {t("productWizard.basics.descEn")}
                  <textarea className="min-h-24 rounded-m border border-border bg-surface p-2.5 text-sm text-text outline-none focus:shadow-focus" dir="ltr" value={form.desc_en} onChange={(e) => patch({ desc_en: e.target.value })} />
                </label>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Input id="p_short_ar" label={t("productWizard.basics.shortAr")} value={form.short_ar} onChange={(e) => patch({ short_ar: e.target.value })} />
                <Input id="p_short_en" label={t("productWizard.basics.shortEn")} value={form.short_en} dir="ltr" onChange={(e) => patch({ short_en: e.target.value })} />
              </div>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <CategoryPicker
                categories={categories}
                value={form.leaf_category_id}
                isAr={isAr}
                onChange={(id) => patch({ leaf_category_id: id, attributes: {}, axes: {} })}
              />
              <Select
                id="p_brand"
                label={t("productWizard.classification.brand")}
                value={form.brand_id}
                onChange={(e) => patch({ brand_id: e.target.value })}
                options={[{ value: "", label: t("common.none") }, ...brands.map((brand) => ({ value: brand.id, label: isAr ? brand.name_ar : brand.name_en }))]}
              />
              <fieldset className="flex flex-col gap-2">
                <legend className="text-[13px] font-bold text-text">{t("productWizard.classification.tags")}</legend>
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((tag) => {
                    const active = form.tag_ids.includes(tag.id);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() =>
                          patch({
                            tag_ids: active ? form.tag_ids.filter((id) => id !== tag.id) : [...form.tag_ids, tag.id],
                          })
                        }
                        className={`cursor-pointer rounded-full border px-3 py-1 text-[12px] font-bold transition-colors duration-150 ${
                          active ? "border-action bg-action text-on-action" : "border-border bg-surface text-text hover:bg-surface-tint"
                        }`}
                      >
                        {isAr ? tag.name_ar : tag.name_en}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
              <div className="flex flex-col gap-2">
                <p className="text-[13px] font-bold text-text">{t("productWizard.classification.media")}</p>
                <div className="flex flex-wrap gap-2">
                  {form.media.map((item, index) => (
                    <div key={`${item.path}-${index}`} className="relative size-20 overflow-hidden rounded-m border border-border bg-surface-tint">
                      {item.kind === "image" ? (
                        <MediaImage path={item.path} alt="" width={80} height={80} supabaseUrl={supabaseUrl} className="size-full object-cover" />
                      ) : (
                        <span className="flex size-full items-center justify-center text-[10px] text-text-faint">video</span>
                      )}
                      <button
                        type="button"
                        aria-label={t("common.remove")}
                        onClick={() => patch({ media: form.media.filter((_, i) => i !== index) })}
                        className="absolute end-1 top-1 flex size-5 cursor-pointer items-center justify-center rounded-full bg-danger text-[10px] font-black text-white"
                      >
                        ×
                      </button>
                      {index === 0 ? (
                        <span className="absolute bottom-0 start-0 end-0 bg-ink/70 py-0.5 text-center text-[9px] font-bold text-white">
                          {t("productWizard.classification.main")}
                        </span>
                      ) : null}
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setGalleryPicker(true)}
                    className="flex size-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-m border border-dashed border-border-strong bg-surface text-text-muted transition-colors duration-150 hover:bg-surface-tint"
                  >
                    <span aria-hidden="true" className="text-xl">+</span>
                    <span className="text-[10px] font-bold">{t("media.picker.choose")}</span>
                  </button>
                </div>
                <p className="text-[11px] text-text-faint">{t("productWizard.classification.mainFirst")}</p>
              </div>
              <label className="flex items-center gap-2 text-[13px] text-text">
                <input type="checkbox" className="size-4 accent-[var(--color-action)]" checked={form.is_fragile} onChange={(e) => patch({ is_fragile: e.target.checked })} />
                {t("productWizard.classification.fragile")}
              </label>
              <MediaPickerDialog
                open={galleryPicker}
                onClose={() => setGalleryPicker(false)}
                title={t("productWizard.classification.media")}
                settings={media}
                uid={uid}
                supabaseUrl={supabaseUrl}
                mode="multi"
                kinds={["image"]}
                onConfirm={(files) => {
                  patch({
                    media: [
                      ...form.media,
                      ...files.map((file) => ({ kind: "image" as const, path: file.path })),
                    ].slice(0, 12),
                  });
                }}
              />
            </>
          ) : null}

          {step === 3 ? (
            <>
              <p className="text-[13px] text-text-muted">{t("productWizard.pricing.hint")}</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Input id="p_price" label={t("productWizard.pricing.price")} type="number" inputMode="decimal" min="0" step="0.01" dir="ltr" value={form.price} onChange={(e) => patch({ price: e.target.value })} hint={t("productWizard.pricing.egp")} />
                <Input id="p_sale" label={t("productWizard.pricing.sale")} type="number" inputMode="decimal" min="0" step="0.01" dir="ltr" value={form.sale_price} onChange={(e) => patch({ sale_price: e.target.value })} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Input id="p_sale_start" label={t("productWizard.pricing.saleStart")} type="datetime-local" dir="ltr" value={form.sale_starts_at} onChange={(e) => patch({ sale_starts_at: e.target.value })} />
                <Input id="p_sale_end" label={t("productWizard.pricing.saleEnd")} type="datetime-local" dir="ltr" value={form.sale_ends_at} onChange={(e) => patch({ sale_ends_at: e.target.value })} />
              </div>
              {rows.length > 1 ? (
                <p className="rounded-m bg-surface-tint p-3 text-[12px] text-text-muted">
                  {t("productWizard.pricing.variantsNote")}
                </p>
              ) : null}
            </>
          ) : null}

          {step === 4 ? (
            <div className="flex flex-col gap-5">
              {template.length === 0 ? (
                <p className="text-[13px] text-text-muted">{t("productWizard.attributes.noTemplate")}</p>
              ) : null}
              {template
                .filter((attr) => !attr.is_variant_axis)
                .map((attr) => (
                  <AttributeField
                    key={attr.id}
                    attr={attr}
                    isAr={isAr}
                    value={form.attributes[attr.id] ?? { option_id: "", value_text: "", value_number: "", value_bool: null }}
                    onChange={(value) => patch({ attributes: { ...form.attributes, [attr.id]: value } })}
                  />
                ))}

              {template.some((attr) => attr.is_variant_axis) ? (
                <div className="flex flex-col gap-3 rounded-l border border-border bg-surface-tint p-4">
                  <p className="text-[13px] font-extrabold text-text">{t("productWizard.variants.title")}</p>
                  {template
                    .filter((attr) => attr.is_variant_axis)
                    .map((attr) => (
                      <fieldset key={attr.id} className="flex flex-col gap-1.5">
                        <legend className="text-[13px] font-bold text-text">{attr.code}</legend>
                        <div className="flex flex-wrap gap-1.5">
                          {attr.options.map((option) => {
                            const selected = (form.axes[attr.id] ?? []).includes(option.id);
                            return (
                              <button
                                key={option.id}
                                type="button"
                                aria-pressed={selected}
                                onClick={() => {
                                  const current = form.axes[attr.id] ?? [];
                                  patch({
                                    axes: {
                                      ...form.axes,
                                      [attr.id]: selected ? current.filter((id) => id !== option.id) : [...current, option.id],
                                    },
                                  });
                                }}
                                className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-bold transition-colors duration-150 ${
                                  selected ? "border-action bg-action text-on-action" : "border-border bg-surface text-text hover:bg-surface-tint"
                                }`}
                              >
                                {option.color_hex ? (
                                  <span aria-hidden="true" className="size-3.5 rounded-full border border-border" style={{ backgroundColor: option.color_hex }} />
                                ) : null}
                                {isAr ? option.label_ar : option.label_en}
                              </button>
                            );
                          })}
                        </div>
                      </fieldset>
                    ))}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] text-text-muted">
                      {t("productWizard.variants.count", { count: comboCount })}
                    </span>
                    <Button type="button" variant="outline" size="sm" onClick={requestGenerate}>
                      {rows.length > 0 ? t("productWizard.variants.regenerate") : t("productWizard.variants.generate")}
                    </Button>
                  </div>
                  <VariantMatrixEditor
                    rows={rows}
                    settings={media}
                    uid={uid}
                    supabaseUrl={supabaseUrl}
                    onChange={(index, rowPatch) =>
                      setRows((current) => current.map((row, i) => (i === index ? { ...row, ...rowPatch } : row)))
                    }
                    onRestore={(key) => void restoreVariant(key)}
                    skippedKeys={skippedKeys}
                  />
                  {rows.length > 0 ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        save.submit(
                          {
                            intent: "save_variants",
                            productId: productId ?? "",
                            rows: JSON.stringify(
                              rows.map((row) => ({
                                option_key: row.option_key,
                                sku: row.sku.trim(),
                                price_piastres: egpToPiastres(row.price),
                                sale_price_piastres: egpToPiastres(row.sale_price),
                                stock: row.stock === "" ? 0 : Number(row.stock),
                                image_path: row.image_path,
                                is_active: row.is_active,
                              })),
                            ),
                          },
                          { method: "post" },
                        )
                      }
                    >
                      {t("productWizard.variants.saveRows")}
                    </Button>
                  ) : null}
                </div>
              ) : (
                <p className="rounded-m bg-surface-tint p-3 text-[12px] text-text-muted">{t("productWizard.variants.noAxes")}</p>
              )}
            </div>
          ) : null}

          {step === 5 ? (
            <div className="flex flex-col gap-4 text-[13px]">
              <div className="grid gap-3 sm:grid-cols-2">
                <Input id="p_weight" label={t("productWizard.shipping.weight")} type="number" inputMode="numeric" min="0" dir="ltr" value={form.weight_g} onChange={(e) => patch({ weight_g: e.target.value })} hint={t("productWizard.shipping.grams")} />
                <Select
                  id="p_ship_class"
                  label={t("productWizard.shipping.class")}
                  value={form.shipping_class}
                  onChange={(e) => patch({ shipping_class: e.target.value })}
                  options={[
                    { value: "standard", label: t("productWizard.shipping.classStandard") },
                    { value: "heavy", label: t("productWizard.shipping.classHeavy") },
                    { value: "fragile", label: t("productWizard.shipping.classFragile") },
                  ]}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <Input id="p_dim_l" label={t("productWizard.shipping.length")} type="number" min="0" dir="ltr" value={form.dims_l} onChange={(e) => patch({ dims_l: e.target.value })} />
                <Input id="p_dim_w" label={t("productWizard.shipping.width")} type="number" min="0" dir="ltr" value={form.dims_w} onChange={(e) => patch({ dims_w: e.target.value })} />
                <Input id="p_dim_h" label={t("productWizard.shipping.height")} type="number" min="0" dir="ltr" value={form.dims_h} onChange={(e) => patch({ dims_h: e.target.value })} />
              </div>
              <Select
                id="p_ship_mode"
                label={t("productWizard.shipping.mode")}
                value={form.shipping_mode}
                onChange={(e) => patch({ shipping_mode: e.target.value as "platform" | "vendor" })}
                options={[
                  { value: "platform", label: t("productWizard.shipping.modePlatform") },
                  { value: "vendor", label: t("productWizard.shipping.modeVendor") },
                ]}
              />

              <div className="rounded-m border border-border bg-surface-tint p-3.5">
                <p className="text-[13px] font-extrabold text-text">{t("productWizard.review.title")}</p>
                <dl className="mt-2 grid gap-1.5 sm:grid-cols-2">
                  <ReviewRow label={t("productWizard.basics.nameAr")} value={form.name_ar} />
                  <ReviewRow label={t("productWizard.basics.nameEn")} value={form.name_en} />
                  <ReviewRow label={t("productWizard.classification.category")} value={categoryLabel(categories, form.leaf_category_id, isAr)} />
                  <ReviewRow label={t("productWizard.variants.matrixTitle", { count: rows.length })} value="" />
                  <ReviewRow label={t("productWizard.pricing.price")} value={form.price ? `${form.price} EGP` : rows[0]?.price ? `${rows[0].price} EGP` : "—"} />
                  <ReviewRow label={t("productWizard.classification.media")} value={String(form.media.length)} />
                </dl>
              </div>

              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setDirty(true);
                  }}
                >
                  {t("productWizard.review.saveDraft")}
                </Button>
                {editable ? (
                  <Button type="button" size="lg" loading={save.state !== "idle"} onClick={submitProduct}>
                    {t("productWizard.review.submit")}
                  </Button>
                ) : null}
              </div>
              <p className="text-[12px] text-text-faint">{t("productWizard.review.note")}</p>
            </div>
          ) : null}
        </CardBody>
      </Card>

      <div className="flex items-center justify-between gap-3">
        <Button type="button" variant="outline" disabled={step === 1} onClick={() => { setStepErrors([]); setStep((s) => Math.max(s - 1, 1)); setDirty(true); }}>
          {t("common.back")}
        </Button>
        {step < 5 ? (
          <Button type="button" onClick={goNext}>
            {t("common.next")}
          </Button>
        ) : null}
      </div>

      <Dialog open={confirmGenerate !== null} onClose={() => setConfirmGenerate(null)} title={t("productWizard.variants.confirmTitle")}>
        <div className="flex flex-col gap-4">
          <p className="text-[13px] text-text-muted">
            {t("productWizard.variants.confirmBody", { count: confirmGenerate?.removed ?? 0 })}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmGenerate(null)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void generate()}>{t("common.confirm")}</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-[11px] font-bold text-text-faint">{label}</dt>
      <dd className="text-[13px] text-text">{value || "—"}</dd>
    </div>
  );
}

function categoryLabel(categories: PickerCategory[], id: string, isAr: boolean): string {
  const category = categories.find((c) => c.id === id);
  if (!category) return "—";
  return isAr ? category.name_ar : category.name_en;
}

/** Attribute form field generated from the template (V-14: admin options only). */
function AttributeField({
  attr,
  isAr,
  value,
  onChange,
}: {
  attr: TemplateAttr;
  isAr: boolean;
  value: { option_id: string; value_text: string; value_number: string; value_bool: boolean | null };
  onChange: (value: { option_id: string; value_text: string; value_number: string; value_bool: boolean | null }) => void;
}) {
  const { t } = useTranslation();
  const label = (
    <>
      {attr.code}
      {attr.unit ? <span className="font-normal text-text-faint"> ({attr.unit})</span> : null}
      {attr.is_required ? <span className="text-danger"> *</span> : null}
    </>
  );

  if (attr.type === "enum" || attr.type === "color") {
    return (
      <Select
        id={`attr_${attr.id}`}
        label={label}
        value={value.option_id}
        onChange={(e) => onChange({ ...value, option_id: e.target.value })}
        options={[
          { value: "", label: t("common.choose") },
          ...attr.options.map((option) => ({
            value: option.id,
            label: isAr ? option.label_ar : option.label_en,
          })),
        ]}
      />
    );
  }
  if (attr.type === "number") {
    return (
      <Input
        id={`attr_${attr.id}`}
        label={label}
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
      <label className="flex items-center gap-2 text-[13px] text-text">
        <input
          id={`attr_${attr.id}`}
          type="checkbox"
          className="size-4 accent-[var(--color-action)]"
          checked={value.value_bool === true}
          onChange={(e) => onChange({ ...value, value_bool: e.target.checked })}
        />
        {attr.code}
      </label>
    );
  }
  return (
    <Input
      id={`attr_${attr.id}`}
      label={label}
      value={value.value_text}
      onChange={(e) => onChange({ ...value, value_text: e.target.value })}
    />
  );
}

/** 3-level category picker (V-11): root → sub → leaf. A depth-2 category
 * IS a valid leaf: picking it in level 2 completes the selection. */
function CategoryPicker({
  categories,
  value,
  isAr,
  onChange,
}: {
  categories: PickerCategory[];
  value: string;
  isAr: boolean;
  onChange: (leafId: string) => void;
}) {
  const { t } = useTranslation();
  const [rootId, setRootId] = useState("");
  const [subId, setSubId] = useState("");

  const roots = categories.filter((c) => c.parent_id === null);
  const subs = categories.filter((c) => c.parent_id === rootId);
  const leaves = categories.filter((c) => c.parent_id === subId);
  const subHasChildren = leaves.length > 0;

  // keep the pickers in sync with an existing value (ancestor walk)
  useEffect(() => {
    if (!value) return;
    const leaf = categories.find((c) => c.id === value);
    if (!leaf) return;
    const parent = leaf.parent_id ? categories.find((c) => c.id === leaf.parent_id) : null;
    const grand = parent?.parent_id ? categories.find((c) => c.id === parent.parent_id) : null;
    setRootId(grand?.id ?? parent?.id ?? leaf.id);
    setSubId(leaf.depth >= 2 ? (parent?.id ?? leaf.id) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] font-bold text-text">{t("productWizard.classification.category")}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Select
          id="cat_root"
          label={t("productWizard.classification.level1")}
          value={rootId}
          onChange={(e) => {
            setRootId(e.target.value);
            setSubId("");
            onChange("");
          }}
          options={[{ value: "", label: t("common.choose") }, ...roots.map((c) => ({ value: c.id, label: isAr ? c.name_ar : c.name_en }))]}
        />
        <Select
          id="cat_sub"
          label={t("productWizard.classification.level2")}
          value={subId}
          disabled={!rootId}
          onChange={(e) => {
            const next = e.target.value;
            setSubId(next);
            // a childless level-2 category is itself a valid leaf
            const hasKids = categories.some((c) => c.parent_id === next);
            onChange(hasKids ? "" : next);
          }}
          options={[{ value: "", label: t("common.choose") }, ...subs.map((c) => ({ value: c.id, label: isAr ? c.name_ar : c.name_en }))]}
        />
        <Select
          id="cat_leaf"
          label={t("productWizard.classification.level3")}
          value={subHasChildren ? value : ""}
          disabled={!subId || !subHasChildren}
          onChange={(e) => onChange(e.target.value)}
          options={[{ value: "", label: t("common.choose") }, ...leaves.map((c) => ({ value: c.id, label: isAr ? c.name_ar : c.name_en }))]}
        />
      </div>
    </div>
  );
}

export interface SaveActionData {
  intent: "save" | "generate_variants" | "restore_variant" | "save_variants" | "submit";
  ok: boolean;
  error?: string;
  stale?: boolean;
  updatedAt?: string;
  redirectTo?: string;
  skipped?: string[];
}

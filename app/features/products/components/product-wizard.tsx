import { useEffect, useMemo, useRef, useState } from "react";
import { useBlocker, useFetcher, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  Button,
  Card,
  CardBody,
  Stepper,
  useToast,
} from "~/components/ui";
import { choiceIds, formFromProduct } from "./wizard/helpers";
import { AttributesStep } from "./wizard/attributes-step";
import { BasicInfoStep } from "./wizard/basic-info-step";
import { ChildrenStep } from "./wizard/children-step";
import { childrenFromLoader, childrenPayload, packSizesForForm, sizeAxisKind, type ChildDraft, type SizeOption } from "./wizard/children";
import { ClassificationStep } from "./wizard/classification-step";
import { ErrorSummary } from "./wizard/error-summary";
import { ShippingStep } from "./wizard/shipping-step";
import { WizardBanners } from "./wizard/status-banners";
import { validateStep } from "./wizard/validate-step";
import { WizardHeader } from "./wizard/wizard-header";
import { SizeChartEditor } from "./wizard/size-chart-step";
import { defaultChart, garmentFor } from "~/features/products/size-chart";
import { Dialog } from "~/components/ui/Overlay";
import { LiveCommissionBox } from "~/components/admin/CommissionBox";
import { egpToPiastres as toPiastres } from "./wizard/helpers";
import type { ProductWizardProps, SaveActionData, TemplateAttr, WizardBrand, WizardForm } from "./wizard/types";

/**
 * Product wizard (V-11..V-17): 5 steps — basics · classification/media ·
 * specifications · child products · shipping/review. Autosave drafts via
 * `fn_save_product`; child products (colour + sizes + stock per size + price
 * + discount + images) via `fn_save_children`. The form is generated from the
 * leaf template — vendors pick admin options only (AGENT §6.8).
 *
 * This module is the orchestrator: it owns wizard state, the autosave
 * debounce, the save-result handling and the submit handlers, and composes
 * the step UI from `./wizard/*` (types, helpers, validation, header/banners,
 * dialogs and one file per step).
 */

// Public API kept on this module: the route imports these from here.
export type {
  LoaderVariant,
  PickerCategory,
  ProductWizardProps,
  SaveActionData,
  TemplateAttr,
  TemplateOption,
  WizardForm,
  WizardProduct,
} from "./wizard/types";
export { attrLabel, egpToPiastres, piastresToEgp } from "./wizard/helpers";

const STEP_KEYS = [
  "productWizard.steps.basics",
  "productWizard.steps.classification",
  "productWizard.steps.attributes",
  "productWizard.steps.children",
  "productWizard.steps.shipping",
] as const;

/**
 * Size types that carry a body-measurement chart (clothing / shoes). Pack
 * sizes (weight / volume), storage and bedding never get a chart.
 */
const CHART_SIZE_TYPE_IDS = [
  "ba51e8c5-ce6b-4154-acdf-4f56d245dbb5", // clothing
  "6f8b51fd-c98a-4779-9027-2c1b06558c82", // shoes
] as const;

/**
 * Session snapshot of the wizard (owner report: switching the site language
 * mid-way lost everything typed). The switch reloads the page in the other
 * language; the wizard restores its last form, step and child products from
 * this snapshot when it belongs to the same product and is newer than the
 * saved copy. Kept per tab (sessionStorage), dropped after submitting.
 */
interface WizardSnapshot { productId: string | null; ts: number; step: number; form: WizardForm; children: ChildDraft[] }
const SNAP_KEY = "etsawaa:product-wizard";
function readSnapshot(productId: string | null, productUpdatedAt: string | null): WizardSnapshot | null {
  if (typeof window === "undefined") return null;
  // never on the first (hydrating) render of a full page load — the server had
  // no snapshot, so restoring then would not match its HTML; a language switch
  // is a client navigation, after hydration
  if (!(window as unknown as { __etsawaaHydrated?: boolean }).__etsawaaHydrated) return null;
  try {
    const raw = window.sessionStorage.getItem(SNAP_KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw) as WizardSnapshot;
    if ((snap.productId ?? null) !== productId) return null;
    if (Date.now() - snap.ts > 30 * 60_000) return null;
    // the database copy is newer (edited elsewhere) — never overwrite it
    if (productUpdatedAt && new Date(productUpdatedAt).getTime() > snap.ts + 5_000) return null;
    return snap;
  } catch {
    return null;
  }
}
function writeSnapshot(snap: WizardSnapshot) {
  try { window.sessionStorage.setItem(SNAP_KEY, JSON.stringify(snap)); } catch { /* storage full / blocked */ }
}
export function clearWizardSnapshot() {
  try { window.sessionStorage.removeItem(SNAP_KEY); } catch { /* blocked */ }
}

function axisOf(tpl: TemplateAttr[], code: string): TemplateAttr | undefined {
  return tpl.find((attr) => attr.is_variant_axis && attr.code === code);
}

export function ProductWizard({
  uid,
  supabaseUrl,
  media,
  product,
  template: loadedTemplate,
  categories,
  brands: loadedBrands,
  tags,
  childrenData,
  sizeOptions: loadedSizes,
  shippingBlocked: loadedShippingBlocked,
  isAr,
  mode = "seller",
  storeName,
  commissionVendorId,
}: ProductWizardProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const admin = mode === "admin";
  // One fetcher per job: a fetcher cancels its own in-flight request when it
  // submits again, so a shared one let autosave abort a child-products save
  // (ids/SKUs never adopted) or a submit.
  const save = useFetcher<SaveActionData>();
  const childSave = useFetcher<SaveActionData>();
  const submitter = useFetcher<SaveActionData>();
  // admin mode: no autosave — one save (fields + children + audit reason)
  const adminSave = useFetcher<SaveActionData>();
  const [reason, setReason] = useState("");
  // Template arrives from the loader only when editing an existing product; for
  // a new product we fetch it the moment a category is picked, so the
  // attributes step is never a blank page.
  const tplFetch = useFetcher<SaveActionData>();
  const [template, setTemplate] = useState<TemplateAttr[]>(loadedTemplate);
  const [sizeOptions, setSizeOptions] = useState<SizeOption[]>(loadedSizes);
  const [shippingBlocked, setShippingBlocked] = useState(loadedShippingBlocked);
  // brands of the chosen category (fetched with its template)
  const [brands, setBrands] = useState<WizardBrand[]>(loadedBrands);
  const colorAttr = axisOf(template, "color");
  const hasColor = Boolean(colorAttr);
  const hasSize = Boolean(axisOf(template, "size"));
  // a snapshot left by a language switch (same product, newer than the DB copy)
  const [restored] = useState<WizardSnapshot | null>(() => (mode === "admin" ? null : readSnapshot(product?.id ?? null, product?.updated_at ?? null)));
  const [childList, setChildListRaw] = useState<ChildDraft[]>(() => {
    if (restored?.children?.length) return restored.children;
    const sized = Boolean(axisOf(loadedTemplate, "size"));
    const loaded = childrenFromLoader(childrenData, sized);
    // no automatic variant: the Variants tab starts with price + stock only
    return loaded;
  });
  const [childrenDirty, setChildrenDirty] = useState(Boolean(restored?.children?.length));
  // a template re-fetched only to restore a snapshot must not reset the children
  const keepChildrenRef = useRef(false);
  const setChildList = (next: ChildDraft[]) => { setChildListRaw(next); setChildrenDirty(true); };
  useEffect(() => {
    if (tplFetch.state === "idle" && tplFetch.data?.intent === "template" && tplFetch.data.template) {
      const next = tplFetch.data.template;
      setTemplate(next);
      setSizeOptions(tplFetch.data.sizeOptions ?? []);
      setShippingBlocked(Boolean(tplFetch.data.shippingBlocked));
      const nextBrands = tplFetch.data.brands ?? [];
      setBrands(nextBrands);
      // a brand from another category no longer fits
      setForm((f) => (f.brand_id && !nextBrands.some((b) => b.id === f.brand_id) ? { ...f, brand_id: "" } : f));
      // a new product type has other colours/sizes — the children start over
      if (keepChildrenRef.current) {
        keepChildrenRef.current = false;
      } else {
        setChildListRaw([]);
        setChildrenDirty(true);
      }
    }
  }, [tplFetch.state, tplFetch.data]);
  const [step, setStep] = useState(restored?.step ?? 1);
  const [form, setForm] = useState<WizardForm>(() => restored?.form ?? formFromProduct(product));
  // phones / computers: RAM is its own option and each storage + RAM row has its own price
  const ramAttr = axisOf(template, "memory");
  const formSizes = packSizesForForm(sizeOptions, template, form.attributes);
  // chart only when the leaf offers a clothing or shoe size type — a pack
  // volume (baby lotion) must never borrow the children's body chart
  const hasSizeChart = sizeOptions.some((o) => (CHART_SIZE_TYPE_IDS as readonly string[]).includes(o.size_type_id));
  const variantMode = { config: Boolean(ramAttr) || sizeAxisKind(formSizes) === "storage", hasRam: Boolean(ramAttr) };
  // restored edits may be newer than the saved draft: save them again
  const [dirty, setDirty] = useState(Boolean(restored));
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [stepErrors, setStepErrors] = useState<string[]>([]);
  const [galleryPicker, setGalleryPicker] = useState(false);
  const submitRef = useRef<HTMLDivElement>(null);

  // the wizard needs the full width: fold the panel sidebar to its rail while open
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("etsawaa:sidebar", { detail: { collapsed: true } }));
    return () => { window.dispatchEvent(new CustomEvent("etsawaa:sidebar", { detail: { collapsed: false } })); };
  }, []);

  // A new draft gets its id from the first autosave. It used to navigate to
  // /products/:id/edit — a different route, so the wizard remounted: the seller
  // was thrown back to step 1 and whatever they typed meanwhile was lost. Now
  // the id is kept in state and only the address bar is updated.
  const [productId, setProductId] = useState<string | null>(product?.id ?? null);

  // keep the session snapshot current (restored after a language switch)
  useEffect(() => {
    if (admin) return;
    const id = window.setTimeout(() => writeSnapshot({ productId, ts: Date.now(), step, form, children: childList }), 250);
    return () => window.clearTimeout(id);
  }, [admin, productId, step, form, childList]);
  // a brand-new product restored before its first save: load its category template
  useEffect(() => {
    if (restored && !product && restored.form.leaf_category_id && template.length === 0) {
      keepChildrenRef.current = true;
      tplFetch.submit({ intent: "template", leaf_category_id: restored.form.leaf_category_id }, { method: "post" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const productIdRef = useRef<string | null>(product?.id ?? null);
  // a save of a pending/approved product reopens it as a draft: keep the local
  // status so the banners and the submit action reflect the new state at once
  const [status, setStatus] = useState(product?.status ?? null);
  // the reopen action reloads the loader (draft) — follow it without a remount
  useEffect(() => {
    if (product?.status) setStatus(product.status);
  }, [product?.status]);
  const currentProduct = product
    ? status && status !== product.status ? { ...product, status } : product
    : null;
  // V-17 (updated): sellers edit drafts, returned products and products under
  // review; a live product still needs the explicit reopen confirmation.
  const editable = admin || !product || product.status === "draft" || product.status === "pending"
    || (product.status === "rejected" && !product.rejected_final);

  // staleness base: advanced after every successful save so consecutive
  // autosaves in THIS session never flag themselves as two-tab conflicts
  const baseUpdatedRef = useRef(product?.updated_at ?? "");
  const patch = (partial: Partial<WizardForm>) => {
    setForm((current) => ({ ...current, ...partial }));
    setDirty(true);
  };

  /* autosave (debounced) — the draft survives refresh and re-login (V-17) */
  const timer = useRef<number | null>(null);
  useEffect(() => {
    if (admin || !dirty || !editable || submitter.state !== "idle") return;
    // while the FIRST save (which creates the draft) is in flight, hold further
    // saves — another one without the id would create a second, duplicate draft
    if (!productIdRef.current && save.state !== "idle") return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      save.submit(
        { intent: "save", productId: productIdRef.current ?? "", payload: JSON.stringify(payloadOf(form)), baseUpdatedAt: baseUpdatedRef.current },
        { method: "post" },
      );
      setDirty(false);
    }, 1200);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
    // Deps stay narrow on purpose: the debounce must reset only when the
    // form actually changes — payloadOf/productId are re-created every
    // render and would postpone autosave indefinitely.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, dirty, editable, save.state === "idle", submitter.state === "idle"]);

  /* child products autosave too (debounced) once the draft exists */
  const autoChildSave = useRef(false);
  const childTimer = useRef<number | null>(null);
  useEffect(() => {
    if (admin || !childrenDirty || !editable || !productId || childSave.state !== "idle" || submitter.state !== "idle") return;
    if (childTimer.current) window.clearTimeout(childTimer.current);
    childTimer.current = window.setTimeout(() => {
      autoChildSave.current = true;
      childSave.submit(
        { intent: "save_children", productId, children: JSON.stringify(childrenPayload(childList)) },
        { method: "post" },
      );
    }, 2500);
    return () => { if (childTimer.current) window.clearTimeout(childTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [childList, childrenDirty, editable, productId, childSave.state === "idle", submitter.state === "idle"]);

  useEffect(() => {
    if (childSave.state !== "idle" || !childSave.data) return;
    const silent = autoChildSave.current;
    autoChildSave.current = false;
    if (childSave.data.intent === "save_children") {
      if (childSave.data.ok) {
        if (childSave.data.updatedAt) baseUpdatedRef.current = childSave.data.updatedAt;
        // adopt the ids and generated SKUs (lists come back in the same order)
        const saved = childSave.data.children ?? [];
        setChildListRaw((current) => current.map((child, i) => {
          const row = saved[i];
          if (!row) return child;
          return {
            ...child,
            id: row.id,
            sizes: child.sizes.map((size) => ({
              ...size,
              sku: row.sizes.find((r) => (r.size_option_id ?? "") === size.size_option_id
                && (r.ram_option_id ?? "") === (size.ram_option_id ?? ""))?.sku ?? size.sku,
            })),
          };
        }));
        setChildrenDirty(false);
        if (!silent) toast.showToast("success", t("children.saved"));
      } else if (!silent) {
        toast.showToast("error", explainError(childSave.data.error, t("children.err.server")));
      }
    }
  }, [childSave.state, childSave.data]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (save.state !== "idle" || !save.data || save.data.intent !== "save") return;
    if (save.data.ok) {
      if (save.data.updatedAt) baseUpdatedRef.current = save.data.updatedAt;
      setSavedAt(new Date().toISOString());
      if (save.data.stale) setStale(true);
      // a pending/approved product was pulled back to draft by this save
      if (save.data.status) setStatus(save.data.status);
      if (save.data.productId && !productIdRef.current) {
        productIdRef.current = save.data.productId;
        setProductId(save.data.productId);
        // address bar only (a refresh reopens the draft); no remount
        if (save.data.redirectTo) window.history.replaceState(window.history.state, "", save.data.redirectTo);
      }
    } else {
      toast.showToast("error", explainError(save.data.error, t("errors.generic")));
    }
  }, [save.state, save.data]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (submitter.state !== "idle" || !submitter.data || submitter.data.intent !== "submit") return;
    if (submitter.data.ok && submitter.data.redirectTo) {
      clearWizardSnapshot();
      setDirty(false);
      setChildrenDirty(false);
      navigate(submitter.data.redirectTo, { replace: true });
    } else if (!submitter.data.ok) {
      toast.showToast("error", explainError(submitter.data.error, t("productWizard.errors.submitBlocked")));
    }
  }, [submitter.state, submitter.data]); // eslint-disable-line react-hooks/exhaustive-deps

  /* admin mode: one save (fields → children → audit reason) then the review page */
  useEffect(() => {
    if (adminSave.state !== "idle" || !adminSave.data || adminSave.data.intent !== "admin_save") return;
    if (adminSave.data.ok && adminSave.data.redirectTo) {
      setDirty(false);
      setChildrenDirty(false);
      navigate(adminSave.data.redirectTo, { replace: true });
    } else if (!adminSave.data.ok) {
      toast.showToast("error", explainError(adminSave.data.error, t("errors.generic")));
    }
  }, [adminSave.state, adminSave.data]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Server error text → a sentence the seller can act on. */
  function explainError(raw: string | undefined, fallback: string): string {
    const msg = String(raw ?? "");
    if (/brand_not_in_category/.test(msg)) return t("productWizard.errors.brandCategory");
    if (/duplicate colour\/size/.test(msg)) return t("children.err.duplicate");
    if (/sale price must be lower/.test(msg)) return t("children.err.sale");
    if (/price must be positive/.test(msg)) return t("children.err.price");
    if (/sale schedule end/.test(msg)) return t("children.err.window");
    if (/selling is blocked/.test(msg)) return t("productWizard.errors.storeBlocked");
    if (/vendor_under_review/.test(msg)) return t("vendor.products.underReviewNote");
    if (/locked in status|not submittable/.test(msg)) return t("productWizard.errors.locked");
    if (msg === "not_saved") return t("productWizard.errors.saveFirst");
    const missing = msg.match(/product is incomplete: (.+)$/)?.[1];
    if (missing) {
      const parts = missing.split(",").map((s) => s.trim()).map((code) => {
        if (code.startsWith("attribute:")) {
          const attrCode = code.slice("attribute:".length);
          const attr = template.find((a) => a.code === attrCode);
          return t("productWizard.errors.attributeRequired", { code: attr ? (isAr ? attr.label_ar || attr.code : attr.label_en || attr.code) : attrCode });
        }
        return t(`productWizard.missing.${code}`, { defaultValue: code });
      });
      return `${t("productWizard.errors.incomplete")} ${parts.join(" · ")}`;
    }
    return fallback;
  }

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (admin) return;
      if (dirty || childrenDirty || save.state !== "idle" || childSave.state !== "idle") event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty, childrenDirty, save.state, childSave.state, admin]);

  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    !admin && editable && submitter.state === "idle" && !submitter.data?.ok &&
    currentLocation.pathname !== nextLocation.pathname &&
    // a language switch stays on the wizard (restored from the session snapshot)
    currentLocation.pathname.slice(0, 4) === nextLocation.pathname.slice(0, 4) &&
    Boolean(productIdRef.current || dirty || form.name_ar || form.name_en));
  const [leaving, setLeaving] = useState(false);
  const flushSeen = useRef(false);
  const flushSent = useRef({ save: false, children: false });
  function leaveNow() {
    if (timer.current) window.clearTimeout(timer.current);
    if (childTimer.current) window.clearTimeout(childTimer.current);
    const needsSave = dirty || (!productIdRef.current && Boolean(form.name_ar || form.name_en));
    const needsChildren = childrenDirty && Boolean(productIdRef.current);
    if (!needsSave && !needsChildren && save.state === "idle" && childSave.state === "idle") {
      blocker.proceed?.();
      return;
    }
    flushSeen.current = false;
    flushSent.current = { save: needsSave, children: needsChildren };
    setLeaving(true);
    if (needsSave) {
      save.submit(
        { intent: "save", productId: productIdRef.current ?? "", payload: JSON.stringify(payloadOf(form)), baseUpdatedAt: baseUpdatedRef.current },
        { method: "post" },
      );
      setDirty(false);
    }
    if (needsChildren && productIdRef.current) {
      autoChildSave.current = true;
      childSave.submit({ intent: "save_children", productId: productIdRef.current, children: JSON.stringify(childrenPayload(childList)) }, { method: "post" });
    }
  }
  // leave only after the flush was actually sent and came back
  useEffect(() => {
    if (!leaving || blocker.state !== "blocked") return;
    if (save.state !== "idle" || childSave.state !== "idle") { flushSeen.current = true; return; }
    if (!flushSeen.current) return;
    // a failed flush keeps the user here (the error toast is already shown) instead of dropping their edits
    const saveFailed = flushSent.current.save && save.data?.ok === false;
    const childFailed = flushSent.current.children && childSave.data?.ok === false;
    if (saveFailed || childFailed) {
      setLeaving(false);
      if (saveFailed) setDirty(true);
      blocker.reset?.();
      return;
    }
    blocker.proceed();
  }, [leaving, blocker, save.state, childSave.state, save.data, childSave.data]);

  // size chart: apparel/shoe branches start with the standard table
  const suggestedGarment = useMemo(() => {
    const chain: string[] = [];
    let cur = categories.find((c) => c.id === form.leaf_category_id);
    while (cur) { chain.push(cur.slug_en ?? ""); cur = categories.find((c) => c.id === cur!.parent_id); }
    return chain.length ? garmentFor(chain) : null;
  }, [categories, form.leaf_category_id]);
  const sizeLabels = useMemo(() => {
    const ids = [...new Set(childList.flatMap((c) => c.sizes.map((sz) => sz.size_option_id)).filter(Boolean))];
    return sizeOptions.filter((o) => ids.includes(o.option_id)).map((o) => o.label_en || o.label_ar);
  }, [childList, sizeOptions]);

  function payloadOf(current: WizardForm): Record<string, unknown> {
    const attributes = template
      .map((attr) => {
        const value = current.attributes[attr.id];
        if (!value) return null;
        if (attr.type === "enum" || attr.type === "color") {
          const ids = choiceIds(attr, value);
          return ids.length ? { attribute_id: attr.id, option_id: ids[0], option_ids: ids } : null;
        }
        if (attr.type === "number") {
          return value.value_number !== "" ? { attribute_id: attr.id, value_number: value.value_number } : null;
        }
        if (attr.type === "bool") {
          return value.value_bool !== null ? { attribute_id: attr.id, value_bool: value.value_bool } : null;
        }
        return value.value_text !== "" || value.value_text_en !== "" ? { attribute_id: attr.id, value_text: value.value_text, value_text_en: value.value_text_en } : null;
      })
      .filter(Boolean);
    return {
      name_ar: current.name_ar,
      name_en: current.name_en,
      desc_ar: current.desc_ar,
      desc_en: current.desc_en,
      leaf_category_id: current.leaf_category_id || undefined,
      // always sent: "" means "no brand" (fn_save_product clears it)
      brand_id: current.brand_id ?? "",
      tag_ids: current.tag_ids,
      is_fragile: current.is_fragile,
      media: current.media,
      attributes,
      weight_g: current.weight_g === "" ? null : Number(current.weight_g),
      shipping_class: current.shipping_class,
      shipping_mode: shippingBlocked ? "platform" : current.shipping_mode,
      size_chart: hasSizeChart ? current.size_chart : null,
    };
  }

  useEffect(() => {
    if (step === 4 && hasSizeChart && editable && !form.size_chart && suggestedGarment && !product?.id) {
      patch({ size_chart: defaultChart(suggestedGarment, sizeLabels) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, hasSizeChart, suggestedGarment]);

  const validate = (target: number) =>
    validateStep({ target, form, childList, template, hasColor, hasSize, mode: variantMode, isAr, t });

  function saveChildren() {
    if (!productId) {
      toast.showToast("error", t("productWizard.errors.saveFirst"));
      return;
    }
    childSave.submit(
      { intent: "save_children", productId, children: JSON.stringify(childrenPayload(childList)) },
      { method: "post" },
    );
  }

  function goNext() {
    const errors = validate(step);
    if (errors.length > 0) {
      setStepErrors(errors);
      submitRef.current?.scrollIntoView({ block: "center" });
      return;
    }
    setStepErrors([]);
    setDirty(true);
    // leaving the children step persists them
    if (step === 4 && childrenDirty && productId && editable) saveChildren();
    setStep((s) => Math.min(s + 1, 5));
  }

  function submitProduct() {
    const errors = validate(4);
    if (errors.length > 0) {
      setStepErrors(errors);
      submitRef.current?.scrollIntoView({ block: "center" });
      return;
    }
    if (!productIdRef.current) {
      toast.showToast("error", t("productWizard.errors.saveFirst"));
      return;
    }
    // a pending autosave would otherwise race the submit (and then fail on the
    // now-locked product): cancel it and send the latest fields with the submit
    if (timer.current) window.clearTimeout(timer.current);
    setDirty(false);
    // the action saves the product + children first, then submits for review
    submitter.submit(
      {
        intent: "submit",
        productId: productIdRef.current,
        payload: JSON.stringify(payloadOf(form)),
        children: JSON.stringify(childrenPayload(childList)),
      },
      { method: "post" },
    );
  }

  /** admin mode: the sticky bar saves everything and records the reason */
  function saveAdmin() {
    const trimmed = reason.trim();
    if (trimmed.length < 5) {
      setStepErrors([t("adminProductEdit.reasonRequired")]);
      submitRef.current?.scrollIntoView({ block: "center" });
      return;
    }
    const errors = validate(4);
    if (errors.length > 0) {
      setStepErrors(errors);
      submitRef.current?.scrollIntoView({ block: "center" });
      return;
    }
    if (!productIdRef.current) return;
    setStepErrors([]);
    adminSave.submit(
      {
        intent: "admin_save",
        productId: productIdRef.current,
        payload: JSON.stringify(payloadOf(form)),
        children: JSON.stringify(childrenPayload(childList)),
        reason: trimmed,
      },
      { method: "post" },
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <meta name="robots" content="noindex, nofollow" />
      <WizardHeader
        productId={productId}
        product={currentProduct}
        isAr={isAr}
        saving={admin ? adminSave.state !== "idle" : save.state !== "idle" || childSave.state !== "idle" || dirty}
        savedAt={savedAt}
        mode={mode}
        storeName={storeName}
      />

      {admin ? null : <WizardBanners product={currentProduct} editable={editable} stale={stale} />}

      <Stepper steps={STEP_KEYS.map((key) => t(key))} current={step - 1} label={t("productWizard.progressLabel")} />
      {/* platform commission — admin and staff only (the route passes the store id only to them) */}
      {commissionVendorId ? (
        <LiveCommissionBox vendorId={commissionVendorId} leafId={form.leaf_category_id || null} lang={isAr ? "ar" : "en"}
          groups={childList.map((c) => ({ price: toPiastres(c.price), sale: toPiastres(c.sale_price), sale_starts_at: c.sale_starts_at || null, sale_ends_at: c.sale_ends_at || null }))} />
      ) : null}
      <ErrorSummary errors={stepErrors} summaryRef={submitRef} />

      <Card>
        <CardBody className="flex flex-col gap-4 p-5">
          {step === 1 ? <BasicInfoStep form={form} patch={patch} /> : null}

          {step === 2 ? (
            <ClassificationStep
              form={form}
              patch={patch}
              categories={categories}
              brands={brands}
              tags={tags}
              isAr={isAr}
              uid={uid}
              supabaseUrl={supabaseUrl}
              media={media}
              galleryOpen={galleryPicker}
              onGalleryOpenChange={setGalleryPicker}
              onCategoryChange={(id) => {
                patch({ leaf_category_id: id, attributes: {} });
                tplFetch.submit({ intent: "template", leaf_category_id: id }, { method: "post" });
              }}
              canPropose={!admin}
              onBrandAdded={(brand) => {
                setBrands((current) => (current.some((b) => b.id === brand.id) ? current : [...current, brand]));
                patch({ brand_id: brand.id });
              }}
            />
          ) : null}

          {step === 3 ? <AttributesStep template={template} form={form} patch={patch} isAr={isAr} /> : null}

          {step === 4 ? (
            <ChildrenStep
              childList={childList}
              setChildList={setChildList}
              colors={colorAttr?.options ?? []}
              sizes={formSizes}
              ramOptions={ramAttr?.options ?? []}
              mode={variantMode}
              hasColor={hasColor}
              hasSize={hasSize}
              isAr={isAr}
              media={media}
              uid={uid}
              supabaseUrl={supabaseUrl}
              canSave={Boolean(productId)}
              saving={childSave.state !== "idle"}
              onSave={saveChildren}
              editable={editable}
              adminMode={admin}
            />
          ) : null}
          {step === 4 && hasSizeChart ? (
            <SizeChartEditor
              chart={form.size_chart}
              onChange={(next) => patch({ size_chart: next })}
              suggested={suggestedGarment}
              sizes={sizeLabels}
              isAr={isAr}
              editable={editable}
            />
          ) : null}

          {step === 5 ? (
            <ShippingStep
              form={form}
              patch={patch}
              categories={categories}
              isAr={isAr}
              childList={childList}
              editable={editable}
              saving={submitter.state !== "idle"}
              onMarkDirty={() => setDirty(true)}
              onSubmit={submitProduct}
              shippingBlocked={shippingBlocked}
              showActions={!admin}
            />
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

      {/* admin mode: one sticky action — the reason is shown to the seller */}
      {admin ? (
        <div className="sticky bottom-0 z-20 flex flex-col gap-2 rounded-lg border-2 border-action/40 bg-surface p-3 shadow-2">
          <label className="flex flex-col gap-1.5 text-sm font-bold text-text">
            {t("adminProductEdit.reasonLabel")}
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              maxLength={500}
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm font-normal text-text focus:border-action focus:outline-none"
            />
            <span className="text-xs font-normal text-text-muted">{t("adminProductEdit.reasonHint")}</span>
          </label>
          <div className="flex justify-end">
            <Button type="button" loading={adminSave.state !== "idle"} disabled={reason.trim().length < 5} onClick={saveAdmin}>
              {t("adminProductEdit.save")}
            </Button>
          </div>
        </div>
      ) : null}

      <Dialog open={blocker.state === "blocked"} onClose={() => { setLeaving(false); blocker.reset?.(); }} title={t("productWizard.leave.title")}>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text-muted">{t("productWizard.leave.body")}</p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" disabled={leaving} onClick={() => { setLeaving(false); blocker.reset?.(); }}>{t("productWizard.leave.stay")}</Button>
            <Button type="button" loading={leaving} onClick={leaveNow}>{t("productWizard.leave.go")}</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

import type { SizeChart } from "~/features/products/size-chart";
import type { MediaSettings } from "~/lib/media.shared";
import type { LoaderChild, SizeOption } from "./children";

/**
 * Shared types for the product wizard (V-11..V-17): leaf-template attributes,
 * picker categories, loader variants, the client-side form shape, the
 * orchestrator props and the route action result contract (`SaveActionData`).
 *
 * Pure types only — no runtime code. The route
 * (`app/routes/vendor/product-wizard.tsx`) consumes several of these through
 * the orchestrator's re-exports, which must stay intact.
 */

export interface TemplateOption {
  id: string;
  label_ar: string;
  label_en: string;
  color_hex: string | null;
  /** machine code ("other" / "mixed" stay last in sorted lists) */
  code?: string;
}

export interface TemplateAttr {
  id: string;
  code: string;
  /** Human labels — the vendor form shows these, never the machine code. */
  label_ar: string;
  label_en: string;
  type: "text" | "number" | "bool" | "enum" | "color";
  unit: string;
  is_required: boolean;
  is_filterable: boolean;
  is_variant_axis: boolean;
  /** enum spec that accepts several options (e.g. cotton + elastane) */
  is_multi: boolean;
  sort: number;
  /** options offered in THIS category (the admin's per-category scope) */
  options: TemplateOption[];
}

export interface WizardBrand {
  id: string;
  name_ar: string;
  name_en: string;
  /** brand logo (public media path); null when the brand has none */
  thumb_path: string | null;
  /** the seller's own proposal, still waiting for a reviewer */
  pending?: boolean;
}

export interface PickerCategory {
  id: string;
  parent_id: string | null;
  depth: number;
  name_ar: string;
  name_en: string;
  /** used to recognise apparel / shoe branches (size chart) */
  slug_en?: string;
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
  rejected_final?: boolean;
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
  size_chart: unknown;
  updated_at: string;
  media: Array<{ kind: "image" | "video"; path: string }>;
  tag_ids: string[];
  attribute_values: Array<{ attribute_id: string; option_id: string | null; option_ids: string[] | null; value_text: string | null; value_text_en?: string | null; value_number: number | null; value_bool: boolean | null }>;
}

/** One attribute answer as held in the form (all strings — parsed on save). */
export interface WizardAttributeValue {
  /** first chosen option (single-choice specs) */
  option_id: string;
  /** every chosen option — multi-choice specs; mirrors option_id for single ones */
  option_ids: string[];
  value_text: string;
  /** English text of a free-text spec (value_text holds the Arabic) */
  value_text_en: string;
  value_number: string;
  value_bool: boolean | null;
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
  attributes: Record<string, WizardAttributeValue>;
  weight_g: string;
  dims_l: string;
  dims_w: string;
  dims_h: string;
  shipping_class: string;
  shipping_mode: "platform" | "vendor";
  size_chart: SizeChart | null;
}

export interface ProductWizardProps {
  uid: string;
  supabaseUrl: string;
  media: MediaSettings;
  product: WizardProduct | null;
  template: TemplateAttr[];
  categories: PickerCategory[];
  /** category_ids: the categories (main/sub) the brand is linked to — the
   *  picker only offers brands linked to the chosen category's branch */
  brands: WizardBrand[];
  tags: Array<{ id: string; name_ar: string; name_en: string }>;
  /** child products (variant_groups) with their media and per-size rows */
  childrenData: LoaderChild[];
  /** sizes offered for the leaf (size types assigned to its branch) */
  sizeOptions: SizeOption[];
  /** the leaf ships with the platform only (settings.shipping_rules) */
  shippingBlocked: boolean;
  isAr: boolean;
  /** seller: autosave + submit for review; admin: reason + single save, status untouched */
  mode?: "seller" | "admin";
  /** admin mode header: the store the product belongs to */
  storeName?: string;
  /** set only for admin/staff viewers: shows the live platform commission box */
  commissionVendorId?: string | null;
}

export interface SaveActionData {
  intent: "save" | "save_children" | "submit" | "template" | "add_color" | "reopen" | "admin_save" | "propose_brand";
  ok: boolean;
  error?: string;
  stale?: boolean;
  updatedAt?: string;
  redirectTo?: string;
  /** intent "save": the product id (new drafts get one on the first save) */
  productId?: string;
  /** current product status (a pending/approved save reopens it as draft) */
  status?: string;
  skipped?: string[];
  /** only for intent === "template" */
  template?: TemplateAttr[];
  sizeOptions?: SizeOption[];
  shippingBlocked?: boolean;
  brands?: WizardBrand[];
  /** only for intent === "propose_brand": the new/selected brand */
  brand?: WizardBrand;
  /** the proposal matched a brand that already exists (selected instead) */
  existing?: boolean;
  /** only for intent === "add_color": the created (or reused) colour */
  color?: TemplateOption;
  /** only for intent === "save_children": saved ids + generated SKUs */
  children?: Array<{ id: string; sizes: Array<{ variant_id: string; size_option_id: string | null; ram_option_id?: string | null; sku: string | null; stock: number }> }>;
}

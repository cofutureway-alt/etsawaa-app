/**
 * Shared types + the code-derivation helper for the admin catalog-attributes
 * route (`app/routes/admin/catalog/attributes.tsx`) and its extracted
 * components in this folder.
 *
 * Deliberately free of React components and server-only imports so the route
 * module (loader/action) and the client components can both import from here.
 */
import type { FetcherWithComponents } from "react-router";

/** A live leaf category (no live children) — the only place attributes attach. */
export interface LeafCategory {
  id: string; name_ar: string; name_en: string; depth: number;
  /** parent's name — tells apart a product type filed under two browse categories */
  parent_ar?: string; parent_en?: string;
}

/** One live row of `attribute_defs`. */
export interface DefRow {
  /** null = global dictionary attribute, attached to leaves via category_attributes */
  id: string; category_id: string | null; code: string;
  label_ar: string; label_en: string;
  type: "text" | "number" | "bool" | "enum" | "color";
  unit: string; is_required: boolean; is_filterable: boolean; is_variant_axis: boolean;
  /** enum spec that accepts several options per product */
  is_multi: boolean;
  sort: number;
}

/** One live row of `attribute_options` (an enum/color choice of one attribute). */
export interface OptionRow {
  id: string; attribute_id: string; code: string;
  label_ar: string; label_en: string; color_hex: string | null; image_path: string | null; sort: number;
}

/** One row of `category_attributes` (an attribute linked into a second category). */
export interface LinkRow {
  category_id: string; attribute_id: string; sort: number;
  /** options offered for this attribute in this category; null = all */
  allowed_option_ids: string[] | null;
  /** the seller must answer this spec in this category */
  is_required: boolean;
}

/** One row of the `fn_attribute_usage` RPC result (what still references an attribute). */
export interface UsageRow { ref_type: string; ref_label: string }

/** Which form the attribute-def dialog is in; null = closed. */
export type DefDialogState = { mode: "create" } | { mode: "edit"; def: DefRow } | null;

/** The option add/edit dialog target; null = closed. */
export type OptionDialogState = { attributeId: string; option: OptionRow | null } | null;

/** The media-picker target while choosing an option image; null = closed. */
export type PickerImageState = { attributeId: string; option: OptionRow | null; path: string | null } | null;

/** Serialized return shape of the route `action` in attributes.tsx. */
export type AttributeActionData = { ok: boolean; reason?: string };

/**
 * The single fetcher shared by every form on the page (def, option, link and
 * delete dialogs all submit through it, and the route watches it for toasts).
 */
export type AttributesFetcher = FetcherWithComponents<AttributeActionData>;

/** Derive the machine code from the English label; the admin can still edit it. */
export function slugifyCode(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

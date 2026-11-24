import { egpToPiastres, piastresToEgp } from "~/lib/money";

/**
 * Child products (variant_groups) in the seller wizard — pure state helpers.
 * A child = one colour + price + discount window + images, with one stock
 * row per selected size (stock is per size). Saved through fn_save_children.
 */

export interface ChildSize {
  /** "" when the product type has no size axis (one plain stock row) */
  size_option_id: string;
  stock: string;
  sku: string | null;
  /** the seller typed this SKU: send it (empty = back to the generated one); untouched rows keep theirs */
  skuEdited?: boolean;
  /** phones / computers: the row's RAM ("" = none) */
  ram_option_id?: string;
  /** a row's own price / sale price ("" = the variant's) — phones: each storage + RAM has its price */
  price?: string;
  sale_price?: string;
}

/**
 * How a variant's rows are entered. "sizes": pick several sizes, one shared
 * price (clothing, pack sizes). "config": phones / computers — each row is a
 * configuration (storage + RAM) with its own price, sale price and stock.
 */
export interface VariantMode {
  config: boolean;
  hasRam: boolean;
}
export const SIZES_MODE: VariantMode = { config: false, hasRam: false };

export interface ChildDraft {
  /** stable client key (React lists) */
  key: string;
  id: string | null;
  color_option_id: string;
  sizes: ChildSize[];
  price: string;
  sale_price: string;
  /** datetime-local strings ("2026-11-30T23:59") */
  sale_starts_at: string;
  sale_ends_at: string;
  images: string[];
}

/** Loader shape: one variant_groups row with its media and live variants. */
export interface LoaderChild {
  id: string;
  color_option_id: string | null;
  price_piastres: number | null;
  sale_price_piastres: number | null;
  sale_starts_at: string | null;
  sale_ends_at: string | null;
  images: string[];
  sizes: Array<{ size_option_id: string | null; stock: number; sku: string | null; ram_option_id?: string | null; price_piastres?: number | null; sale_price_piastres?: number | null }>;
}

export interface SizeOption {
  option_id: string;
  label_ar: string;
  label_en: string;
  size_type_id: string;
  type_name_ar: string;
  type_name_en: string;
  /** option code — pack sizes are `wt_<grams>g` (weight) and `vol_<ml>ml` (volume) */
  code?: string;
}

/** spec attributes that say whether a consumable is solid or liquid */
const FORM_ATTRS = ["detergent_form", "cleaner_form", "formulation", "product_form"];
const SOLID_FORMS = new Set(["powder", "tablets", "tablet", "pods", "sheets", "bar", "capsule", "stick", "balm"]);
const LIQUID_FORMS = new Set(["liquid", "gel", "spray", "foam", "lotion", "oil", "serum", "mousse"]);

/**
 * Pack sizes that fit the product's form: a powder / tablets is sold by weight
 * (g, kg) and a liquid / gel by volume (mL, L). Without a form chosen — or for
 * clothing / shoe sizes — every size is offered.
 */
export function packSizesForForm(
  sizes: SizeOption[],
  template: Array<{ id: string; code: string; options: Array<{ id: string; code?: string }> }>,
  attributes: Record<string, { option_id: string } | undefined>,
): SizeOption[] {
  let form: string | undefined;
  for (const attr of template) {
    if (!FORM_ATTRS.includes(attr.code)) continue;
    const chosen = attributes[attr.id]?.option_id;
    form = attr.options.find((o) => o.id === chosen)?.code;
    if (form) break;
  }
  if (!form) return sizes;
  if (SOLID_FORMS.has(form)) return sizes.filter((s) => !s.code?.startsWith("vol_"));
  if (LIQUID_FORMS.has(form)) return sizes.filter((s) => !s.code?.startsWith("wt_"));
  return sizes;
}

let seq = 0;
export const newKey = () => `c${Date.now().toString(36)}${(seq++).toString(36)}`;

/** ISO → value for <input type="datetime-local"> in the viewer's zone. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Colour and size are OPTIONAL: a child without sizes keeps one plain stock
// row (size_option_id ""), so a simple product (e.g. detergent) is just price + stock.
export function emptyChild(_hasSize: boolean, colorId = ""): ChildDraft {
  return {
    key: newKey(), id: null, color_option_id: colorId,
    sizes: [{ size_option_id: "", stock: "0", sku: null }],
    price: "", sale_price: "", sale_starts_at: "", sale_ends_at: "", images: [],
  };
}

export function childrenFromLoader(children: LoaderChild[], _hasSize: boolean): ChildDraft[] {
  return children.map((c) => ({
    key: newKey(),
    id: c.id,
    color_option_id: c.color_option_id ?? "",
    sizes: c.sizes.length > 0
      ? c.sizes.map((s) => {
          // a row priced apart from its variant keeps its own price
          const own = s.price_piastres != null && s.price_piastres !== c.price_piastres;
          return {
            size_option_id: s.size_option_id ?? "", stock: String(s.stock), sku: s.sku,
            ram_option_id: s.ram_option_id ?? "",
            price: own ? piastresToEgp(s.price_piastres ?? null) : "",
            sale_price: own ? piastresToEgp(s.sale_price_piastres ?? null) : "",
          };
        })
      : [{ size_option_id: "", stock: "0", sku: null }],
    price: piastresToEgp(c.price_piastres),
    sale_price: piastresToEgp(c.sale_price_piastres),
    sale_starts_at: toLocalInput(c.sale_starts_at),
    sale_ends_at: toLocalInput(c.sale_ends_at),
    images: c.images,
  }));
}

export function childrenPayload(children: ChildDraft[]) {
  return children.map((c) => ({
    id: c.id,
    color_option_id: c.color_option_id || null,
    price_piastres: egpToPiastres(c.price),
    sale_price_piastres: c.sale_price.trim() ? egpToPiastres(c.sale_price) : null,
    sale_starts_at: c.sale_starts_at ? new Date(c.sale_starts_at).toISOString() : null,
    sale_ends_at: c.sale_ends_at ? new Date(c.sale_ends_at).toISOString() : null,
    images: c.images,
    sizes: c.sizes.map((s) => ({
      size_option_id: s.size_option_id || null,
      ram_option_id: s.ram_option_id || null,
      stock: Math.max(0, Math.trunc(Number(s.stock)) || 0),
      ...(s.skuEdited ? { sku: (s.sku ?? "").trim() } : {}),
      // only rows priced on their own (configuration rows) send a price
      ...(s.price?.trim() ? {
        price_piastres: egpToPiastres(s.price),
        sale_price_piastres: s.sale_price?.trim() ? egpToPiastres(s.sale_price) : null,
      } : {}),
    })),
  }));
}

/** A child with no colour and no size: just price + stock (a product without variants). */
export function isPlainChild(c: ChildDraft): boolean {
  return !c.color_option_id && c.sizes.every((s) => !s.size_option_id);
}

/**
 * "No variants" mode: nothing added yet, or exactly one child. The base offer
 * is one group whose sizes are rows, so one colour with several sizes is still
 * a product without sub-products.
 */
export function isBaseOffer(children: ChildDraft[]): boolean {
  return children.length <= 1;
}

/**
 * A new variant starts with the previous variant's price, sale price and sale
 * window (the seller edits them if this one differs); colour, sizes and stock
 * start empty.
 */
export function nextVariant(children: ChildDraft[], hasSize: boolean): ChildDraft {
  const prev = children[children.length - 1];
  const fresh = emptyChild(hasSize);
  return prev
    ? { ...fresh, price: prev.price, sale_price: prev.sale_price, sale_starts_at: prev.sale_starts_at, sale_ends_at: prev.sale_ends_at }
    : fresh;
}

/**
 * What the size axis means for this product type, for its wording: clothing
 * sizes, pack sizes (g / mL) or capacities (storage, RAM + storage).
 */
export function sizeAxisKind(sizes: Array<Pick<SizeOption, "code">>): "size" | "pack" | "storage" {
  if (sizes.length === 0) return "size";
  if (sizes.every((s) => /^(st|rs)_/.test(s.code ?? ""))) return "storage";
  if (sizes.every((s) => /^(wt|vol)_/.test(s.code ?? ""))) return "pack";
  return "size";
}

/** "Add variant": the base offer (if filled) becomes variant 1 and a new variant follows (inheriting its prices). */
export function addVariant(children: ChildDraft[], hasSize: boolean): ChildDraft[] {
  const base = children[0];
  const baseHasData = Boolean(base && (base.color_option_id || base.price.trim() || base.images.length
    || base.sizes.some((s) => s.size_option_id || s.ram_option_id || Number(s.stock) > 0)));
  if (children.length === 0 || (children.length === 1 && !baseHasData)) return [nextVariant(children, hasSize)];
  return [...children, nextVariant(children, hasSize)];
}

/** Per-child problems (translation keys) — empty array = the child is complete. */
/** A new configuration row: the previous row's price and sale price, no storage / RAM yet. */
export function nextConfigRow(rows: ChildSize[], fallbackPrice = "", fallbackSale = ""): ChildSize {
  const prev = rows[rows.length - 1];
  return {
    size_option_id: "", ram_option_id: "", stock: "0", sku: null,
    price: prev?.price || fallbackPrice, sale_price: prev?.sale_price ?? fallbackSale,
  };
}

export function childProblems(c: ChildDraft, all: ChildDraft[], hasColor: boolean, hasSize: boolean, mode: VariantMode = SIZES_MODE): string[] {
  const out: string[] = [];
  // A product without variants (one plain row) needs only price + stock. Once
  // it HAS variants, every variant must carry the options its category uses:
  // a colour (when the category has colours) and its sizes (when it has sizes).
  const variantMode = !isBaseOffer(all);
  // colour is optional on the base offer; its size axis too, unless the rows
  // are configurations (storage + RAM) or several sizes are offered — then
  // every row must name its size so none is saved blank
  const needColor = variantMode && hasColor;
  const needSize = hasSize && (variantMode || mode.config || c.sizes.length > 1);
  if (needColor && !c.color_option_id) out.push("children.err.color");
  if (needSize && c.sizes.some((s) => !s.size_option_id)) out.push("children.err.sizes");
  // one colour = one variant (its sizes are rows inside it)
  if (c.color_option_id && all.some((o) => o.key !== c.key && o.color_option_id === c.color_option_id)) out.push("children.err.colorTaken");
  if (mode.config) {
    // configuration rows: each has its own price (+ sale), storage and RAM, never twice the same
    if (mode.hasRam && c.sizes.some((s) => !s.ram_option_id)) out.push("children.err.ram");
    if (c.sizes.some((s) => !egpToPiastres(s.price ?? ""))) out.push("children.err.rowPrice");
    if (c.sizes.some((s) => {
      if (!s.sale_price?.trim()) return false;
      const p = egpToPiastres(s.price ?? ""), sale = egpToPiastres(s.sale_price);
      return !sale || (p != null && sale >= p);
    })) out.push("children.err.sale");
    const combos = c.sizes.map((s) => `${s.size_option_id}|${s.ram_option_id ?? ""}`);
    if (new Set(combos).size !== combos.length) out.push("children.err.rowDuplicate");
  } else {
    const price = egpToPiastres(c.price);
    if (!price) out.push("children.err.price");
    if (c.sale_price.trim()) {
      const sale = egpToPiastres(c.sale_price);
      if (!sale || (price && sale >= price)) out.push("children.err.sale");
    }
  }
  if (c.sale_starts_at && c.sale_ends_at && new Date(c.sale_ends_at) <= new Date(c.sale_starts_at)) out.push("children.err.window");
  if (c.sizes.some((s) => !/^\d+$/.test(s.stock.trim()))) out.push("children.err.stock");
  // a variant without colour / size can't be picked once another variant has
  // one (its stock would show while it can never be bought): all or none
  const anyColor = all.some((o) => Boolean(o.color_option_id));
  const anySize = all.some((o) => o.sizes.some((s) => Boolean(s.size_option_id)));
  if (!needColor && anyColor && !c.color_option_id) out.push("children.err.colorMixed");
  if (!needSize && anySize && c.sizes.some((s) => !s.size_option_id)) out.push("children.err.sizeMixed");
  // the same colour may have several children, but never the same size twice
  // (configuration rows are checked per storage + RAM above)
  const clash = !mode.config && all.some((o) => o.key !== c.key && o.color_option_id === c.color_option_id
    && o.sizes.some((s) => c.sizes.some((m) => m.size_option_id === s.size_option_id)));
  if (clash) out.push("children.err.duplicate");
  return out;
}

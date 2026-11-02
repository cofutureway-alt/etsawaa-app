/**
 * Compare (S-21 / US-13): two products, any categories, URL-based
 * `/compare?ids=p1,p2`. The staging list lives in localStorage; the pure
 * diff logic is shared with tests/unit.
 */

const COMPARE_KEY = "etsawaa.compare.v1";
export const COMPARE_MAX = 2;

export function readCompare(): string[] {
  try {
    const raw = localStorage.getItem(COMPARE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as string[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id) => typeof id === "string").slice(0, COMPARE_MAX);
  } catch {
    return [];
  }
}

function writeCompare(ids: string[]): void {
  try {
    localStorage.setItem(COMPARE_KEY, JSON.stringify(ids.slice(0, COMPARE_MAX)));
  } catch { /* non-critical */ }
}

/** Pure staging reducer (unit-tested): max two, same id blocked, toggle removes. */
export function toggleCompareStaging(
  current: string[],
  productId: string,
): { ids: string[]; added: boolean; blocked: boolean } {
  if (current.includes(productId)) {
    return { ids: current.filter((id) => id !== productId), added: false, blocked: false };
  }
  if (current.length >= COMPARE_MAX) {
    return { ids: current, added: false, blocked: true };
  }
  return { ids: [...current, productId], added: true, blocked: false };
}

/** Toggle a product in the staging list; same product twice is blocked. */
export function toggleCompare(productId: string): { ids: string[]; added: boolean; blocked: boolean } {
  const result = toggleCompareStaging(readCompare(), productId);
  writeCompare(result.ids);
  return result;
}

export function clearCompare(): void {
  try {
    localStorage.removeItem(COMPARE_KEY);
  } catch { /* non-critical */ }
}

/* ------------------------------------------------------------------ pure diff */

export interface CompareAttribute {
  attribute_id: string;
  label_ar: string;
  label_en: string;
  /** Display value for the product, localized at build time of the row. */
  value_ar: string | null;
  value_en: string | null;
}

export interface CompareProduct {
  id: string;
  name_ar: string;
  name_en: string;
  slug_ar: string;
  slug_en: string;
  leaf_category_id: string | null;
  price_piastres: number | null;
  rating_avg: number | null;
  rating_count: number;
  store_name_ar: string;
  store_name_en: string;
  store_slug: string;
  image_path: string | null;
  attributes: CompareAttribute[];
}

export interface CompareSide {
  a: CompareProduct | null;
  b: CompareProduct | null;
  /** Attributes present (with a value) on BOTH products, in order. */
  shared: Array<{ attribute_id: string; label_ar: string; label_en: string; value_a: string | null; value_b: string | null }>;
  /** true when the two products come from different leaf categories */
  differentCategories: boolean;
}

function attrValue(p: CompareProduct, attributeId: string, locale: "ar" | "en"): string | null {
  const attr = p.attributes.find((a) => a.attribute_id === attributeId);
  if (!attr) return null;
  if (locale === "ar") return attr.value_ar ?? attr.value_en;
  return attr.value_en ?? attr.value_ar;
}

/**
 * Shared-attribute table for /compare. Only attributes that exist AND hold a
 * value on both products are listed; price/rating/vendor rows are always
 * shown. Different categories → the caller shows the "common fields only"
 * notice (US-13 edge).
 */
export function compareProducts(a: CompareProduct | null, b: CompareProduct | null, locale: "ar" | "en"): CompareSide {
  if (!a || !b || a.id === b.id) {
    return { a, b, shared: [], differentCategories: false };
  }
  const differentCategories = a.leaf_category_id !== b.leaf_category_id;
  const sharedIds = a.attributes
    .filter((attr) => attr.attribute_id && b.attributes.some((other) => other.attribute_id === attr.attribute_id))
    .map((attr) => attr.attribute_id);
  const seen = new Set<string>();
  const shared: CompareSide["shared"] = [];
  for (const attr of a.attributes) {
    if (!sharedIds.includes(attr.attribute_id) || seen.has(attr.attribute_id)) continue;
    seen.add(attr.attribute_id);
    const va = attrValue(a, attr.attribute_id, locale);
    const vb = attrValue(b, attr.attribute_id, locale);
    if (va == null || vb == null) continue; // value missing on one side → not comparable
    shared.push({
      attribute_id: attr.attribute_id,
      label_ar: attr.label_ar,
      label_en: attr.label_en,
      value_a: va,
      value_b: vb,
    });
  }
  return { a, b, shared, differentCategories };
}

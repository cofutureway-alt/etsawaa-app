import type { TFunction } from "i18next";

/**
 * How a notification reads, whatever shape its payload has.
 *
 * Two payload shapes exist in `notifications`:
 *  1. bilingual — { ar: {title, body}, en: {title, body}, link }
 *  2. fields only — written by the store / product / verification flows,
 *     e.g. { vendor_id, store_name_ar, reason } or { product_id, name_ar, name_en }.
 * Shape 2 used to render as "—". Here each such type gets a translated
 * title + body built from its fields and a link derived from its ids, and
 * every link is put under the reader's language (/ar or /en): payloads
 * store links like "/vendor" or "/ar/account/orders/…".
 */

export interface NotificationLike {
  type: string;
  payload: Record<string, unknown> | null;
}
export interface NotificationView { title: string; body: string; link: string | null }

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** "/vendor" → "/ar/vendor"; "/en/account/…" stays under the reader's language. */
export function localizeLink(link: string | null | undefined, lang: "ar" | "en"): string | null {
  if (!link || !link.startsWith("/") || link.startsWith("//")) return null;
  const m = /^\/(ar|en)(\/|$)/.exec(link);
  return m ? `/${lang}${link.slice(3) || ""}` : `/${lang}${link}`;
}

/** Link for field-only payloads (bilingual ones carry their own). */
function derivedLink(type: string, p: Record<string, unknown>): string | null {
  const product = str(p.product_id);
  if (type === "product.pending") return product ? `/admin/products/${product}` : "/admin/products";
  if (type === "brand.proposed") return "/admin/catalog/brands";
  // brand decisions lead the seller back to the product the brand belongs to
  if (type.startsWith("brand.")) return product ? `/vendor/products/${product}/edit` : "/vendor/products";
  // the seller sees the edit (and its reason) on the product's own edit page
  if (type === "product.admin_edited") return product ? `/vendor/products/${product}/edit` : "/vendor/products";
  if (type.startsWith("product.")) return "/vendor/products";
  if (type === "vendor.submitted" || type === "vendor.grace_expired") return "/admin/vendors";
  if (type === "vendor.change_request") return "/admin/store-changes";
  if (type.startsWith("vendor.change_")) return "/vendor/store";
  if (type === "vendor.rejected") return "/vendor/onboarding";
  if (type.startsWith("vendor.")) return "/vendor";
  if (type.startsWith("verification.")) return "/vendor/verification";
  return null;
}

export function formatNotification(row: NotificationLike, lang: "ar" | "en", t: TFunction, allowLanguageFallback = true): NotificationView {
  const p = (row.payload ?? {}) as Record<string, unknown>;
  const own = p[lang] as { title?: string; body?: string } | undefined;
  const other = p[lang === "ar" ? "en" : "ar"] as { title?: string; body?: string } | undefined;
  const bilingual = own ?? (allowLanguageFallback ? other : undefined);
  if (bilingual && str(bilingual.title)) {
    return { title: str(bilingual.title), body: str(bilingual.body), link: localizeLink(str(p.link), lang) };
  }

  const vars = {
    store: str(lang === "en" ? p.store_name_en || p.store_name_ar : p.store_name_ar || p.store_name_en) || str(p.vendor),
    name: str(lang === "en" ? p.name_en || p.name_ar : p.name_ar || p.name_en),
    reason: str(p.reason) || str(p.note),
    // brand.rejected: the replacement brand, or the explicit "no brand"
    replacement: str(lang === "en" ? p.replacement_en || p.replacement_ar : p.replacement_ar || p.replacement_en) || t("notif.brand.noBrand"),
  };
  // product.rejected with final=true is the permanent rejection
  const key = row.type === "product.rejected" && p.final === true ? "product.rejected_final" : row.type;
  const titleKey = `notif.${key}.title`;
  const title = t(titleKey, vars);
  const known = title !== titleKey;
  const parts = known ? [t(`notif.${key}.body`, vars)] : [];
  if (known && vars.reason) parts.push(t("notif.reason", { reason: vars.reason }));
  return {
    title: known ? title : t("notif.generic"),
    body: parts.filter((x) => x && !x.startsWith("notif.")).join(" — "),
    link: localizeLink(str(p.link) || derivedLink(row.type, p), lang),
  };
}

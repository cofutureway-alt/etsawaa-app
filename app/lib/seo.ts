import type { MetaDescriptor } from "react-router";

/**
 * SEO helpers (AGENT.md §11): canonical + hreflang ar/en + OG/Twitter meta
 * for every public page, and JSON-LD builders. Panel/auth routes stay
 * noindex (handled in their layouts).
 */

export function siteUrl(): string {
  // import.meta.env works on the server (vite define) AND in the client
  // bundle — meta() runs client-side during SPA navigations
  return ((import.meta.env.SITE_URL as string | undefined) ?? "http://localhost:3000").replace(/\/$/, "");
}

export interface PageSeoInput {
  lang: "ar" | "en";
  /** Path WITHOUT the locale prefix, e.g. "/products?cat=x" */
  path: string;
  /**
   * The same page's path in the OTHER language when it differs (product,
   * category, brand, blog slugs are per-language) — keeps hreflang honest.
   */
  altPath?: string;
  title: string;
  description: string;
  /** absolute URL (see absoluteMediaUrl); defaults to the 1200×630 JPG card */
  ogImage?: string;
  ogImageAlt?: string;
  /** og:type — "website" (default), "product", "article" */
  ogType?: "website" | "product" | "article";
  /** page-specific keywords, merged ahead of the site-wide set */
  keywords?: string[];
  /** extra meta tags (product:price:amount …) */
  extra?: MetaDescriptor[];
  /** true for pages that must stay out of the index (empty shells etc.) */
  noindex?: boolean;
}

/** Site-wide search terms (Egyptian Arabic + English shoppers). */
export const SITE_KEYWORDS: Record<"ar" | "en", string[]> = {
  ar: [
    "إتسوء", "تسوق اونلاين", "تسوق اونلاين في مصر", "متجر الكتروني", "سوق الكتروني مصري",
    "شراء اونلاين", "الدفع عند الاستلام", "توصيل لكل المحافظات", "عروض وخصومات",
    "موبايلات", "الكترونيات", "ملابس", "احذية", "اجهزة منزلية", "مستلزمات اطفال", "تجميل وعناية",
  ],
  en: [
    "Etsawaa", "online shopping Egypt", "Egyptian marketplace", "buy online in Egypt", "online store Egypt",
    "cash on delivery Egypt", "delivery to all governorates", "deals and discounts",
    "mobiles", "electronics", "fashion", "shoes", "home appliances", "baby products", "beauty",
  ],
};

const DEFAULT_OG = { path: "/og-default.jpg", width: "1200", height: "630", type: "image/jpeg" };

/** Absolute, crawler-fetchable URL for a public media object (WhatsApp/Facebook need absolute og:image). */
export function absoluteMediaUrl(path: string): string {
  return `${siteUrl()}/api/media?path=${encodeURIComponent(path)}`;
}

/** og:image for a stored media path, only when the same-origin proxy can serve it. */
export function ogMedia(path: string | null | undefined): string | undefined {
  return path && /^(u\/[0-9a-fA-F-]{36}|brands|banners|mega)\/[A-Za-z0-9._-]+$/.test(path) ? absoluteMediaUrl(path) : undefined;
}

/** Full meta set for a public page: title/description + canonical + hreflang + OG. */
export function publicMeta({ lang, path, altPath, title, description, ogImage, ogImageAlt, ogType, keywords, extra, noindex }: PageSeoInput): MetaDescriptor[] {
  const base = siteUrl();
  const norm = (p: string) => { const c = p.startsWith("/") ? p : `/${p}`; return c === "/" ? "" : c; };
  const own = norm(path);
  const alt = norm(altPath ?? path);
  const canonical = `${base}/${lang}${own}`;
  const other = lang === "ar" ? "en" : "ar";
  const arUrl = lang === "ar" ? canonical : `${base}/ar${alt}`;
  const enUrl = lang === "en" ? canonical : `${base}/en${alt}`;
  const image = ogImage ?? `${base}${DEFAULT_OG.path}`;
  const robots = noindex ? "noindex, nofollow" : "index, follow, max-image-preview:large, max-snippet:-1";
  const kw = [...new Set([...(keywords ?? []).filter(Boolean), ...SITE_KEYWORDS[lang]])].slice(0, 25).join(", ");
  return [
    { title },
    { name: "description", content: description },
    { name: "keywords", content: kw },
    { name: "robots", content: robots },
    { tagName: "link", rel: "canonical", href: canonical },
    { tagName: "link", rel: "alternate", href: arUrl, hreflang: "ar" },
    { tagName: "link", rel: "alternate", href: enUrl, hreflang: "en" },
    { tagName: "link", rel: "alternate", href: arUrl, hreflang: "x-default" },
    { property: "og:type", content: ogType ?? "website" },
    { property: "og:site_name", content: lang === "ar" ? "إتسوء Etsawaa" : "Etsawaa" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:url", content: canonical },
    { property: "og:image", content: image },
    { property: "og:image:secure_url", content: image },
    ...(ogImage ? [] : [
      { property: "og:image:type", content: DEFAULT_OG.type },
      { property: "og:image:width", content: DEFAULT_OG.width },
      { property: "og:image:height", content: DEFAULT_OG.height },
    ]),
    { property: "og:image:alt", content: ogImageAlt ?? title },
    { property: "og:locale", content: lang === "ar" ? "ar_EG" : "en_US" },
    { property: "og:locale:alternate", content: other === "ar" ? "ar_EG" : "en_US" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: image },
    ...(extra ?? []),
  ];
}

/** JSON-LD <script> payload (rendered server-side into the HTML). */
export function jsonLd(data: Record<string, unknown> | Array<Record<string, unknown>>): { __html: string } {
  return { __html: JSON.stringify(data).replace(/</g, "\\u003c") };
}

export function breadcrumbLd(lang: "ar" | "en", items: Array<{ name: string; path?: string }>): Record<string, unknown> {
  const base = siteUrl();
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      // the last crumb (current page) may omit its URL, per Google's guidance
      ...(item.path ? { item: `${base}${item.path === "/" ? `/${lang}` : item.path}` } : {}),
    })),
  };
}

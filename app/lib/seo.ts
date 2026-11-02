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
  title: string;
  description: string;
  ogImage?: string;
  /** true for pages that must stay out of the index (empty shells etc.) */
  noindex?: boolean;
}

/** Full meta set for a public page: title/description + canonical + hreflang. */
export function publicMeta({ lang, path, title, description, ogImage, noindex }: PageSeoInput): MetaDescriptor[] {
  const base = siteUrl();
  const clean = path.startsWith("/") ? path : `/${path}`;
  const canonical = `${base}/${lang}${clean === "/" ? "" : clean}`;
  const other = lang === "ar" ? "en" : "ar";
  const image = ogImage ?? `${base}/og-default.webp`;
  const robots = noindex ? "noindex, nofollow" : "index, follow";
  return [
    { title },
    { name: "description", content: description },
    { name: "robots", content: robots },
    { tagName: "link", rel: "canonical", href: canonical },
    { tagName: "link", rel: "alternate", href: `${base}/${lang}${clean === "/" ? "" : clean}`, hreflang: lang },
    { tagName: "link", rel: "alternate", href: `${base}/${other}${clean === "/" ? "" : clean}`, hreflang: other },
    { tagName: "link", rel: "alternate", href: `${base}/ar${clean === "/" ? "" : clean}`, hreflang: "x-default" },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: "Etsawaa" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:url", content: canonical },
    { property: "og:image", content: image },
    { property: "og:locale", content: lang === "ar" ? "ar_EG" : "en_US" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: image },
  ];
}

/** JSON-LD <script> payload (rendered server-side into the HTML). */
export function jsonLd(data: Record<string, unknown> | Array<Record<string, unknown>>): { __html: string } {
  return { __html: JSON.stringify(data).replace(/</g, "\\u003c") };
}

export function breadcrumbLd(lang: "ar" | "en", items: Array<{ name: string; path: string }>) {
  const base = siteUrl();
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: `${base}${item.path === "/" ? `/${lang}` : item.path}`,
    })),
  };
}

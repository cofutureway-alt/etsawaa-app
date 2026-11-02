import type { Route } from "./+types/sitemap[.xml]";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { siteUrl } from "~/lib/seo";


/**
 * Dynamic sitemap.xml (AGENT §11 / S-14): static pages, categories,
 * products, stores, brands — each URL carries ar/en hreflang alternates.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const base = siteUrl();
  const { client } = createSupabaseServerClient(request);
  type Entry = { path: string; lastmod?: string };
  const entries: Entry[] = [];

  if (client) {
    const [pages, cats, products, stores, brands, posts] = await Promise.all([
      client.from("static_pages").select("slug_ar, slug_en, updated_at").eq("is_active", true),
      client.from("v_storefront_categories").select("slug_ar, slug_en"),
      client.from("v_storefront_products").select("slug_ar, slug_en, published_at").eq("is_listable", true).limit(5000),
      client.from("v_storefront_stores").select("slug").eq("status", "active").eq("is_listable", true).limit(2000),
      client.from("v_storefront_brands").select("slug_ar, slug_en").limit(2000),
      client.from("blog_posts").select("slug_ar, slug_en, published_at").eq("status", "published").limit(1000),
    ]);
    for (const row of pages.data ?? []) {
      const r = row as { slug_ar: string; updated_at: string | null };
      entries.push({ path: `/p/${encodeURIComponent(r.slug_ar)}`, lastmod: r.updated_at ?? undefined });
    }
    for (const row of cats.data ?? []) entries.push({ path: `/category/${encodeURIComponent((row as { slug_ar: string }).slug_ar)}` });
    for (const row of products.data ?? []) {
      const r = row as { slug_ar: string; published_at: string | null };
      entries.push({ path: `/product/${encodeURIComponent(r.slug_ar)}`, lastmod: r.published_at ?? undefined });
    }
    for (const row of stores.data ?? []) entries.push({ path: `/store/${encodeURIComponent((row as { slug: string }).slug)}` });
    for (const row of brands.data ?? []) entries.push({ path: `/brand/${encodeURIComponent((row as { slug_ar: string }).slug_ar)}` });
    for (const row of (posts.data ?? []) as Array<{ slug_ar: string; published_at: string | null }>) {
      entries.push({ path: `/blog/${encodeURIComponent(row.slug_ar)}`, lastmod: row.published_at ?? undefined });
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const fixed: Entry[] = [
    { path: "" },
    { path: "/products" },
    { path: "/vendors" },
    { path: "/brands" },
    { path: "/sell" },
    { path: "/contact" },
  ];

  const urls: string[] = [];
  for (const e of [...fixed, ...entries]) {
    urls.push(urlEntry(base, e.path, e.lastmod?.slice(0, 10) ?? today));
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join("\n")}\n</urlset>`;
  return new Response(xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}

/** One <url> per page (canonical = Arabic) with hreflang alternates. */
function urlEntry(base: string, path: string, lastmod: string): string {
  const ar = `${base}/ar${path}`;
  const en = `${base}/en${path}`;
  return [
    "  <url>",
    `    <loc>${ar}</loc>`,
    `    <xhtml:link rel="alternate" hreflang="ar" href="${ar}"/>`,
    `    <xhtml:link rel="alternate" hreflang="en" href="${en}"/>`,
    `    <xhtml:link rel="alternate" hreflang="x-default" href="${ar}"/>`,
    `    <lastmod>${lastmod}</lastmod>`,
    "  </url>",
  ].join("\n");
}


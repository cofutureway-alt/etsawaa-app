import type { Route } from "./+types/sitemap[.xml]";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { siteUrl } from "~/lib/seo";
import { fetchAll } from "~/lib/supabase/fetch-all";


/**
 * Dynamic sitemap.xml (AGENT §11 / S-14): static pages, categories,
 * products, stores, brands — each URL carries ar/en hreflang alternates.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const base = siteUrl();
  const { client } = createSupabaseServerClient(request);
  /** `alt` = the English path when its slug differs from the Arabic one */
  type Entry = { path: string; alt?: string; lastmod?: string };
  const enc = encodeURIComponent;
  const entries: Entry[] = [];

  if (client) {
    const [pages, cats, products, stores, brands, posts] = await Promise.all([
      client.from("static_pages").select("slug_ar, slug_en, updated_at").eq("is_active", true),
      // paged: ~1,600 categories (with the level-4 product types) and the
      // product catalogue both outgrow PostgREST's 1000-row response cap
      fetchAll((from, to) => client.from("v_storefront_categories").select("id, path, slug_ar, slug_en").order("id").range(from, to))
        .then((data) => ({ data })),
      fetchAll((from, to) =>
        client.from("v_storefront_products").select("slug_ar, slug_en, published_at, leaf_category_id").eq("is_listable", true).order("id").range(from, to),
      ).then((data) => ({ data })),
      client.from("v_storefront_stores").select("slug").eq("status", "active").eq("is_listable", true).limit(2000),
      // >1000 brands: page past PostgREST's row cap; only brands with live products (empty ones are noindex)
      fetchAll((from, to) => client.from("v_storefront_brands").select("slug_ar, slug_en, product_count").gt("product_count", 0).order("slug_ar").range(from, to))
        .then((data) => ({ data })),
      client.from("blog_posts").select("slug_ar, slug_en, published_at").eq("status", "published").limit(1000),
    ]);
    for (const row of pages.data ?? []) {
      const r = row as { slug_ar: string; slug_en: string | null; updated_at: string | null };
      entries.push({ path: `/p/${enc(r.slug_ar)}`, alt: `/p/${enc(r.slug_en || r.slug_ar)}`, lastmod: r.updated_at ?? undefined });
    }
    // only categories with at least one listable product in their subtree —
    // empty category pages are noindex (routes/category.tsx), so listing them
    // here would point crawlers at ~1,600 thin pages
    const catRows = (cats.data ?? []) as Array<{ id: string; path: string; slug_ar: string; slug_en: string | null }>;
    const pathById = new Map(catRows.map((c) => [c.id, c.path]));
    const stocked = new Set<string>();
    for (const row of (products.data ?? []) as Array<{ leaf_category_id: string | null }>) {
      const leafPath = row.leaf_category_id ? pathById.get(row.leaf_category_id) : undefined;
      if (leafPath) for (const id of leafPath.split("/")) stocked.add(id);
    }
    for (const row of catRows) {
      if (stocked.has(row.id)) entries.push({ path: `/category/${enc(row.slug_ar)}`, alt: `/category/${enc(row.slug_en || row.slug_ar)}` });
    }
    for (const row of products.data ?? []) {
      const r = row as { slug_ar: string; slug_en: string | null; published_at: string | null };
      entries.push({ path: `/product/${enc(r.slug_ar)}`, alt: `/product/${enc(r.slug_en || r.slug_ar)}`, lastmod: r.published_at ?? undefined });
    }
    for (const row of stores.data ?? []) entries.push({ path: `/store/${encodeURIComponent((row as { slug: string }).slug)}` });
    for (const row of (brands.data ?? []) as Array<{ slug_ar: string; slug_en: string | null }>) {
      entries.push({ path: `/brand/${enc(row.slug_ar)}`, alt: `/brand/${enc(row.slug_en || row.slug_ar)}` });
    }
    for (const row of (posts.data ?? []) as Array<{ slug_ar: string; slug_en: string | null; published_at: string | null }>) {
      entries.push({ path: `/blog/${enc(row.slug_ar)}`, alt: `/blog/${enc(row.slug_en || row.slug_ar)}`, lastmod: row.published_at ?? undefined });
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const fixed: Entry[] = [
    { path: "" },
    { path: "/products" },
    { path: "/vendors" },
    { path: "/brands" },
    { path: "/site-map" },
    { path: "/sell" },
    { path: "/contact" },
    { path: "/blog" },
  ];

  const urls: string[] = [];
  for (const e of [...fixed, ...entries]) {
    urls.push(...urlEntries(base, e.path, e.alt ?? e.path, e.lastmod?.slice(0, 10) ?? today));
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join("\n")}\n</urlset>`;
  return new Response(xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}

/**
 * One <url> per LANGUAGE version (Google wants every indexable URL listed),
 * each carrying the same ar/en/x-default alternates with the real per-language slug.
 */
function urlEntries(base: string, arPath: string, enPath: string, lastmod: string): string[] {
  const ar = `${base}/ar${arPath}`;
  const en = `${base}/en${enPath}`;
  const alts = [
    `    <xhtml:link rel="alternate" hreflang="ar" href="${ar}"/>`,
    `    <xhtml:link rel="alternate" hreflang="en" href="${en}"/>`,
    `    <xhtml:link rel="alternate" hreflang="x-default" href="${ar}"/>`,
  ];
  return [ar, en].map((loc) => ["  <url>", `    <loc>${loc}</loc>`, ...alts, `    <lastmod>${lastmod}</lastmod>`, "  </url>"].join("\n"));
}

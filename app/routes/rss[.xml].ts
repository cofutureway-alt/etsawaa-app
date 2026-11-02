import type { Route } from "./+types/rss[.xml]";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { siteUrl } from "~/lib/seo";


/**
 * L-02 — RSS 2.0 feed of published posts (valid XML; both locales by default
 * with a locale switch via ?lang=en). Drafts never appear.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const base = siteUrl();
  const lang = new URL(request.url).searchParams.get("lang") === "en" ? "en" : "ar";
  const { client } = createSupabaseServerClient(request);
  type Row = {
    slug_ar: string; slug_en: string; title_ar: string; title_en: string;
    excerpt_ar: string; excerpt_en: string; published_at: string | null;
  };
  const { data } = await client!
    .from("blog_posts")
    .select("slug_ar, slug_en, title_ar, title_en, excerpt_ar, excerpt_en, published_at")
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(30);

  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const items = ((data ?? []) as unknown as Row[]).map((p) => {
    const title = lang === "en" ? p.title_en : p.title_ar;
    const desc = lang === "en" ? p.excerpt_en : p.excerpt_ar;
    const link = `${base}/${lang}/blog/${encodeURIComponent(lang === "en" ? p.slug_en : p.slug_ar)}`;
    const date = (p.published_at ?? new Date().toISOString()).replace(" ", "T");
    return `    <item>\n      <title>${esc(title)}</title>\n      <link>${link}</link>\n      <guid isPermaLink="true">${link}</guid>\n      <description>${esc(desc)}</description>\n      <pubDate>${new Date(date).toUTCString()}</pubDate>\n    </item>`;
  });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${lang === "en" ? "Etsawaa Blog" : "مدونة اتسوء"}</title>
    <link>${base}/${lang}/blog</link>
    <description>${lang === "en" ? "Guides and news from the Etsawaa marketplace" : "مقالات وأخبار من سوق اتسوء"}</description>
    <language>${lang}</language>
    <atom:link href="${base}/rss.xml?lang=${lang}" rel="self" type="application/rss+xml" />
${items.join("\n")}
  </channel>
</rss>`;
  return new Response(xml, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "public, max-age=1800" },
  });
}


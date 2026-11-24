import type { LoaderFunctionArgs } from "react-router";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { siteUrl } from "~/lib/seo";
import { fetchAll } from "~/lib/supabase/fetch-all";
import { renderSitemapPdf, sitemapHtml, type SitemapCategory } from "~/features/sell/sitemap-pdf.server";

/**
 * GET /:lang/sell/sitemap.pdf — the category site map of the Sell page as a
 * PDF download (ar | en). Live, active categories only (all four levels). When
 * the host has no Chrome to print with, the same document is served as a
 * print-ready page that opens the browser's "Save as PDF" dialog.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const lang = params.lang === "en" ? "en" : params.lang === "ar" ? "ar" : null;
  if (!lang) throw new Response("Not found", { status: 404 });
  const { client } = createSupabaseServerClient(request);
  if (!client) throw new Response("Service unavailable", { status: 503 });

  const rows = await fetchAll<SitemapCategory>((from, to) =>
    client
      .from("categories")
      .select("id, parent_id, name_ar, name_en, slug_ar, slug_en, sort")
      .eq("is_active", true)
      .is("deleted_at", null)
      .lte("depth", 4)
      .order("sort")
      .order("id")
      .range(from, to),
  );
  // drop children whose parent is hidden, so the tree has no orphans
  const ids = new Set(rows.map((r) => r.id));
  const categories = rows.filter((r) => r.parent_id === null || ids.has(r.parent_id));

  const filename = `etsawaa-categories-${lang}.pdf`;
  let pdf: Buffer | null = null;
  try {
    pdf = await renderSitemapPdf(lang, categories, siteUrl());
  } catch (error) {
    console.error("[sell-sitemap-pdf] render failed:", error instanceof Error ? error.message : error);
  }
  if (pdf) {
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(pdf.length),
        "Cache-Control": "public, max-age=600",
      },
    });
  }
  return new Response(sitemapHtml(lang, categories, siteUrl(), { print: true }), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
}

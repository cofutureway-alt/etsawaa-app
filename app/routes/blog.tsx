import { data, Link } from "react-router";
import type { Route } from "./+types/blog";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requireLang } from "~/lib/lang.server";
import { publicMeta, jsonLd, breadcrumbLd } from "~/lib/seo";
import { getI18n } from "~/lib/i18n/config";
import { Breadcrumbs } from "~/components/ui/Breadcrumbs";
import { EmptyState } from "~/components/ui/EmptyState";
import { BlogCard } from "~/components/blog/BlogCard";
import { SkeletonPage } from "~/components/ui/Skeleton";


/**
 * L-01/L-02 — Public blog listing: published posts only (drafts are
 * invisible — same read policy as the article page), optional category
 * filter, BlogPosting ItemList schema. Categories from blog_categories.
 */

interface CardRow {
  slug_ar: string; slug_en: string;
  title_ar: string; title_en: string;
  excerpt_ar: string; excerpt_en: string;
  cover_path: string | null;
  category_id: string | null;
  published_at: string | null;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  const url = new URL(request.url);
  const cat = url.searchParams.get("cat") ?? "";

  let query = client
    .from("blog_posts")
    .select("slug_ar, slug_en, title_ar, title_en, excerpt_ar, excerpt_en, cover_path, category_id, published_at")
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(30);
  if (cat) query = query.eq("category_id", cat);
  const [posts, cats] = await Promise.all([
    query,
    client.from("blog_categories").select("id, name_ar, name_en, slug_ar, slug_en").order("sort"),
  ]);

  const t = getI18n(lang).t;
  const meta = publicMeta({
    lang, path: "/blog",
    title: `${t("pubBlog.title")} — ${t("app.name")}`,
    description: t("pubBlog.metaDescription"),
  });
  return {
    lang,
    posts: JSON.parse(JSON.stringify(posts.data ?? [])) as CardRow[],
    cats: JSON.parse(JSON.stringify(cats.data ?? [])) as Array<{ id: string; name_ar: string; name_en: string; slug_ar: string; slug_en: string }>,
    activeCat: cat,
    meta,
  };
}

export function meta({ loaderData }: Route.MetaArgs) {
  return loaderData.meta as unknown as ReturnType<typeof publicMeta>;
}

export default function PublicBlog({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const lang = loaderData.lang;
  const en = lang === "en";
  const catName = (id: string | null) => {
    if (!id) return undefined;
    const c = loaderData.cats.find((x) => x.id === id);
    return c ? (en ? c.name_en : c.name_ar) : undefined;
  };

  const ld = jsonLd({
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: t("pubBlog.collectionName"),
    itemListElement: loaderData.posts.map((p, i) => ({
      "@type": "ListItem", position: i + 1,
      url: `${site_()}/${lang}/blog/${encodeURIComponent(en ? p.slug_en : p.slug_ar)}`,
      name: en ? p.title_en : p.title_ar,
    })),
  });
  function site_() { return new URL(import.meta.env.SITE_URL ?? "http://localhost:3000").origin; }

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={ld} />
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(breadcrumbLd(lang, [
        { name: t("nav.home"), path: "/" },
        { name: t("pubBlog.title"), path: "/blog" },
      ]))} />

      <Breadcrumbs label={t("a11y.breadcrumbs")} items={[
        { label: t("nav.home"), href: `/${lang}` },
        { label: t("pubBlog.title") },
      ]} />
      <h1 className="mt-2 text-2xl font-extrabold text-text sm:text-3xl">{t("pubBlog.title")}</h1>
      <p className="mt-1 max-w-2xl text-sm leading-relaxed text-text-muted">{t("pubBlog.metaDescription")}</p>

      {/* category chips */}
      <nav aria-label={t("pubBlog.cats")} className="-mx-4 mt-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden">
        <Link to={`/${lang}/blog`}
          aria-current={!loaderData.activeCat ? "page" : undefined}
          className={`shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm font-bold transition-colors ${
            !loaderData.activeCat ? "border-primary bg-primary-soft text-primary" : "border-border text-text-muted hover:bg-surface-tint"
          }`}>
          {t("common.all")}
        </Link>
        {loaderData.cats.map((c) => (
          <Link key={c.id} to={`/${lang}/blog?cat=${c.id}`}
            aria-current={loaderData.activeCat === c.id ? "page" : undefined}
            className={`shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm font-bold transition-colors ${
              loaderData.activeCat === c.id ? "border-primary bg-primary-soft text-primary" : "border-border text-text-muted hover:bg-surface-tint"
            }`}>
            {en ? c.name_en : c.name_ar}
          </Link>
        ))}
      </nav>

      {loaderData.posts.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title={t("pubBlog.empty")}
            body={loaderData.activeCat ? t("pubBlog.emptyCat") : t("pubBlog.emptyHint")}
            action={
              loaderData.activeCat ? (
                <Link to={`/${lang}/blog`} className="text-sm font-bold text-primary hover:underline">
                  {t("pubBlog.allPosts")}
                </Link>
              ) : undefined
            }
          />
        </div>
      ) : (
        <ul className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {loaderData.posts.map((p) => (
            <li key={p.slug_en} className="flex">
              <BlogCard post={p} lang={lang} category={catName(p.category_id)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonPage />;
}

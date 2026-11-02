import { data, Link } from "react-router";
import type { Route } from "./+types/blog";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requireLang } from "~/lib/lang.server";
import { publicMeta, jsonLd, breadcrumbLd } from "~/lib/seo";
import { publicMediaUrl } from "~/lib/media.shared";
import { Breadcrumbs } from "~/components/ui/Breadcrumbs";
import { EmptyState } from "~/components/ui/EmptyState";
import { FallbackCover } from "~/components/blog/FallbackCover";
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
  const isAr = lang === "ar";

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

  const meta = publicMeta({
    lang, path: "/blog",
    title: `${t_BlogTitle(isAr)} — Etsawaa`,
    description: isAr
      ? "مقالات ونصائح حول البيع والشراء من سوق اتسوء متعدد البائعين."
      : "Guides and news from the Etsawaa multi-vendor marketplace.",
  });
  return {
    lang,
    posts: JSON.parse(JSON.stringify(posts.data ?? [])) as CardRow[],
    cats: JSON.parse(JSON.stringify(cats.data ?? [])) as Array<{ id: string; name_ar: string; name_en: string; slug_ar: string; slug_en: string }>,
    activeCat: cat,
    meta,
  };
}

function t_BlogTitle(isAr: boolean) { return isAr ? "المدونة" : "Blog"; }

export function meta({ loaderData }: Route.MetaArgs) {
  return loaderData.meta as unknown as ReturnType<typeof publicMeta>;
}

export default function PublicBlog({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const lang = loaderData.lang;
  const en = lang === "en";
  const supabaseUrl = process.env.SUPABASE_URL ?? "";
  const catName = (id: string | null) => {
    if (!id) return undefined;
    const c = loaderData.cats.find((x) => x.id === id);
    return c ? (en ? c.name_en : c.name_ar) : undefined;
  };

  const ld = jsonLd({
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: en ? "Etsawaa Blog" : "مدونة اتسوء",
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
      <h1 className="mt-2 text-2xl font-extrabold text-text">{t("pubBlog.title")}</h1>

      {/* category chips */}
      <nav aria-label={t("pubBlog.cats")} className="mt-3 flex flex-wrap gap-1.5">
        <Link to={`/${lang}/blog`}
          aria-current={!loaderData.activeCat ? "page" : undefined}
          className={`rounded-m border px-3 py-1.5 text-[13px] font-bold ${
            !loaderData.activeCat ? "border-primary bg-primary-soft text-primary" : "border-border text-text-muted hover:bg-surface-tint"
          }`}>
          {t("common.all")}
        </Link>
        {loaderData.cats.map((c) => (
          <Link key={c.id} to={`/${lang}/blog?cat=${c.id}`}
            aria-current={loaderData.activeCat === c.id ? "page" : undefined}
            className={`rounded-m border px-3 py-1.5 text-[13px] font-bold ${
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
                <Link to={`/${lang}/blog`} className="text-[13px] font-bold text-primary hover:underline">
                  {t("pubBlog.allPosts")}
                </Link>
              ) : undefined
            }
          />
        </div>
      ) : (
        <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {loaderData.posts.map((p) => (
            <li key={p.slug_en} className="flex">
              <Link to={`/${lang}/blog/${encodeURIComponent(en ? p.slug_en : p.slug_ar)}`}
                className="flex h-full w-full flex-col overflow-hidden rounded-m border border-border bg-surface transition-colors duration-150 hover:border-primary/40 hover:bg-surface-tint">
                {p.cover_path ? (
                  <img src={publicMediaUrl(supabaseUrl, p.cover_path)} alt="" width={600} height={315}
                    loading="lazy" decoding="async" className="aspect-[600/315] w-full object-cover" />
                ) : (
                  /* U2 — deterministic branded cover, never an empty slot */
                  <FallbackCover
                    title={en ? p.title_en : p.title_ar}
                    category={catName(p.category_id)}
                    seed={p.slug_en}
                  />
                )}
                <div className="flex flex-1 flex-col gap-1.5 p-4">
                  <h2 className="text-[15px] font-extrabold leading-snug text-text">
                    {en ? p.title_en : p.title_ar}
                  </h2>
                  <p className="line-clamp-3 text-[13px] leading-relaxed text-text-muted">{en ? p.excerpt_en : p.excerpt_ar}</p>
                  {p.published_at ? (
                    <time className="mt-auto pt-2 text-xs text-text-faint" dateTime={p.published_at} dir="ltr">
                      {new Date(p.published_at).toLocaleDateString(en ? "en-EG" : "ar-EG")}
                    </time>
                  ) : null}
                </div>
              </Link>
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

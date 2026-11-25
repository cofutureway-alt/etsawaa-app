import { data } from "react-router";
import type { Route } from "./+types/blog.$slug";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { safeSlug } from "~/lib/postgrest";
import { requireLang } from "~/lib/lang.server";
import { ogMedia, publicMeta, jsonLd, breadcrumbLd, siteUrl } from "~/lib/seo";
import { publicMediaUrl } from "~/lib/media.shared";
import { sanitizeBlogHtml } from "~/lib/sanitize";
import { Breadcrumbs } from "~/components/ui/Breadcrumbs";
import { FallbackCover } from "~/components/blog/FallbackCover";
import { BlogCard } from "~/components/blog/BlogCard";
import { SkeletonPage } from "~/components/ui/Skeleton";


/**
 * L-01 — Public article page (US-01): cover, TOC from h2/h3, reading
 * progress, share row, related posts. Drafts 404 (RLS read = published OR
 * admin, plus the explicit status filter here); moved slugs 301 via
 * slug_redirects (checked in the loader before the 404).
 */

interface PostRow {
  id: string; title_ar: string; title_en: string;
  slug_ar: string; slug_en: string; author: string | null;
  excerpt_ar: string; excerpt_en: string;
  content_ar: string; content_en: string;
  cover_path: string | null;
  published_at: string | null; updated_at: string;
  seo_title_ar: string; seo_title_en: string;
  seo_desc_ar: string; seo_desc_en: string;
  author_name: string | null;
}

export interface TocItem { id: string; text: string; level: 2 | 3 }

/** Extract h2/h3 from the markdown-ish content and add stable DOM ids. Pure — unit-tested via the page render. */
export function buildToc(html: string): TocItem[] {
  const toc: TocItem[] = [];
  let i = 0;
  for (const m of html.matchAll(/<h([23])[^>]*>(.*?)<\/h\1>/g)) {
    const level = Number(m[1]) as 2 | 3;
    const text = (m[2] ?? "").replace(/<[^>]*>/g, "").trim();
    if (!text) continue;
    toc.push({ id: `sec-${i}`, text, level });
    i += 1;
  }
  return toc;
}

/** Inject id attributes into the matching headings so anchor links work. */
export function withHeadingIds(html: string): string {
  let i = 0;
  return html.replace(/<h([23])([^>]*)>/g, (whole, lvl: string, rest: string) => {
    const id = `sec-${i}`;
    i += 1;
    if (rest.includes("id=")) return whole;
    return `<h${lvl} id="${id}"${rest}>`;
  });
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  const slug = String(params.slug ?? "");
  const isAr = lang === "ar";

  let query = client
    .from("blog_posts")
    .select(`id, title_ar, title_en, slug_ar, slug_en, excerpt_ar, excerpt_en,
             content_ar, content_en, cover_path, published_at, updated_at,
             seo_title_ar, seo_title_en, seo_desc_ar, seo_desc_en, status, author`)
    // either language's slug: the language switch keeps the slug it was on
    .or(`slug_ar.eq.${safeSlug(slug) ?? "-"},slug_en.eq.${safeSlug(slug) ?? "-"}`)
    .limit(1);
  // anyone holding blog.manage (admins and permitted staff) may preview
  // drafts; everyone else sees published only (RLS enforces the same rule).
  // NOTE: the author name resolves through the DEFINER service client AFTER the
  // main read — an inline profiles() embed would fail the whole query for
  // visitors (anon has no SELECT on profiles by design; AGENT §4).
  const { getSupabaseAdminClient } = await import("~/lib/supabase/admin");
  const adminClient = getSupabaseAdminClient();
  const { data: canPreview } = await client.rpc("has_permission", { p_permission: "blog.manage" });
  if (canPreview !== true) query = query.eq("status", "published");

  const { data: rows, error: rowsErr } = await query;
  if (rowsErr) console.error("[blog.$slug] rows error:", rowsErr.message);
  let post = (rows ?? [])[0] as unknown as
    | (PostRow & { status: string; profiles: { full_name: string } | null })
    | undefined;

  // 301 for moved slugs (L-08)
  if (!post || post.status !== "published") {
    const { data: redirect } = await client
      .from("slug_redirects")
      .select("new_slug_ar, new_slug_en")
      .eq("kind", "post")
      .eq("is_active", true)
      .or(`old_slug_ar.eq.${safeSlug(slug) ?? ""},old_slug_en.eq.${safeSlug(slug) ?? ""}`)
      .limit(1);
    const target = redirect?.[0] ? (isAr ? redirect[0].new_slug_ar : redirect[0].new_slug_en) : null;
    if (target && target !== slug) {
      throw redirect301(`/${lang}/blog/${encodeURIComponent(target)}`);
    }
    throw new Response("Not found", { status: 404 });
  }

  // opened with the other language's slug → the canonical URL of this language
  const ownSlug = isAr ? post.slug_ar : post.slug_en;
  if (ownSlug && ownSlug !== slug) throw redirect301(`/${lang}/blog/${encodeURIComponent(ownSlug)}`);

  let author: string | null = null;
  if (adminClient && post.author) {
    const { data: profRow } = await adminClient.from("profiles").select("full_name").eq("id", post.author).single();
    author = profRow?.full_name ?? null;
  }
  const clean: PostRow = { ...post, author_name: author };

  // related: same category not modeled; latest 3 others
  const { data: related } = await client
    .from("blog_posts")
    .select("title_ar, title_en, slug_ar, slug_en, excerpt_ar, excerpt_en, cover_path, published_at")
    .eq("status", "published")
    .neq("id", post.id)
    .order("published_at", { ascending: false })
    .limit(3);

  const title = isAr ? (clean.seo_title_ar || clean.title_ar) : (clean.seo_title_en || clean.title_en);
  const description = isAr ? (clean.seo_desc_ar || clean.excerpt_ar) : (clean.seo_desc_en || clean.excerpt_en);

  const meta = publicMeta({
    lang, path: `/blog/${encodeURIComponent(isAr ? clean.slug_ar : clean.slug_en)}`,
    altPath: `/blog/${encodeURIComponent(isAr ? clean.slug_en || clean.slug_ar : clean.slug_ar || clean.slug_en)}`,
    title: `${title} — ${isAr ? "إتسوء" : "Etsawaa"}`, description,
    ogType: "article", ogImage: ogMedia(clean.cover_path), ogImageAlt: title,
  });

  return {
    lang, post: JSON.parse(JSON.stringify(clean)),
    related: JSON.parse(JSON.stringify(related ?? [])),
    meta,
  };
}

function redirect301(location: string): never {
  throw new Response(null, { status: 301, headers: { Location: location } });
}

export function meta({ loaderData }: Route.MetaArgs) {
  return loaderData.meta as unknown as ReturnType<typeof publicMeta>;
}

export default function BlogArticle({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const lang = loaderData.lang;
  const en = lang === "en";
  const p = loaderData.post;
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? "";

  const raw = en ? p.content_en : p.content_ar;
  // Sanitize AFTER withHeadingIds so the injected sec-N ids survive (the
  // allowlist permits id/class) — DB content is untrusted even from editors.
  const withIds = useMemo(() => sanitizeBlogHtml(withHeadingIds(raw)), [raw]);
  const toc = useMemo(() => buildToc(raw), [raw]);
  const [progress, setProgress] = useState(0);
  const [activeId, setActiveId] = useState<string>("");
  const articleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () => {
      const el = articleRef.current;
      if (!el) return;
      const total = el.scrollHeight - window.innerHeight;
      const done = Math.min(1, Math.max(0, (-el.getBoundingClientRect().top) / Math.max(1, total)));
      setProgress(done);
      let current = "";
      for (const item of toc) {
        const head = document.getElementById(item.id);
        if (head && head.getBoundingClientRect().top < 120) current = item.id;
      }
      setActiveId(current);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, [toc]);

  const url = `${siteUrl()}/${lang}/blog/${encodeURIComponent(en ? p.slug_en : p.slug_ar)}`;
  const shareTargets = [
    { key: "facebook", href: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}` },
    { key: "x", href: `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(en ? p.title_en : p.title_ar)}` },
    { key: "whatsapp", href: `https://wa.me/?text=${encodeURIComponent(`${(en ? p.title_en : p.title_ar)} ${url}`)}` },
  ];

  const posting = {
      "@context": "https://schema.org", "@type": "BlogPosting",
      headline: en ? p.title_en : p.title_ar,
      description: en ? p.excerpt_en : p.excerpt_ar,
      datePublished: p.published_at, dateModified: p.updated_at,
      author: p.author_name ? { "@type": "Person", name: p.author_name } : undefined,
      publisher: { "@type": "Organization", name: "Etsawaa", url: siteUrl() },
      mainEntityOfPage: url,
      image: p.cover_path ? publicMediaUrl(supabaseUrl, p.cover_path) : undefined,
  };
  const breadcrumb = breadcrumbLd(lang, [
      { name: t("nav.home"), path: "/" },
      { name: t("pubBlog.title"), path: "/blog" },
      { name: en ? p.title_en : p.title_ar, path: `/blog/${encodeURIComponent(en ? p.slug_en : p.slug_ar)}` },
    ]);

  const ldObjects: Array<Record<string, unknown>> = [breadcrumb, posting];

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6">
      {ldObjects.map((d, i) => <script key={i} type="application/ld+json" dangerouslySetInnerHTML={jsonLd(d)} />)}

      {/* reading progress (reduced-motion safe: a plain width bar, no animation loop) */}
      <div className="fixed inset-x-0 top-0 z-40 h-1 bg-transparent" aria-hidden="true">
        <div className="h-full bg-primary" style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>

      <Breadcrumbs label={t("a11y.breadcrumbs")} items={[
        { label: t("nav.home"), href: `/${lang}` },
        { label: t("pubBlog.title"), href: `/${lang}/blog` },
        { label: en ? p.title_en : p.title_ar },
      ]} />

      <article ref={articleRef} className="mt-3 grid gap-8 lg:grid-cols-[minmax(0,68ch)_240px] lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold leading-snug text-text md:text-3xl">
            {en ? p.title_en : p.title_ar}
          </h1>
          <p className="mt-1.5 text-sm text-text-muted">
            {p.author_name ? `${p.author_name} · ` : ""}
            <time dateTime={p.published_at ?? undefined}>
              {new Date(p.published_at ?? p.updated_at).toLocaleDateString(en ? "en-GB" : "ar-EG-u-nu-latn", { day: "numeric", month: "long", year: "numeric" })}
            </time>
          </p>

          {p.cover_path ? (
            <img
              src={publicMediaUrl(supabaseUrl, p.cover_path)}
              alt={en ? p.title_en : p.title_ar}
              width={1200} height={630} loading="eager" decoding="async"
              className="mt-4 aspect-[1200/630] w-full rounded-md border border-border object-cover"
            />
          ) : (
            /* U2 — no empty hero: the same deterministic cover, larger */
            <FallbackCover
              title={en ? p.title_en : p.title_ar}
              seed={p.slug_en}
              className="mt-4 aspect-[1200/630] rounded-md border"
            />
          )}

          {/* U4 — mobile TOC collapses into <details> (native disclosure:
              no JS, keyboard accessible, closed by default so the article
              starts right under the title) */}
          {toc.length >= 2 ? (
            <details className="group mt-5 rounded-md border border-border bg-surface-tint lg:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-3 text-sm font-bold text-text marker:content-none">
                {t("pubBlog.toc")}
                <span aria-hidden="true" className="text-text-muted transition-transform duration-150 group-open:rotate-180">▾</span>
              </summary>
              <nav aria-label={t("pubBlog.toc")} className="px-3 pb-3">
                <ol className="flex flex-col gap-1 border-s border-border ps-3 text-sm">
                  {toc.map((item) => (
                    <li key={item.id} className={item.level === 3 ? "ms-3" : ""}>
                      <a href={`#${item.id}`} className="text-primary hover:underline">{item.text}</a>
                    </li>
                  ))}
                </ol>
              </nav>
            </details>
          ) : null}

          <div
            className="pubProse mt-5 flex flex-col gap-3 text-lg leading-7 text-text"
            dangerouslySetInnerHTML={{ __html: withIds /* sanitized above via sanitizeBlogHtml */ }}
          />

          {/* share row */}
          <div className="mt-8 flex flex-wrap items-center gap-2 border-t border-border pt-4">
            <span className="text-sm font-bold text-text">{t("pubBlog.share")}</span>
            {shareTargets.map((s) => (
              <a key={s.key} href={s.href} target="_blank" rel="noreferrer"
                className="rounded-md border border-border px-3 py-1.5 text-sm font-bold text-text hover:bg-surface-tint">
                {t(`pubBlog.share_${s.key}`)}
              </a>
            ))}
            <button type="button" onClick={() => void navigator.clipboard?.writeText(url)}
              className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-sm font-bold text-text hover:bg-surface-tint">
              {t("pubBlog.copyLink")}
            </button>
          </div>
        </div>

        {/* desktop TOC rail — sticky inside the article grid */}
        {toc.length >= 2 ? (
          <aside className="hidden lg:block">
            <nav aria-label={t("pubBlog.toc")} className="sticky top-24 rounded-md border border-border bg-surface p-3">
              <p className="text-sm font-bold text-text">{t("pubBlog.toc")}</p>
              <ol className="mt-1.5 flex flex-col gap-1 border-s border-border ps-3 text-sm">
                {toc.map((item) => (
                  <li key={item.id} className={item.level === 3 ? "ms-3" : ""}>
                    <a href={`#${item.id}`}
                      aria-current={activeId === item.id ? "location" : undefined}
                      className={activeId === item.id ? "font-bold text-primary" : "text-text-muted hover:text-primary"}>
                      {item.text}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          </aside>
        ) : null}
      </article>

      {/* related */}
      {loaderData.related.length > 0 ? (
        <section className="mt-8" aria-label={t("pubBlog.related")}>
          <h2 className="text-lg font-extrabold text-text">{t("pubBlog.related")}</h2>
          <ul className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {loaderData.related.map((r: { slug_ar: string; slug_en: string; title_ar: string; title_en: string; excerpt_ar: string; excerpt_en: string; cover_path: string | null; published_at: string | null }) => (
              <li key={r.slug_en} className="flex">
                <BlogCard post={r} lang={lang} headingLevel={3} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonPage />;
}

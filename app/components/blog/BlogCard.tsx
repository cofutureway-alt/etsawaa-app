import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { publicMediaUrl } from "~/lib/media.shared";
import { FallbackCover } from "~/components/blog/FallbackCover";

/**
 * One article card for every blog listing (blog index, related posts, the
 * Sell page). The whole card is one link; the cover keeps a fixed 1.91:1
 * box so the grid never shifts while images load, and the text block grows
 * so cards in a row share a baseline for the date / read-more line.
 *
 * The media URL is built from the build-time public Supabase URL: this
 * renders on the client too, where `process.env` does not exist.
 */

export interface BlogCardPost {
  slug_ar: string; slug_en: string;
  title_ar: string; title_en: string;
  excerpt_ar: string; excerpt_en: string;
  cover_path: string | null;
  published_at?: string | null;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? "";

export function BlogCard({ post, lang, category, size = "md", headingLevel = 2 }: {
  post: BlogCardPost;
  lang: "ar" | "en";
  category?: string;
  size?: "md" | "lg";
  headingLevel?: 2 | 3;
}) {
  const { t } = useTranslation();
  const en = lang === "en";
  const title = (en ? post.title_en : post.title_ar) || post.title_ar || post.title_en;
  const excerpt = (en ? post.excerpt_en : post.excerpt_ar) || "";
  const slug = (en ? post.slug_en : post.slug_ar) || post.slug_ar || post.slug_en;
  const Heading = headingLevel === 2 ? "h2" : "h3";

  return (
    <Link
      to={`/${lang}/blog/${encodeURIComponent(slug)}`}
      className="group flex h-full w-full flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-1 transition-[box-shadow,border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-action/30 hover:shadow-2 focus-visible:shadow-focus focus-visible:outline-none motion-reduce:transform-none"
    >
      <div className="relative overflow-hidden">
        {post.cover_path ? (
          <img
            src={publicMediaUrl(SUPABASE_URL, post.cover_path)}
            alt=""
            width={600}
            height={315}
            loading="lazy"
            decoding="async"
            className="aspect-[600/315] w-full object-cover transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:transform-none"
          />
        ) : (
          /* U2 — deterministic branded cover, never an empty slot */
          <FallbackCover title={title} category={category} seed={post.slug_en || post.slug_ar} className="border-b-0" />
        )}
        {category && post.cover_path ? (
          <span className="absolute start-3 top-3 max-w-[70%] truncate rounded-full bg-surface/95 px-2.5 py-1 text-2xs font-extrabold text-action shadow-1">
            {category}
          </span>
        ) : null}
      </div>
      <div className={`flex flex-1 flex-col gap-2 ${size === "lg" ? "p-5 sm:p-6" : "p-4"}`}>
        <Heading className={`line-clamp-2 font-extrabold leading-snug text-text transition-colors group-hover:text-action ${size === "lg" ? "text-xl" : "text-base sm:text-lg"}`}>
          {title}
        </Heading>
        {excerpt ? (
          <p className={`text-sm leading-relaxed text-text-muted ${size === "lg" ? "line-clamp-4" : "line-clamp-3"}`}>{excerpt}</p>
        ) : null}
        <div className="mt-auto flex items-center justify-between gap-2 pt-2 text-xs">
          {post.published_at ? (
            <time className="text-text-faint" dateTime={post.published_at}>
              {new Date(post.published_at).toLocaleDateString(en ? "en-GB" : "ar-EG-u-nu-latn", { day: "numeric", month: "long", year: "numeric" })}
            </time>
          ) : <span />}
          <span className="font-extrabold text-action">
            {t("pubBlog.readMore")}
            <span aria-hidden="true" className="ms-1 inline-block transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5">{"›"}</span>
          </span>
        </div>
      </div>
    </Link>
  );
}

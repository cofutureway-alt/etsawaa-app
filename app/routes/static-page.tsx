import type { Route } from "./+types/static-page";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { requireLang } from "~/lib/lang.server";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { publicMeta } from "~/lib/seo";
import { getStaticPage, type StaticPage } from "~/features/storefront/api";
import { Breadcrumbs } from "~/components/ui/Breadcrumbs";
import { SkeletonPage } from "~/components/ui/Skeleton";


/**
 * Static pages from the DB (S-12 / US-10): /p/:slug resolves either locale
 * slug; `show_in_header` controls the header link only — a page removed
 * from the header stays reachable by direct link unless unpublished.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw new Response("Not Found", { status: 404 });
  const rawSlug = decodeURIComponent(params.slug ?? "");
  const page = await getStaticPage(client, rawSlug);
  if (!page) {
    // L-08 — moved slug → 301 permanent to the current one
    const { data: redirect } = await client
      .from("slug_redirects")
      .select("new_slug_ar, new_slug_en")
      .eq("kind", "page")
      .eq("is_active", true)
      .or(`old_slug_ar.eq.${rawSlug},old_slug_en.eq.${rawSlug}`)
      .limit(1);
    const target = redirect?.[0] ? (lang === "ar" ? redirect[0].new_slug_ar : redirect[0].new_slug_en) : null;
    if (target && target !== rawSlug) {
      throw new Response(null, { status: 301, headers: { Location: `/${lang}/p/${encodeURIComponent(target)}` } });
    }
    throw new Response("Not Found", { status: 404 });
  }
  return { lang, page };
}

export const meta = ({ data }: Route.MetaArgs) => {
  const lang = (data?.lang as "ar" | "en") ?? "ar";
  const page = data?.page as StaticPage | undefined;
  const title = page ? (lang === "ar" ? page.title_ar : page.title_en) : "";
  const content = page ? (lang === "ar" ? page.content_ar : page.content_en) : "";
  return publicMeta({
    lang,
    path: `/p/${encodeURIComponent(lang === "ar" ? page?.slug_ar ?? "" : page?.slug_en ?? "")}`,
    title: `${title} — ${lang === "ar" ? "اتسوء" : "Etsawaa"}`,
    description: content.replace(/[#\n-]+/g, " ").trim().slice(0, 160) || title,
  });
};

/** Minimal block renderer for the DB content: "## " headings, "- " lists,
 * "N." ordered lists, blank-line-separated paragraphs. No raw HTML. */
function ContentBlocks({ text }: { text: string }) {
  const blocks = text.split(/\n\n+/).map((b) => b.trim()).filter(Boolean);
  return (
    <div className="flex flex-col gap-4">
      {blocks.map((block, index) => {
        if (block.startsWith("## ")) {
          return (
            <h2 key={index} className="mt-3 border-t border-border pt-4 text-base font-extrabold text-text first:mt-0 first:border-0 first:pt-0">
              {block.slice(3).trim()}
            </h2>
          );
        }
        const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
        if (lines.every((l) => l.startsWith("- "))) {
          return (
            <ul key={index} className="flex list-disc flex-col gap-1.5 ps-6 text-[13.5px] leading-relaxed text-text">
              {lines.map((line, i) => (
                <li key={i}>{line.slice(2)}</li>
              ))}
            </ul>
          );
        }
        if (lines.every((l) => /^\d+\.\s/.test(l))) {
          return (
            <ol key={index} className="flex list-decimal flex-col gap-1.5 ps-6 text-[13.5px] leading-relaxed text-text">
              {lines.map((line, i) => (
                <li key={i}>{line.replace(/^\d+\.\s/, "")}</li>
              ))}
            </ol>
          );
        }
        return (
          <p key={index} className="whitespace-pre-line text-[13.5px] leading-relaxed text-text">
            {block}
          </p>
        );
      })}
    </div>
  );
}

export default function StaticPageRoute({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const lang = loaderData.lang;
  const page = loaderData.page;
  const title = lang === "ar" ? page.title_ar : page.title_en;
  const content = lang === "ar" ? page.content_ar : page.content_en;
  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs label={t("a11y.breadcrumbs")} items={[{ label: t("nav.home"), href: `/${lang}` }, { label: title }]} />
      {/* U3 — the CARD itself is constrained and centred (a 1200px-wide card
          holding 68ch of prose left a large dead area beside the text) */}
      <article className="mx-auto w-full max-w-[900px] rounded-l border border-border bg-surface p-5 sm:p-8">
        <h1 className="mb-4 text-xl font-black text-text">{title}</h1>
        <div className="max-w-[68ch]">
          <ContentBlocks text={content} />
        </div>
        {/* one visible action on every static page — the DB content points at
            the contact page in words, this makes it a button */}
        <div className="mt-6 border-t border-border pt-5">
          <Link
            to={`/${lang}/contact`}
            className="inline-flex min-h-11 items-center justify-center rounded-m bg-action px-5 text-sm font-extrabold text-on-action transition-colors duration-150 hover:bg-action-hover"
          >
            {t("staticPage.contactCta")}
          </Link>
        </div>
      </article>
    </div>
  );
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonPage />;
}

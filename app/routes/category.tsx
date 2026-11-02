import { Link } from "react-router";
import type { Route } from "./+types/category";
import { useTranslation } from "react-i18next";
import { requireLang } from "~/lib/lang.server";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { breadcrumbLd, jsonLd, publicMeta, siteUrl } from "~/lib/seo";
import { loadListing } from "~/features/storefront/server-listing";
import { Listing } from "~/components/catalog/Listing";
import { MediaImg } from "~/components/catalog/MediaImg";
import { SkeletonPage } from "~/components/ui/Skeleton";


/**
 * Category page (S-02 / US-02): header (image/description) + subcategory
 * cards + the product listing with facets. Only active nodes resolve —
 * anything else is a 404.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw new Response("Not Found", { status: 404 });
  const slug = params.slug ?? "";
  const data = await loadListing(request, client, { fixedCategorySlug: slug });
  if (!data.scope.category) throw new Response("Not Found", { status: 404 });
  // subcategories (direct children) for the cards row
  const all = await client.from("v_storefront_categories").select("*").eq("parent_id", data.scope.category.id).order("sort");
  const children = (all.data ?? []) as Array<{ id: string; slug_ar: string; slug_en: string; name_ar: string; name_en: string; thumb_path: string | null }>;
  return { lang, data, children };
}

export const meta = ({ data }: Route.MetaArgs) => {
  const lang = (data?.lang as "ar" | "en") ?? "ar";
  const cat = data?.data?.scope.category;
  const name = cat ? (lang === "ar" ? cat.name_ar : cat.name_en) : (lang === "ar" ? "قسم" : "Category");
  const desc = cat ? (lang === "ar" ? cat.description_ar : cat.description_en) : "";
  const slug = cat ? (lang === "ar" ? cat.slug_ar : cat.slug_en) : "";
  return publicMeta({
    lang,
    path: `/category/${encodeURIComponent(slug)}`,
    title: `${name} — ${lang === "ar" ? "اتسوء" : "Etsawaa"}`,
    description: desc || (lang === "ar" ? `تسوق منتجات ${name} من متاجر مصرية موثوقة.` : `Shop ${name} products from vetted Egyptian stores.`),
  });
};

export default function CategoryPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { lang, data, children } = loaderData;
  const cat = data.scope.category!;
  const name = lang === "ar" ? cat.name_ar : cat.name_en;
  const description = lang === "ar" ? cat.description_ar : cat.description_en;
  const catSlug = lang === "en" ? cat.slug_en || cat.slug_ar : cat.slug_ar || cat.slug_en;

  const crumbs = [
    { label: t("nav.home"), href: `/${lang}` },
    ...data.scope.chain.map((c) => ({
      label: lang === "ar" ? c.name_ar : c.name_en,
      href: `/${lang}/category/${encodeURIComponent(lang === "en" ? c.slug_en || c.slug_ar : c.slug_ar || c.slug_en)}`,
    })),
    { label: name },
  ];

  return (
    <div className="flex flex-col gap-4">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd([
          breadcrumbLd(lang === "en" ? "en" : "ar", crumbs.map((c) => ({ name: c.label, path: c.href ?? `/${lang}` }))),
          {
            "@context": "https://schema.org",
            "@type": "ItemList",
            name,
            numberOfItems: data.result.total,
            itemListElement: data.result.items.slice(0, 20).map((item, index) => ({
              "@type": "ListItem",
              position: index + 1,
              name: lang === "ar" ? item.name_ar : item.name_en,
              url: `${siteUrl()}/${lang}/product/${encodeURIComponent(lang === "ar" ? item.slug_ar : item.slug_en)}`,
            })),
          },
        ])}
      />
      {/* category header */}
      <header className="flex flex-wrap items-center gap-4 rounded-l border border-border bg-surface p-4">
        {cat.thumb_path ? (
          <MediaImg path={cat.thumb_path} alt={name} width={96} height={96} className="size-20 rounded-m border border-border" />
        ) : (
          <span className="flex size-20 items-center justify-center rounded-m bg-surface-tint text-2xl font-black text-action">
            {name.slice(0, 1)}
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-lg font-black text-text">{name}</h1>
          {description ? <p className="mt-1 max-w-2xl text-[13px] text-text-muted">{description}</p> : null}
        </div>
      </header>

      {/* subcategory cards (US-02) */}
      {children.length > 0 ? (
        <nav aria-label={t("store.category.subcategories")}>
          <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
            {children.map((child) => (
              <li key={child.id}>
                <Link
                  to={`/${lang}/category/${encodeURIComponent(lang === "en" ? child.slug_en || child.slug_ar : child.slug_ar || child.slug_en)}`}
                  className="flex flex-col items-center gap-2 rounded-l border border-border bg-surface p-3 text-center transition-colors duration-150 hover:bg-surface-tint"
                >
                  {child.thumb_path ? (
                    <MediaImg path={child.thumb_path} alt={lang === "ar" ? child.name_ar : child.name_en} width={56} height={56} className="size-12 rounded-m" />
                  ) : (
                    <span className="flex size-12 items-center justify-center rounded-m bg-surface-tint text-base font-black text-action">
                      {(lang === "ar" ? child.name_ar : child.name_en).slice(0, 1)}
                    </span>
                  )}
                  <span className="line-clamp-2 text-[12px] font-bold text-text">
                    {lang === "ar" ? child.name_ar : child.name_en}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}

      <Listing
        lang={lang}
        result={data.result}
        defs={data.scope.defs}
        state={data.state}
        basePath={`/${lang}/category/${encodeURIComponent(catSlug)}`}
        crumbs={crumbs}
        title={name}
        hideCategoryFacet
        wishedIds={data.wishedIds}
      />
    </div>
  );
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonPage />;
}

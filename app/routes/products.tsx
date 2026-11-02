import type { Route } from "./+types/products";
import { useTranslation } from "react-i18next";
import { requireLang } from "~/lib/lang.server";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { jsonLd, publicMeta, siteUrl } from "~/lib/seo";
import { loadListing } from "~/features/storefront/server-listing";
import { Listing } from "~/components/catalog/Listing";
import { SkeletonPage } from "~/components/ui/Skeleton";


/** /products — the all-products listing (S-03). */
export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return { lang, data: null };
  const data = await loadListing(request, client);
  return { lang, data };
}

export const meta = ({ data }: Route.MetaArgs) => {
  const lang = (data?.lang as "ar" | "en") ?? "ar";
  return publicMeta({
    lang,
    path: "/products",
    title: lang === "ar" ? "كل المنتجات — اتسوء" : "All products — Etsawaa",
    description:
      lang === "ar"
        ? "تصفح كل منتجات المتاجر المصرية على اتسوء مع فلاتر السعر والماركة والمواصفات."
        : "Browse every product from Egyptian stores on Etsawaa with price, brand and spec filters.",
  });
};

export default function ProductsPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { lang, data } = loaderData;
  if (!data) {
    return <p className="py-10 text-center text-[13px] font-bold text-text-muted">{t("errors.dataUnavailable")}</p>;
  }
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd({
          "@context": "https://schema.org",
          "@type": "ItemList",
          itemListElement: data.result.items.slice(0, 20).map((item, index) => ({
            "@type": "ListItem",
            position: index + 1,
            name: lang === "ar" ? item.name_ar : item.name_en,
            url: `${siteUrl()}/${lang}/product/${encodeURIComponent(lang === "ar" ? item.slug_ar || item.slug_en : item.slug_en || item.slug_ar)}`,
          })),
        })}
      />
      <Listing
        lang={lang}
        result={data.result}
        defs={data.scope.defs}
        state={data.state}
        basePath={`/${lang}/products`}
        crumbs={[{ label: t("nav.home"), href: `/${lang}` }, { label: t("nav.allProducts") }]}
        title={t("nav.allProducts")}
        wishedIds={data.wishedIds}
      />
    </>
  );
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonPage />;
}

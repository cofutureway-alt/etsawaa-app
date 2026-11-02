import type { Route } from "./+types/brand";
import { useTranslation } from "react-i18next";
import { requireLang } from "~/lib/lang.server";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { publicMeta } from "~/lib/seo";
import { loadListing } from "~/features/storefront/server-listing";
import { Listing } from "~/components/catalog/Listing";
import { SkeletonPage } from "~/components/ui/Skeleton";


/** /brand/:slug — one brand's products (S-08; empty brand → friendly state). */
export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw new Response("Not Found", { status: 404 });
  const data = await loadListing(request, client, { fixedBrandSlug: params.slug ?? "" });
  if (!data.scope.brand) throw new Response("Not Found", { status: 404 });
  return { lang, data };
}

export const meta = ({ data }: Route.MetaArgs) => {
  const lang = (data?.lang as "ar" | "en") ?? "ar";
  const brand = data?.data?.scope.brand;
  const name = brand ? (lang === "ar" ? brand.name_ar : brand.name_en) : (lang === "ar" ? "ماركة" : "Brand");
  return publicMeta({
    lang,
    path: `/brand/${encodeURIComponent(lang === "ar" ? brand?.slug_ar ?? "" : brand?.slug_en ?? "")}`,
    title: `${name} — ${lang === "ar" ? "اتسوء" : "Etsawaa"}`,
    description:
      lang === "ar"
        ? `كل منتجات ${name} المتاحة على اتسوء من متاجر مصرية موثوقة.`
        : `All ${name} products available on Etsawaa from vetted Egyptian stores.`,
  });
};

export default function BrandPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { lang, data } = loaderData;
  const brand = data.scope.brand!;
  const name = lang === "ar" ? brand.name_ar : brand.name_en;
  const brandSlug = lang === "en" ? brand.slug_en || brand.slug_ar : brand.slug_ar || brand.slug_en;
  return (
    <Listing
      lang={lang}
      result={data.result}
      defs={data.scope.defs}
      state={data.state}
      basePath={`/${lang}/brand/${encodeURIComponent(brandSlug)}`}
      crumbs={[
        { label: t("nav.home"), href: `/${lang}` },
        { label: t("nav.brands"), href: `/${lang}/brands` },
        { label: name },
      ]}
      title={name}
      description={t("store.brand.productsFrom", { brand: name })}
      wishedIds={data.wishedIds}
    />
  );
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonPage />;
}

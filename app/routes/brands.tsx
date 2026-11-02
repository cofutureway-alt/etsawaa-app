import { Link } from "react-router";
import type { Route } from "./+types/brands";
import { useTranslation } from "react-i18next";
import { requireLang } from "~/lib/lang.server";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { publicMeta } from "~/lib/seo";
import { listBrands } from "~/features/storefront/api";
import { EmptyState } from "~/components/ui/EmptyState";
import { Breadcrumbs } from "~/components/ui/Breadcrumbs";
import { MediaImg } from "~/components/catalog/MediaImg";
import { SkeletonPage } from "~/components/ui/Skeleton";


/** Brands directory (S-08): all active brands with product counts. */
export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return { lang, brands: [] };
  const brands = await listBrands(client).catch(() => []);
  return { lang, brands };
}

export const meta = ({ data }: Route.MetaArgs) => {
  const lang = (data?.lang as "ar" | "en") ?? "ar";
  return publicMeta({
    lang,
    path: "/brands",
    title: lang === "ar" ? "الماركات — اتسوء" : "Brands — Etsawaa",
    description:
      lang === "ar"
        ? "تصفح منتجات كل الماركات المتاحة على اتسوء."
        : "Browse products by every brand available on Etsawaa.",
  });
};

export default function BrandsPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const lang = loaderData.lang;
  return (
    <div className="flex flex-col gap-5">
      <Breadcrumbs
        label={t("a11y.breadcrumbs")}
        items={[{ label: t("nav.home"), href: `/${lang}` }, { label: t("nav.brands") }]}
      />
      <h1 className="text-lg font-black text-text">{t("nav.brands")}</h1>
      {loaderData.brands.length === 0 ? (
        <EmptyState title={t("store.brands.empty.title")} body={t("store.brands.empty.body")} />
      ) : (
        <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
          {loaderData.brands.map((brand) => {
            const slug = lang === "en" ? brand.slug_en || brand.slug_ar : brand.slug_ar || brand.slug_en;
            const name = lang === "ar" ? brand.name_ar : brand.name_en;
            return (
              <li key={brand.id}>
                <Link
                  to={`/${lang}/brand/${encodeURIComponent(slug)}`}
                  className="flex h-full flex-col items-center gap-2 rounded-lg border border-border bg-surface p-4 text-center transition-colors duration-150 hover:bg-surface-tint"
                >
                  {brand.thumb_path ? (
                    <MediaImg path={brand.thumb_path} alt={name} width={72} height={72} className="size-16 rounded-md border border-border" />
                  ) : (
                    <span className="flex size-16 items-center justify-center rounded-md bg-surface-tint text-xl font-black text-action">
                      {name.slice(0, 1)}
                    </span>
                  )}
                  <span className="text-[13px] font-extrabold text-text">{name}</span>
                  <span className="num text-[11px] font-bold text-text-muted">
                    {t("store.brands.productCount", { count: brand.product_count })}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonPage />;
}

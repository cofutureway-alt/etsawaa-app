import type { Route } from "./+types/store";
import { useTranslation } from "react-i18next";
import { requireLang } from "~/lib/lang.server";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { breadcrumbLd, jsonLd, publicMeta, siteUrl } from "~/lib/seo";
import { getStoreBySlug, getStoreProducts, type ProductCard as ProductCardRow, type StoreCard } from "~/features/storefront/api";
import { getViewer } from "~/lib/auth/guards";
import { Rating } from "~/components/ui/Rating";
import { EmptyState } from "~/components/ui/EmptyState";
import { Breadcrumbs } from "~/components/ui/Breadcrumbs";
import { ProductCard } from "~/components/catalog/ProductCard";
import { MediaImg } from "~/components/catalog/MediaImg";
import { StoreIcon } from "~/components/ui/icons";
import { SkeletonPage } from "~/components/ui/Skeleton";


/**
 * Store page (S-06 / US-08): banner/logo, level badge, rating, products.
 * Suspended stores render with a notice and no purchasable grid;
 * event-refused/event-hidden products stay visible here with an
 * "unavailable in listings" notice (flags come from the storefront view).
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw new Response("Not Found", { status: 404 });
  const slug = decodeURIComponent(params.slug ?? "");
  const store = await getStoreBySlug(client, slug);
  if (!store) throw new Response("Not Found", { status: 404 });
  const { viewer } = (await getViewer(client)) ?? { viewer: null };
  const [products, wishedRes] = await Promise.all([
    getStoreProducts(client, store.id).catch(() => [] as ProductCardRow[]),
    viewer
      ? client.from("wishlist_items").select("product_id").eq("user_id", viewer.user.id)
      : Promise.resolve({ data: null, error: null }),
  ]);
  const wishedIds = new Set(((wishedRes.data ?? []) as Array<{ product_id: string }>).map((r) => r.product_id));
  return { lang, store, products, wishedIds, viewerId: viewer?.user.id ?? null };
}

export const meta = ({ data }: Route.MetaArgs) => {
  const lang = (data?.lang as "ar" | "en") ?? "ar";
  const store = data?.store as StoreCard | undefined;
  const name = store ? (lang === "ar" ? store.store_name_ar || store.store_name_en : store.store_name_en || store.store_name_ar) : "";
  return publicMeta({
    lang,
    path: `/store/${encodeURIComponent(store?.slug ?? "")}`,
    title: `${name} — ${lang === "ar" ? "اتسوء" : "Etsawaa"}`,
    description:
      (lang === "ar" ? store?.short_desc_ar : store?.short_desc_en) ||
      (lang === "ar" ? `تسوق من متجر ${name} على اتسوء.` : `Shop from ${name} on Etsawaa.`),
  });
};

export default function StorePage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const lang = loaderData.lang;
  const store = loaderData.store;
  const name = lang === "ar" ? store.store_name_ar || store.store_name_en : store.store_name_en || store.store_name_ar;
  const level = lang === "ar" ? store.level_name_ar : store.level_name_en;
  const desc = lang === "ar" ? store.short_desc_ar : store.short_desc_en;
  const suspended = store.status === "suspended";
  const eventRefused = store.refused_event_id != null;
  const eventName = lang === "ar" ? store.refused_event_name_ar : store.refused_event_name_en;

  return (
    <div className="flex flex-col gap-5">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd([
          breadcrumbLd(lang === "en" ? "en" : "ar", [
            { name: t("nav.home"), path: `/${lang}` },
            { name: t("nav.vendors"), path: `/${lang}/vendors` },
            { name, path: `/${lang}/store/${encodeURIComponent(store.slug)}` },
          ]),
          {
            "@context": "https://schema.org",
            "@type": "Organization",
            name,
            url: `${siteUrl()}/${lang}/store/${encodeURIComponent(store.slug)}`,
            ...(store.logo_path ? { logo: undefined } : {}),
          },
        ])}
      />

      <Breadcrumbs
        label={t("a11y.breadcrumbs")}
        items={[
          { label: t("nav.home"), href: `/${lang}` },
          { label: t("nav.vendors"), href: `/${lang}/vendors` },
          { label: name },
        ]}
      />

      {/* banner + identity */}
      <header className="overflow-hidden rounded-l border border-border bg-surface">
        <div className="h-28 bg-surface-tint sm:h-40">
          {store.banner_path ? (
            <MediaImg path={store.banner_path} alt={name} width={1200} height={240} eager className="h-full w-full" sizes="100vw" />
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3 p-4">
          {store.logo_path ? (
            <MediaImg path={store.logo_path} alt={name} width={80} height={80} className="-mt-10 size-16 rounded-full border-2 border-surface shadow-1" />
          ) : (
            <span className="-mt-10 flex size-16 items-center justify-center rounded-full border-2 border-surface bg-surface-tint text-action shadow-1">
              <StoreIcon className="size-7" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="flex flex-wrap items-center gap-2 text-lg font-black text-text">
              {name}
              {level ? (
                <span className="rounded-full border border-featured bg-surface px-2 py-0.5 text-[11px] font-extrabold text-ink">
                  {level}
                </span>
              ) : null}
            </h1>
            <div className="mt-0.5 flex flex-wrap items-center gap-3">
              {store.rating_count > 0 && store.rating_avg != null ? (
                <Rating value={store.rating_avg} count={store.rating_count} size="sm" />
              ) : (
                <span className="text-[11px] text-text-faint">{t("store.noReviews")}</span>
              )}
              <span className="num text-[12px] font-bold text-text-muted">
                {t("store.vendor.productCount", { count: store.product_count })}
              </span>
            </div>
            {desc ? <p className="mt-1 max-w-2xl text-[13px] text-text-muted">{desc}</p> : null}
          </div>
        </div>
      </header>

      {/* suspended notice (US-08 edge): shell visible, nothing purchasable */}
      {suspended ? (
        <div className="rounded-l border-2 border-danger bg-danger-soft px-4 py-3 text-[13px] font-extrabold text-danger" role="alert">
          {t("store.suspendedNotice")}
        </div>
      ) : null}

      {/* event refusal notice: these products stay visible HERE only (S-06) */}
      {eventRefused ? (
        <div className="rounded-l border-2 border-warning bg-warning-soft px-4 py-3 text-[13px] font-bold text-warning-strong">
          {t("store.eventRefusedNotice", { event: eventName ?? "" })}
        </div>
      ) : null}

      {/* products */}
      {suspended ? (
        <EmptyState title={t("store.suspendedEmpty.title")} body={t("store.suspendedEmpty.body")} />
      ) : loaderData.products.length === 0 ? (
        <EmptyState title={t("store.empty.title")} body={t("store.empty.body")} />
      ) : (
        <section aria-label={t("store.vendor.products")} className="flex flex-col gap-3">
          <h2 className="text-base font-extrabold text-text">{t("store.vendor.products")}</h2>
          <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
            {loaderData.products.map((product) => (
              <li key={product.id} className="relative min-w-0">
                <ProductCard card={product} lang={lang} wished={loaderData.wishedIds.has(product.id)} />
                {!product.is_listable ? (
                  <span className="pointer-events-none absolute inset-x-2 top-2 z-10 rounded-m bg-ink/80 px-2 py-1 text-center text-[10px] font-extrabold text-white">
                    {product.is_event_hidden ? t("store.eventHiddenBadge") : t("store.eventRefusedBadge")}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonPage />;
}

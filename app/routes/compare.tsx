import { Link } from "react-router";
import type { Route } from "./+types/compare";
import { useTranslation } from "react-i18next";
import { requireLang } from "~/lib/lang.server";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { publicMeta } from "~/lib/seo";
import { formatPiastres } from "~/lib/money";
import { compareProducts, type CompareProduct } from "~/features/discovery/compare";
import { EmptyState } from "~/components/ui/EmptyState";
import { Breadcrumbs } from "~/components/ui/Breadcrumbs";
import { Rating } from "~/components/ui/Rating";
import { MediaImg } from "~/components/catalog/MediaImg";
import { SkeletonPage } from "~/components/ui/Skeleton";


/**
 * /compare?ids=p1,p2 (S-21 / US-13): two products, any categories; the
 * table lists attributes shared by both + price/rating/vendor rows;
 * different categories show the "common fields only" notice. Invalid or
 * missing ids render a friendly state with "choose another product".
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  const url = new URL(request.url);
  const ids = (url.searchParams.get("ids") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => /^[0-9a-f-]{36}$/i.test(id))
    .slice(0, 2);
  if (!client || ids.length !== 2 || ids[0] === ids[1]) {
    return { lang, ids, products: [] as CompareProduct[] };
  }
  const products = (await Promise.all(ids.map((id) => loadCompareProduct(client, id)))).filter(
    (p): p is CompareProduct => p !== null,
  );
  return { lang, ids, products };
}

async function loadCompareProduct(client: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>["client"]>, id: string): Promise<CompareProduct | null> {
  const { data: rows, error } = await client.from("v_storefront_products").select("*").eq("id", id).limit(1);
  if (error || !rows || rows.length === 0) return null;
  const card = rows[0] as Record<string, unknown> & { id: string };
  const [pavRes, mediaRes] = await Promise.all([
    client.from("product_attribute_values").select(
      "attribute_id, option_id, value_text, value_number, value_bool, attribute_defs(code, label_ar, label_en)",
    ).eq("product_id", id),
    client.from("product_media").select("path, kind, position").eq("product_id", id).order("position").limit(1),
  ]);
  const attributes: CompareProduct["attributes"] = [];
  for (const raw of (pavRes.data ?? []) as Array<{
    attribute_id: string; option_id: string | null; value_text: string | null; value_number: number | null; value_bool: boolean | null;
    attribute_defs: { code: string; label_ar: string | null; label_en: string | null };
  }>) {
    let optionLabel: { ar: string | null; en: string | null } = { ar: null, en: null };
    if (raw.option_id) {
      const { data: opt } = await client.from("v_storefront_facet_options").select("label_ar, label_en").eq("option_id", raw.option_id).limit(1);
      const row = opt?.[0] as { label_ar: string; label_en: string } | undefined;
      optionLabel = { ar: row?.label_ar ?? null, en: row?.label_en ?? null };
    }
    attributes.push({
      attribute_id: raw.attribute_id,
      label_ar: raw.attribute_defs.label_ar ?? raw.attribute_defs.code,
      label_en: raw.attribute_defs.label_en ?? raw.attribute_defs.code,
      value_ar: optionLabel.ar ?? raw.value_text ?? (raw.value_number != null ? String(raw.value_number) : raw.value_bool != null ? (raw.value_bool ? "نعم" : "لا") : null),
      value_en: optionLabel.en ?? raw.value_text ?? (raw.value_number != null ? String(raw.value_number) : raw.value_bool != null ? (raw.value_bool ? "Yes" : "No") : null),
    });
  }
  const media = mediaRes.data as Array<{ path: string; kind: string }> | null;
  return {
    id: card.id as string,
    name_ar: (card.name_ar as string) || "",
    name_en: (card.name_en as string) || "",
    slug_ar: (card.slug_ar as string) || "",
    slug_en: (card.slug_en as string) || "",
    leaf_category_id: (card.leaf_category_id as string) ?? null,
    price_piastres: (card.min_price_piastres as number | null) ?? null,
    rating_avg: (card.rating_avg as number | null) ?? null,
    rating_count: (card.rating_count as number) ?? 0,
    store_name_ar: (card.store_name_ar as string) || "",
    store_name_en: (card.store_name_en as string) || "",
    store_slug: (card.vendor_slug as string) || "",
    image_path: media?.find((m) => m.kind === "image")?.path ?? null,
    attributes,
  };
}

export const meta = ({ data }: Route.MetaArgs) => {
  const lang = (data?.lang as "ar" | "en") ?? "ar";
  return publicMeta({
    lang,
    path: "/compare",
    title: lang === "ar" ? "مقارنة المنتجات — اتسوء" : "Compare products — Etsawaa",
    description: lang === "ar" ? "قارن منتجين اتجاهاً لاتجاه: المواصفات المشتركة، السعر، التقييم، والمتجر." : "Compare two products side by side: shared specs, price, rating, and store.",
    noindex: true,
  });
};

export default function ComparePage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const lang = loaderData.lang;
  const locale = lang === "en" ? "en" : "ar";
  const [a, b] = loaderData.products;
  const side = compareProducts(a ?? null, b ?? null, locale);
  const productA = side.a as CompareProduct;
  const productB = side.b as CompareProduct;

  if (!side.a || !side.b) {
    return (
      <div className="flex flex-col gap-4">
        <Breadcrumbs label={t("a11y.breadcrumbs")} items={[{ label: t("nav.home"), href: `/${lang}` }, { label: t("store.compare.title") }]} />
        <EmptyState
          title={t("store.compare.invalid.title")}
          body={t("store.compare.invalid.body")}
          action={
            <Link
              to={`/${lang}/products`}
              className="inline-block rounded-md bg-action px-4 py-2 text-sm font-bold text-on-action transition-colors duration-150 hover:bg-action-hover"
            >
              {t("store.compare.invalid.cta")}
            </Link>
          }
        />
      </div>
    );
  }

  const nameOf = (p: CompareProduct) => (locale === "ar" ? p.name_ar || p.name_en : p.name_en || p.name_ar);
  const storeOf = (p: CompareProduct) => (locale === "ar" ? p.store_name_ar || p.store_name_en : p.store_name_en || p.store_name_ar);

  const rows: Array<{ label: string; a: React.ReactNode; b: React.ReactNode }> = [
    {
      label: t("store.compare.price"),
      a: side.a.price_piastres != null ? formatPiastres(side.a.price_piastres, locale) : "—",
      b: side.b.price_piastres != null ? formatPiastres(side.b.price_piastres, locale) : "—",
    },
    {
      label: t("store.compare.rating"),
      a: side.a.rating_count > 0 ? <Rating value={side.a.rating_avg ?? 0} count={side.a.rating_count} size="sm" /> : t("store.noReviews"),
      b: side.b.rating_count > 0 ? <Rating value={side.b.rating_avg ?? 0} count={side.b.rating_count} size="sm" /> : t("store.noReviews"),
    },
    {
      label: t("store.compare.vendor"),
      a: <Link to={`/${lang}/store/${encodeURIComponent(side.a.store_slug)}`} className="font-bold text-action hover:underline">{storeOf(side.a)}</Link>,
      b: <Link to={`/${lang}/store/${encodeURIComponent(side.b.store_slug)}`} className="font-bold text-action hover:underline">{storeOf(side.b)}</Link>,
    },
    ...side.shared.map((row) => ({
      label: locale === "ar" ? row.label_ar : row.label_en,
      a: row.value_a,
      b: row.value_b,
    })),
  ];

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs label={t("a11y.breadcrumbs")} items={[{ label: t("nav.home"), href: `/${lang}` }, { label: t("store.compare.title") }]} />
      <h1 className="text-lg font-black text-text">{t("store.compare.title")}</h1>

      {side.differentCategories ? (
        <p className="rounded-lg border-2 border-warning bg-warning-soft px-4 py-3 text-sm font-bold text-warning-strong" role="status">
          {t("store.compare.differentCategories")}
        </p>
      ) : null}

      {/* desktop table */}
      <div className="hidden overflow-x-auto rounded-lg border border-border bg-surface md:block">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{t("store.compare.title")}</caption>
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="w-48 p-3 text-start font-extrabold text-text-muted">{t("store.compare.attribute")}</th>
              {[productA, productB].map((p) => (
                <th key={p.id} scope="col" className="min-w-56 p-3 text-start">
                  <Link to={`/${lang}/product/${encodeURIComponent(lang === "ar" ? p.slug_ar || p.slug_en : p.slug_en || p.slug_ar)}`} className="flex items-center gap-2.5">
                    {p.image_path ? (
                      <MediaImg path={p.image_path} alt={nameOf(p)} width={56} height={56} className="size-14 rounded-md border border-border" />
                    ) : (
                      <span className="flex size-14 items-center justify-center rounded-md bg-surface-tint text-2xs text-text-faint">{t("store.noImage")}</span>
                    )}
                    <span className="line-clamp-2 font-extrabold text-text hover:text-action">{nameOf(p)}</span>
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.label}-${index}`} className="border-b border-border last:border-none">
                <th scope="row" className="p-3 text-start font-bold text-text-muted">{row.label}</th>
                <td className="p-3 text-text">{row.a}</td>
                <td className="p-3 text-text">{row.b}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* mobile: stacked per-product cards (US-13) */}
      <div className="flex flex-col gap-4 md:hidden">
        {[side.a, side.b].map((p) => (
          <section key={p.id} className="rounded-lg border border-border bg-surface p-4" aria-label={nameOf(p)}>
            <div className="flex items-center gap-3">
              {p.image_path ? (
                <MediaImg path={p.image_path} alt={nameOf(p)} width={64} height={64} className="size-16 rounded-md border border-border" />
              ) : (
                <span className="flex size-16 items-center justify-center rounded-md bg-surface-tint text-2xs text-text-faint">{t("store.noImage")}</span>
              )}
              <Link to={`/${lang}/product/${encodeURIComponent(locale === "ar" ? p.slug_ar || p.slug_en : p.slug_en || p.slug_ar)}`} className="line-clamp-2 text-sm font-extrabold text-text hover:text-action">
                {nameOf(p)}
              </Link>
            </div>
            <dl className="mt-3 flex flex-col divide-y divide-border">
              {rows.map((row, index) => (
                <div key={`${row.label}-${index}`} className="flex items-start justify-between gap-3 py-2">
                  <dt className="text-xs font-bold text-text-muted">{row.label}</dt>
                  <dd className="text-end text-[12.5px] text-text">{row.a === undefined ? "" : p.id === productA.id ? row.a : row.b}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </div>
  );
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonPage />;
}

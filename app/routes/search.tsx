import type { Route } from "./+types/search";
import { useTranslation } from "react-i18next";
import { requireLang } from "~/lib/lang.server";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { publicMeta } from "~/lib/seo";
import { loadListing } from "~/features/storefront/server-listing";
import { didYouMean } from "~/features/storefront/api";
import { Listing } from "~/components/catalog/Listing";
import { EmptyState } from "~/components/ui/EmptyState";
import { SearchBox } from "~/components/catalog/SearchBox";
import { SkeletonPage } from "~/components/ui/Skeleton";


/**
 * Search results (S-04 / US-04): fuzzy + normalized matches, "did you
 * mean" when zero results, and guidance (no dead ends).
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
  if (!client || q.length === 0) {
    return { lang, q, data: null, suggestion: null as string | null };
  }
  const data = await loadListing(request, client, { forceQ: q });
  const suggestion = data.result.total === 0 ? await didYouMean(client, q) : null;
  return { lang, q, data, suggestion };
}

export const meta = ({ data }: Route.MetaArgs) => {
  const lang = (data?.lang as "ar" | "en") ?? "ar";
  const q = data?.q ?? "";
  return publicMeta({
    lang,
    path: `/search${q ? `?q=${encodeURIComponent(q)}` : ""}`,
    title: q
      ? lang === "ar" ? `نتائج البحث: ${q} — اتسوء` : `Search: ${q} — Etsawaa`
      : lang === "ar" ? "البحث — اتسوء" : "Search — Etsawaa",
    description:
      lang === "ar"
        ? "ابحث في منتجات المتاجر المصرية على اتسوء — تحمل الأخطاء الإملائية البسيطة والهمزات والتاء المربوطة."
        : "Search products from Egyptian stores on Etsawaa — tolerant to typos, hamza and taa-marbuta variants.",
    noindex: true,
  });
};

export default function SearchPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { lang, q, data, suggestion } = loaderData;

  if (!q) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-black text-text">{t("store.search.title")}</h1>
        <div className="mx-auto w-full max-w-xl">
          <SearchBox lang={lang} compact />
        </div>
        <EmptyState title={t("store.search.emptyTitle")} body={t("store.search.emptyBody")} />
      </div>
    );
  }

  if (!data) {
    return <p className="py-10 text-center text-sm font-bold text-text-muted">{t("errors.dataUnavailable")}</p>;
  }

  return (
    <Listing
      lang={lang}
      result={data.result}
      defs={data.scope.defs}
      state={{ ...data.state, q }}
      basePath={`/${lang}/search`}
      crumbs={[{ label: t("nav.home"), href: `/${lang}` }, { label: `${t("store.search.resultsFor")} "${q}"` }]}
      title={`${t("store.search.resultsFor")} "${q}"`}
      zeroSuggestion={suggestion}
      wishedIds={data.wishedIds}
    />
  );
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonPage />;
}

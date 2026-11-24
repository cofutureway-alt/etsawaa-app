import type { Route } from "./+types/search";
import { useTranslation } from "react-i18next";
import { getI18n } from "~/lib/i18n/config";
import { requireLang } from "~/lib/lang.server";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { publicMeta } from "~/lib/seo";
import { loadListing } from "~/features/storefront/server-listing";
import { didYouMean } from "~/features/storefront/api";
import { Listing } from "~/components/catalog/Listing";
import { EmptyState } from "~/components/ui/EmptyState";
import { SearchBox } from "~/components/catalog/SearchBox";
import { SkeletonPage } from "~/components/ui/Skeleton";
import { getSpotlightStores } from "~/features/ads/ads.server";
import { useAdImpressions } from "~/features/ads/ad-tracking";
import { VendorCard } from "~/components/catalog/VendorCard";


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
    return { lang, q, data: null, suggestion: null as string | null, spotlight: { stores: [], campaignOf: {} } as Awaited<ReturnType<typeof getSpotlightStores>> };
  }
  const [data, spotlight] = await Promise.all([
    loadListing(request, client, { forceQ: q }),
    getSpotlightStores(client, 3).catch(() => ({ stores: [], campaignOf: {} }) as Awaited<ReturnType<typeof getSpotlightStores>>),
  ]);
  const suggestion = data.result.total === 0 ? await didYouMean(client, q) : null;
  return { lang, q, data, suggestion, spotlight };
}

export const meta = ({ data }: Route.MetaArgs) => {
  const lang = (data?.lang as "ar" | "en") ?? "ar";
  const t = getI18n(lang).t;
  const q = data?.q ?? "";
  return publicMeta({
    lang,
    path: `/search${q ? `?q=${encodeURIComponent(q)}` : ""}`,
    title: q
      ? `${t("store.search.metaResultsTitle", { q })} — ${t("app.name")}`
      : `${t("store.search.metaTitle")} — ${t("app.name")}`,
    description: t("store.search.metaDescription"),
    noindex: true,
  });
};

export default function SearchPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { lang, q, data, suggestion } = loaderData;
  const spotlight = loaderData.spotlight ?? { stores: [], campaignOf: {} };
  useAdImpressions(Object.values(spotlight.campaignOf));

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
    <div className="flex flex-col gap-4">
    {spotlight.stores.length ? (
      <section aria-labelledby="spot-title" className="flex flex-col gap-2 rounded-xl border border-border bg-surface-alt p-3">
        <h2 id="spot-title" className="flex items-center gap-2 text-sm font-extrabold text-text">
          {t("ads.featuredStores")}
          <span className="rounded-full border border-border px-2 py-0.5 text-2xs font-bold text-text-muted">{t("ads.sponsored")}</span>
        </h2>
        <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {spotlight.stores.map((store) => <li key={store.id} className="min-w-0"><VendorCard store={store} lang={lang} /></li>)}
        </ul>
      </section>
    ) : null}
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
    </div>
  );
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonPage />;
}

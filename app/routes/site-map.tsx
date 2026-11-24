import { Link, data } from "react-router";
import type { Route } from "./+types/site-map";
import { useTranslation } from "react-i18next";
import { useMemo, useState } from "react";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requireLang } from "~/lib/lang.server";
import { getCategories, type CategoryNode } from "~/features/storefront/api";
import { categoryHref } from "~/components/layout/public/shared";
import { CategoryIcon } from "~/components/catalog/CategoryIcon";
import { SearchIcon } from "~/components/ui/icons";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonPage } from "~/components/ui/Skeleton";
import { publicMeta } from "~/lib/seo";

/**
 * /:lang/site-map — the site map as a page (owner request; it used to be a
 * Word download). Built from the live category tree so every name links to
 * its page and new categories appear by themselves; the intro and tips come
 * from the owner's site-map document.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  const categories = await getCategories(client, { maxDepth: 4 });
  return { lang, categories, origin: new URL(request.url).origin };
}

export const meta = ({ data: d }: Route.MetaArgs) =>
  d ? publicMeta({ lang: d.lang, path: "/site-map", title: d.lang === "en" ? "Site map — Etsawaa" : "خريطة الموقع — إتسوء",
    description: d.lang === "en" ? "Every Etsawaa section in one place." : "كل أقسام إتسوء في مكان واحد." }) : [];

const TIPS = ["c1", "c2", "c3", "s1", "s2", "s3"] as const;

export default function SiteMap({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { lang, categories } = loaderData;
  const [q, setQ] = useState("");
  const name = (c: CategoryNode) => (lang === "en" ? c.name_en || c.name_ar : c.name_ar || c.name_en);
  const fold = (s: string) => s.toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");
  const term = fold(q.trim());
  const hit = (c: CategoryNode) => fold(`${c.name_ar} ${c.name_en}`).includes(term);
  const byParent = useMemo(() => {
    const m = new Map<string, CategoryNode[]>();
    for (const c of categories) if (c.parent_id) m.set(c.parent_id, [...(m.get(c.parent_id) ?? []), c]);
    return m;
  }, [categories]);
  const kids = (id: string) => byParent.get(id) ?? [];
  const roots = categories.filter((c) => c.depth === 1);
  const count = (d: number) => categories.filter((c) => c.depth === d).length;
  // with a search term, keep a branch when it or anything below it matches
  const keep = (c: CategoryNode): boolean => !term || hit(c) || kids(c.id).some(keep);

  return (
    <div className="mx-auto flex w-full max-w-page flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-3">
        <h1 className="text-2xl font-black text-text sm:text-3xl">{t("smap.title")}</h1>
        <p className="max-w-3xl text-base leading-relaxed text-text-muted">{t("smap.lead")}</p>
        <ul className="flex flex-wrap gap-2 text-sm font-bold">
          {[1, 2, 3, 4].map((d) => (
            <li key={d} className="rounded-full border border-border bg-surface px-3 py-1 text-text">
              <span className="num text-action">{count(d)}</span> {t(`smap.level${d}`)}
            </li>
          ))}
        </ul>
      </header>

      <section className="grid gap-3 md:grid-cols-2">
        {(["customers", "vendors"] as const).map((who) => (
          <div key={who} className="rounded-lg border border-border bg-surface p-4 shadow-1">
            <h2 className="mb-2 text-sm font-extrabold text-text">{t(`smap.tips_${who}`)}</h2>
            <ul className="flex list-disc flex-col gap-1.5 ps-5 text-sm leading-relaxed text-text-muted">
              {TIPS.filter((k) => k.startsWith(who === "customers" ? "c" : "s")).map((k) => <li key={k}>{t(`smap.tip_${k}`)}</li>)}
            </ul>
          </div>
        ))}
      </section>

      <label className="relative">
        <span className="sr-only">{t("smap.search")}</span>
        <SearchIcon aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("smap.search")}
          className="h-12 w-full rounded-lg border border-border bg-surface ps-9 pe-3 text-base focus:border-action focus:outline-none" />
      </label>

      <nav aria-label={t("smap.title")} className="flex flex-col gap-4">
        {roots.filter(keep).map((root) => (
          <section key={root.id} className="rounded-lg border border-border bg-surface p-5 shadow-1">
            <h2 className="mb-4 flex items-center gap-2 border-b border-border pb-3 text-lg font-extrabold">
              <CategoryIcon icon={root.icon} className="size-5 text-action" />
              <Link to={categoryHref(lang, root)} className="text-text hover:text-action">{name(root)}</Link>
            </h2>
            <div className="columns-1 gap-6 sm:columns-2 lg:columns-3">
              {kids(root.id).filter(keep).map((sub) => (
                <div key={sub.id} className="mb-5 break-inside-avoid">
                  <h3 className="mb-2 text-base font-extrabold">
                    <Link to={categoryHref(lang, sub)} className="text-text hover:text-action">{name(sub)}</Link>
                  </h3>
                  <ul className="flex flex-col gap-2.5">
                    {kids(sub.id).filter(keep).map((group) => {
                      const leaves = kids(group.id).filter((l) => !term || hit(l) || hit(group) || hit(sub) || hit(root));
                      return (
                        <li key={group.id}>
                          <Link to={categoryHref(lang, group)} className="text-sm font-bold text-action hover:underline">{name(group)}</Link>
                          {leaves.length > 0 ? (
                            <p className="mt-0.5 text-sm leading-relaxed text-text-muted">
                              {leaves.map((leaf, i) => (
                                <span key={leaf.id}>
                                  {i > 0 ? <span aria-hidden="true" className="mx-1 text-text-faint">•</span> : null}
                                  <Link to={categoryHref(lang, leaf)} className="hover:text-action hover:underline">{name(leaf)}</Link>
                                </span>
                              ))}
                            </p>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        ))}
        {term && !roots.some(keep) ? <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-text-muted">{t("smap.none")}</p> : null}
      </nav>
    </div>
  );
}

export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}
export function HydrateFallback() {
  return <SkeletonPage />;
}

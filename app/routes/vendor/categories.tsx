import { data } from "react-router";
import type { Route } from "./+types/categories";
import { useTranslation } from "react-i18next";
import { useMemo, useState } from "react";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { PageHeader } from "~/components/layout/PageHeader";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonTable } from "~/components/ui/Skeleton";
import { CategoryIcon } from "~/components/catalog/CategoryIcon";
import { SearchIcon } from "~/components/ui/icons";

/**
 * Vendor → Categories & commissions: every subcategory and the commission
 * this store pays on a sale listed in it (store overrides, fixed mode and
 * level reductions already applied). Commission is charged on the
 * subcategory a product is listed in — top-level categories only group them.
 */

interface Cat { id: string; parent_id: string | null; depth: number; name_ar: string; name_en: string; icon: string | null }

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "vendor", request);
  const [cats, rates] = await Promise.all([
    client.from("categories").select("id, parent_id, depth, name_ar, name_en, icon")
      .lte("depth", 4).eq("is_active", true).is("deleted_at", null).order("depth").order("sort").range(0, 4999),
    client.rpc("fn_vendor_category_rates"),
  ]);
  if (cats.error) throw new Error(cats.error.message);
  const all = (cats.data ?? []) as Cat[];
  const leafCount: Record<string, number> = {};
  for (const c of all) if (c.depth === 4 && c.parent_id) leafCount[c.parent_id] = (leafCount[c.parent_id] ?? 0) + 1;
  return {
    lang,
    cats: all.filter((c) => c.depth <= 3),
    leafCount,
    rates: Object.fromEntries(((rates.data ?? []) as Array<{ category_id: string; percent: number }>).map((r) => [r.category_id, Number(r.percent)])) as Record<string, number>,
  };
}

export default function VendorCategories({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { lang, cats, leafCount, rates } = loaderData;
  const [q, setQ] = useState("");
  const name = (c: Cat) => (lang === "en" ? c.name_en || c.name_ar : c.name_ar || c.name_en);
  const fold = (s: string) => s.toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");
  const roots = cats.filter((c) => c.depth === 1);
  const kids = (id: string) => cats.filter((c) => c.parent_id === id);
  const term = fold(q.trim());
  const match = (c: Cat) => !term || fold(`${c.name_ar} ${c.name_en}`).includes(term);
  const values = Object.values(rates);
  const range = values.length ? [Math.min(...values), Math.max(...values)] : null;
  const fmt = (n: number | undefined) => (n == null ? "—" : `${Number.isInteger(n) ? n : n.toFixed(2)}%`);
  const visible = useMemo(() => roots.map((r) => ({
    root: r,
    groups: kids(r.id).map((g) => ({ group: g, subs: kids(g.id).filter((s) => match(s) || match(g) || match(r)) }))
      .filter((x) => x.subs.length > 0 || match(x.group)),
  })).filter((x) => x.groups.length > 0),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [term, cats]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("vcat.title")} subtitle={t("vcat.hint")} />
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-surface p-4 shadow-1">
          <p className="text-xs font-bold text-text-muted">{t("vcat.range")}</p>
          <p className="num mt-1 text-xl font-black text-text">{range ? `${fmt(range[0])} – ${fmt(range[1])}` : "—"}</p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4 shadow-1 sm:col-span-2">
          <p className="text-xs font-bold text-text-muted">{t("vcat.howTitle")}</p>
          <p className="mt-1 text-sm leading-relaxed text-text">{t("vcat.how")}</p>
        </div>
      </div>
      <label className="relative">
        <span className="sr-only">{t("vcat.search")}</span>
        <SearchIcon aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("vcat.search")}
          className="h-11 w-full rounded-md border border-border bg-surface ps-9 pe-3 text-sm focus:border-action focus:outline-none" />
      </label>
      {visible.length === 0 ? <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-text-muted">{t("vcat.none")}</p> : null}
      {visible.map(({ root, groups }) => (
        <details key={root.id} open={Boolean(term) || undefined} className="group rounded-lg border border-border bg-surface shadow-1">
          <summary className="flex cursor-pointer list-none items-center gap-2.5 p-4">
            <CategoryIcon icon={root.icon} className="size-5 text-action" />
            <span className="min-w-0 flex-1 truncate text-base font-extrabold text-text">{name(root)}</span>
            <span className="text-xs text-text-muted">{t("vcat.subsCount", { count: groups.reduce((n, g) => n + g.subs.length, 0) })}</span>
            <span aria-hidden="true" className="text-text-muted transition-transform group-open:rotate-180">▾</span>
          </summary>
          <div className="flex flex-col gap-4 border-t border-border p-4">
            {groups.map(({ group, subs }) => (
              <section key={group.id}>
                <h3 className="mb-2 flex items-center justify-between gap-2 text-sm font-extrabold text-text">
                  {name(group)}
                </h3>
                <ul className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
                  {subs.map((s) => (
                    <li key={s.id} className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-text">{name(s)}</span>
                        {leafCount[s.id] ? <span className="text-2xs text-text-muted">{t("vcat.leaves", { count: leafCount[s.id] })}</span> : null}
                      </span>
                      <span className="num shrink-0 rounded-full bg-action/10 px-2.5 py-0.5 text-sm font-black text-action">{fmt(rates[s.id])}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}

export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}
export function HydrateFallback() {
  return <SkeletonTable />;
}

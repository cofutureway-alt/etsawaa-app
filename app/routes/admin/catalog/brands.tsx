import { useEffect, useState } from "react";
import type { Route } from "./+types/brands";
import { Link, data, useFetcher, useNavigate, useSubmit } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/Button";
import { Dialog } from "~/components/ui/Overlay";
import { EmptyState } from "~/components/ui/EmptyState";
import { Pagination } from "~/components/ui/Pagination";
import { useActionToast } from "~/components/layout/ActionFeedback";
import { PencilIcon, PlusIcon, SearchIcon, TrashIcon } from "~/components/ui/icons";
import { publicMediaUrl } from "~/lib/media.shared";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { safeLikeTerm } from "~/lib/postgrest";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { SkeletonTable } from "~/components/ui/Skeleton";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { PageHeader } from "~/components/layout/PageHeader";
import { ListSkeleton, useListLoading } from "~/components/ui/ListLoading";

/**
 * Admin brands list (~1,500): search by Arabic/English name, filter by
 * linked category (main → includes its sub-categories), logo and status,
 * 30 per page. A row opens the brand details page (/catalog/brands/:id),
 * which is also where brands are added (/catalog/brands/new).
 */

const PER_PAGE = 30;

interface Row {
  id: string; name_ar: string; name_en: string; slug_en: string; slug_ar: string; thumb_path: string | null;
  country_ar: string; country_en: string; founded_year: number | null; is_active: boolean;
  brand_categories: Array<{ category_id: string }> | null;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 60);
  const cat = url.searchParams.get("cat") ?? "";
  const logo = url.searchParams.get("logo") ?? "";
  const status = url.searchParams.get("status") ?? "";
  const page = Math.max(1, Math.trunc(Number(url.searchParams.get("page"))) || 1);

  const { data: catRows } = await client.from("categories").select("id, parent_id, depth, name_ar, name_en")
    .lte("depth", 2).is("deleted_at", null).order("depth").order("sort");
  const cats = (catRows ?? []) as Array<{ id: string; parent_id: string | null; depth: number; name_ar: string; name_en: string }>;
  const catIds = cat ? [cat, ...cats.filter((c) => c.parent_id === cat).map((c) => c.id)] : [];

  const from = (page - 1) * PER_PAGE;
  let query = client.from("brands")
    .select(`id, name_ar, name_en, slug_ar, slug_en, thumb_path, country_ar, country_en, founded_year, is_active, brand_categories${cat ? "!inner" : ""}(category_id)`, { count: "exact" })
    .is("deleted_at", null).order("sort").order("id").range(from, from + PER_PAGE - 1);
  const term = safeLikeTerm(q, 60);
  if (term) query = query.or(`name_ar.ilike.%${term}%,name_en.ilike.%${term}%`);
  if (cat && /^[0-9a-f-]{36}$/i.test(cat)) query = query.in("brand_categories.category_id", catIds);
  if (logo === "with") query = query.not("thumb_path", "is", null);
  if (logo === "without") query = query.is("thumb_path", null);
  if (status === "active") query = query.eq("is_active", true);
  if (status === "hidden") query = query.eq("is_active", false);
  const { data: rows, count, error } = await query;
  if (error) throw new Error(error.message);
  const list = (rows ?? []) as Row[];

  // full category links for the rows on this page (the !inner filter trims them)
  const ids = list.map((r) => r.id);
  const [{ data: links }, { data: prods }, totals] = await Promise.all([
    ids.length ? client.from("brand_categories").select("brand_id, category_id").in("brand_id", ids) : Promise.resolve({ data: [] }),
    ids.length ? client.from("products").select("brand_id").in("brand_id", ids).is("deleted_at", null) : Promise.resolve({ data: [] }),
    Promise.all([
      client.from("brands").select("id", { count: "exact", head: true }).is("deleted_at", null),
      client.from("brands").select("id", { count: "exact", head: true }).is("deleted_at", null).is("thumb_path", null),
    ]),
  ]);
  const linkMap = new Map<string, string[]>();
  for (const l of (links ?? []) as Array<{ brand_id: string; category_id: string }>) linkMap.set(l.brand_id, [...(linkMap.get(l.brand_id) ?? []), l.category_id]);
  const prodCount = new Map<string, number>();
  for (const p of (prods ?? []) as Array<{ brand_id: string }>) prodCount.set(p.brand_id, (prodCount.get(p.brand_id) ?? 0) + 1);

  return {
    lang, q, cat, logo, status, page, perPage: PER_PAGE, total: count ?? 0,
    stats: { all: totals[0].count ?? 0, noLogo: totals[1].count ?? 0 },
    cats,
    supabaseUrl: process.env.SUPABASE_URL ?? "",
    brands: list.map(({ brand_categories: _bc, ...r }) => ({ ...r, category_ids: linkMap.get(r.id) ?? [], products: prodCount.get(r.id) ?? 0 })),
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const form = await request.formData();
  const id = String(form.get("id") ?? "");
  if (form.get("intent") === "delete" && id) {
    const { error } = await client.from("brands").update({ deleted_at: new Date().toISOString(), is_active: false }).eq("id", id);
    return error ? data({ ok: false, reason: error.message }, { status: 400 }) : { ok: true as const };
  }
  if (form.get("intent") === "toggle" && id) {
    const { error } = await client.from("brands").update({ is_active: form.get("active") === "true" }).eq("id", id);
    return error ? data({ ok: false, reason: error.message }, { status: 400 }) : { ok: true as const };
  }
  return data({ ok: false, reason: "bad_intent" }, { status: 400 });
}

export default function AdminBrands({ loaderData }: Route.ComponentProps) {
  const listLoading = useListLoading();
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const { lang, q, cat, logo, status, page, perPage, total, stats, cats, brands, supabaseUrl } = loaderData;
  const navigate = useNavigate();
  const submit = useSubmit();
  const fetcher = useFetcher<typeof action>();
  useActionToast(fetcher);
  const [text, setText] = useState(q);
  const [deleting, setDeleting] = useState<(typeof brands)[number] | null>(null);
  useEffect(() => { if (fetcher.state === "idle" && fetcher.data?.ok) setDeleting(null); }, [fetcher.state, fetcher.data]);

  const href = (next: Partial<{ q: string; cat: string; logo: string; status: string; page: number }>) => {
    const v = { q, cat, logo, status, page: 1, ...next };
    const sp = new URLSearchParams();
    for (const [k, val] of Object.entries(v)) if (val && !(k === "page" && val === 1)) sp.set(k, String(val));
    return `?${sp.toString()}`;
  };
  useEffect(() => {
    if (text.trim() === q) return;
    const id = window.setTimeout(() => navigate(href({ q: text.trim() }), { replace: true, preventScrollReset: true }), 350);
    return () => window.clearTimeout(id);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  const catName = new Map(cats.map((c) => [c.id, en ? c.name_en : c.name_ar]));
  const mains = cats.filter((c) => c.depth === 1);
  const SELECT = "h-10 rounded-md border border-border bg-surface px-3 text-sm text-text focus:border-action focus:outline-none";

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t("catalog.brands")}
        subtitle={t("ab.subtitle", { all: stats.all, noLogo: stats.noLogo })}
        count={stats.all}
        actions={<Link to={`/${lang}/admin/catalog/brands/new`} className="inline-flex items-center gap-1.5 rounded-md bg-action px-3.5 py-2 text-sm font-extrabold text-on-action hover:bg-action-hover"><PlusIcon className="size-4" />{t("catalog.addBrand")}</Link>}
      />

      <form className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 shadow-1 lg:flex-row lg:items-center" onSubmit={(e) => e.preventDefault()}>
        <label className="relative block min-w-0 flex-1">
          <span className="sr-only">{t("ab.search")}</span>
          <SearchIcon aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
          <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder={t("ab.search")}
            className="h-10 w-full rounded-md border border-border bg-surface ps-9 pe-3 text-sm text-text focus:border-action focus:outline-none" />
        </label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:flex">
          <select aria-label={t("ab.f.category")} value={cat} onChange={(e) => navigate(href({ cat: e.target.value }), { preventScrollReset: true })} className={`${SELECT} col-span-2 sm:col-span-1 lg:w-56`}>
            <option value="">{t("ab.f.allCategories")}</option>
            {mains.map((m) => (
              <optgroup key={m.id} label={en ? m.name_en : m.name_ar}>
                <option value={m.id}>{t("ab.f.allOf", { name: en ? m.name_en : m.name_ar })}</option>
                {cats.filter((c) => c.parent_id === m.id).map((c) => <option key={c.id} value={c.id}>{en ? c.name_en : c.name_ar}</option>)}
              </optgroup>
            ))}
          </select>
          <select aria-label={t("ab.f.logo")} value={logo} onChange={(e) => navigate(href({ logo: e.target.value }), { preventScrollReset: true })} className={SELECT}>
            <option value="">{t("ab.f.anyLogo")}</option>
            <option value="with">{t("ab.f.withLogo")}</option>
            <option value="without">{t("ab.f.withoutLogo")}</option>
          </select>
          <select aria-label={t("ab.f.status")} value={status} onChange={(e) => navigate(href({ status: e.target.value }), { preventScrollReset: true })} className={SELECT}>
            <option value="">{t("ab.f.anyStatus")}</option>
            <option value="active">{t("ab.f.active")}</option>
            <option value="hidden">{t("ab.f.hidden")}</option>
          </select>
        </div>
      </form>

      <p className="num text-xs font-bold text-text-muted">{t("ab.showing", { from: total ? (page - 1) * perPage + 1 : 0, to: Math.min(page * perPage, total), total })}</p>

      {listLoading ? <ListSkeleton /> : brands.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-6 shadow-1"><EmptyState title={t("catalog.noBrands")} body={t("ab.emptyHint")} /></div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-1">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-start text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-tint/50 text-2xs font-extrabold uppercase tracking-wide text-text-muted">
                  <th scope="col" className="px-4 py-2.5 text-start">{t("ab.col.brand")}</th>
                  <th scope="col" className="px-4 py-2.5 text-start">{t("ab.col.categories")}</th>
                  <th scope="col" className="px-4 py-2.5 text-start">{t("ab.col.origin")}</th>
                  <th scope="col" className="px-4 py-2.5 text-start">{t("ab.col.products")}</th>
                  <th scope="col" className="px-4 py-2.5 text-start">{t("ab.col.status")}</th>
                  <th scope="col" className="w-24 px-4 py-2.5"><span className="sr-only">{t("ab.col.actions")}</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {brands.map((b) => {
                  const to = `/${lang}/admin/catalog/brands/${b.id}`;
                  return (
                    <tr key={b.id} className="cursor-pointer transition-colors hover:bg-surface-tint/40" onClick={(e) => { if (!(e.target as HTMLElement).closest("a,button,form")) navigate(to); }}>
                      <td className="px-4 py-2.5">
                        <Link to={to} className="flex items-center gap-3">
                          <span className="relative flex h-11 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-white p-1">
                            {b.thumb_path ? <img src={publicMediaUrl(supabaseUrl, b.thumb_path)} alt="" width={64} height={44} loading="lazy" className="absolute inset-0 size-full p-1 object-contain" />
                              : <span className="text-2xs font-bold text-text-faint">{t("ab.noLogo")}</span>}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-extrabold text-text">{en ? b.name_en : b.name_ar}</span>
                            <span className="block truncate text-xs text-text-muted" dir={en ? "rtl" : "ltr"}>{en ? b.name_ar : b.name_en}</span>
                          </span>
                        </Link>
                      </td>
                      <td className="max-w-[260px] px-4 py-2.5">
                        <span className="flex flex-wrap gap-1">
                          {b.category_ids.slice(0, 3).map((id) => <span key={id} className="rounded-full bg-surface-tint px-2 py-0.5 text-2xs font-bold text-text-muted">{catName.get(id) ?? "—"}</span>)}
                          {b.category_ids.length > 3 ? <span className="text-2xs font-bold text-text-faint">+{b.category_ids.length - 3}</span> : null}
                          {b.category_ids.length === 0 ? <span className="text-2xs font-bold text-warning-strong">{t("ab.noCategory")}</span> : null}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-text-muted">
                        {[en ? b.country_en : b.country_ar, b.founded_year].filter(Boolean).join(" · ") || "—"}
                      </td>
                      <td className="num px-4 py-2.5 text-xs font-bold text-text">{b.products}</td>
                      <td className="px-4 py-2.5">
                        <button type="button" onClick={() => submit({ intent: "toggle", id: b.id, active: String(!b.is_active) }, { method: "post", navigate: false, fetcherKey: `toggle-${b.id}` })}
                          className={`rounded-full px-2.5 py-1 text-2xs font-extrabold ${b.is_active ? "bg-success-soft text-success-strong" : "bg-surface-tint text-text-muted"}`}>
                          {b.is_active ? t("ab.f.active") : t("ab.f.hidden")}
                        </button>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="flex justify-end gap-1">
                          <Link to={to} aria-label={t("common.edit")} title={t("common.edit")} className="grid size-8 place-items-center rounded-md text-text-muted hover:bg-surface-tint hover:text-action"><PencilIcon className="size-4" /></Link>
                          <button type="button" aria-label={t("common.delete")} title={t("common.delete")} onClick={() => setDeleting(b)} className="grid size-8 place-items-center rounded-md text-text-muted hover:bg-danger-soft hover:text-danger"><TrashIcon className="size-4" /></button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <Pagination page={page} total={total} perPage={perPage} hrefFor={(p) => href({ page: p })} />

      <Dialog open={deleting !== null} onClose={() => setDeleting(null)} title={t("common.confirm")}>
        {deleting ? (
          <fetcher.Form method="post" className="flex flex-col gap-3">
            <input type="hidden" name="intent" value="delete" />
            <input type="hidden" name="id" value={deleting.id} />
            <p className="text-sm text-text">{t("catalog.deleteConfirm", { name: en ? deleting.name_en : deleting.name_ar })}</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setDeleting(null)}>{t("common.cancel")}</Button>
              <Button type="submit" loading={fetcher.state !== "idle"} className="bg-danger hover:bg-danger">{t("common.delete")}</Button>
            </div>
          </fetcher.Form>
        ) : null}
      </Dialog>
    </div>
  );
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonTable />;
}

export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}

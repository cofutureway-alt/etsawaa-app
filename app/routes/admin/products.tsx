import { useEffect, useRef, useState, type MouseEvent } from "react";
import type { Route } from "./+types/products";
import { Form, Link, data, useFetcher, useNavigate, useNavigation, useSubmit } from "react-router";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  Pagination,
  useToast,
} from "~/components/ui";
import { CopyIcon, EyeIcon, PencilIcon, StoreIcon, TrashIcon, XIcon } from "~/components/ui/icons";
import { likeWords } from "~/lib/postgrest";
import { PanelProductSearch } from "~/components/admin/PanelProductSearch";
import { requireLang } from "~/lib/lang.server";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { canAny } from "~/lib/permissions";
import { formatPiastres } from "~/lib/money";
import { MediaImg } from "~/components/catalog/MediaImg";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonTable } from "~/components/ui/Skeleton";
import { PageHeader } from "~/components/layout/PageHeader";
import { ListSkeleton, useListLoading } from "~/components/ui/ListLoading";

/**
 * Admin › Products (was "Product approvals"): every product on the platform
 * with its image, store, category, price, stock and status. Server-side
 * filters (status / store / main category / search / sort) + pagination;
 * a row opens the full product page (/admin/products/:id) where the review
 * decision also lives. Clone / archive stay here (fn_clone_product,
 * fn_admin_archive_product).
 */

type Status = "draft" | "pending" | "approved" | "rejected";
const STATUSES: Status[] = ["pending", "approved", "rejected", "draft"];
const SORTS = ["newest", "oldest", "updated", "name"] as const;
type Sort = (typeof SORTS)[number];
const PER_PAGE = 25;

interface ProductRow {
  id: string;
  name_ar: string;
  name_en: string;
  status: Status;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  image: string | null;
  store_ar: string;
  store_en: string;
  store_logo: string | null;
  vendor_id: string;
  category_ar: string;
  category_en: string;
  price: number | null;
  sale: number | null;
  price_max: number | null;
  stock: number;
  variants: number;
  /** the vendor's account (person), not only the store */
  owner_name: string;
  /** who approved / rejected it last, and when */
  reviewer_name: string;
  reviewed_at: string | null;
}





export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) {
    throw Response.redirect(new URL(`/${lang}/auth/login?error=db`, request.url).toString(), 302);
  }
  const viewer = await requirePanelAccess(client, lang, "admin", request);
  // admins / staff who run an active store of their own can list products directly
  const { data: ownStore } = await client.from("vendors").select("id, status").eq("owner_id", viewer.user.id).maybeSingle();

  const sp = new URL(request.url).searchParams;
  const status = (STATUSES as string[]).includes(sp.get("status") ?? "") ? (sp.get("status") as Status) : "";
  const q = (sp.get("q") ?? "").trim().slice(0, 160);
  const vendor = /^[0-9a-f-]{36}$/i.test(sp.get("vendor") ?? "") ? String(sp.get("vendor")) : "";
  const category = /^[0-9a-f-]{36}$/i.test(sp.get("category") ?? "") ? String(sp.get("category")) : "";
  const sort: Sort = (SORTS as readonly string[]).includes(sp.get("sort") ?? "") ? (sp.get("sort") as Sort) : "newest";
  const page = Math.max(1, Math.min(1000, Number(sp.get("page") ?? 1) || 1));

  // same filters for the page and for the per-status counts (tabs)
  const catEmbed = category ? "categories!inner(name_ar, name_en, path)" : "categories(name_ar, name_en, path)";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const applyFilters = (query: any) => {
    let next = query.is("deleted_at", null);
    if (vendor) next = next.eq("vendor_id", vendor);
    if (category) next = next.like("categories.path", `${category}%`);
    // every word must appear (in the Arabic or the English name)
    for (const w of likeWords(q)) next = next.or(`name_ar.ilike.%${w}%,name_en.ilike.%${w}%`);
    return next;
  };

  let pageQuery = applyFilters(
    client.from("products").select(
      `id, name_ar, name_en, status, created_at, updated_at, submitted_at, vendor_id, reviewed_by, reviewed_at,
       vendors(store_name_ar, store_name_en, logo_path, owner_id),
       ${catEmbed},
       product_media(path, kind, position),
       variants(price_piastres, sale_price_piastres, stock, deleted_at)`,
      { count: "exact" },
    ),
  );
  if (status) pageQuery = pageQuery.eq("status", status);
  pageQuery =
    sort === "oldest" ? pageQuery.order("created_at", { ascending: true })
    : sort === "updated" ? pageQuery.order("updated_at", { ascending: false })
    : sort === "name" ? pageQuery.order(lang === "en" ? "name_en" : "name_ar", { ascending: true })
    : pageQuery.order("created_at", { ascending: false });

  const countFor = (s: Status | "") => {
    let cq = applyFilters(
      client.from("products").select(category ? "id, categories!inner(path)" : "id", { count: "exact", head: true }),
    );
    if (s) cq = cq.eq("status", s);
    return cq;
  };

  const [pageRes, vendorsRes, catsRes, ...counts] = await Promise.all([
    pageQuery.range((page - 1) * PER_PAGE, page * PER_PAGE - 1),
    client.from("vendors").select("id, store_name_ar, store_name_en").order(lang === "en" ? "store_name_en" : "store_name_ar").limit(1000),
    client.from("categories").select("id, name_ar, name_en").eq("depth", 1).is("deleted_at", null).order("sort").limit(200),
    countFor(""),
    ...STATUSES.map((s) => countFor(s)),
  ]);

  // names of the vendors' account holders and of the reviewers
  const pageRows = (pageRes.data ?? []) as Array<Record<string, unknown>>;
  const personIds = [...new Set(pageRows.flatMap((r) => [((r.vendors ?? {}) as { owner_id?: string | null }).owner_id, r.reviewed_by as string | null]).filter((x): x is string => Boolean(x)))];
  const people = new Map<string, string>();
  if (personIds.length) {
    const { data: ppl } = await client.from("profiles").select("id, full_name").in("id", personIds);
    for (const p of (ppl ?? []) as Array<{ id: string; full_name: string | null }>) people.set(p.id, p.full_name ?? "");
  }
  const rows: ProductRow[] = pageRows.map((row) => {
    const v = (row.vendors ?? {}) as { store_name_ar?: string; store_name_en?: string; logo_path?: string | null; owner_id?: string | null };
    const c = (row.categories ?? {}) as { name_ar?: string; name_en?: string };
    const media = ((row.product_media ?? []) as Array<{ path: string; kind: string; position: number | null }>)
      .slice()
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    const img = media.find((m) => m.kind === "image") ?? null;
    const variants = ((row.variants ?? []) as Array<{ price_piastres: number | null; sale_price_piastres: number | null; stock: number | null; deleted_at: string | null }>)
      .filter((x) => !x.deleted_at);
    const prices = variants.map((x) => x.price_piastres).filter((n): n is number => typeof n === "number");
    const sales = variants
      .filter((x) => x.sale_price_piastres != null && x.price_piastres != null && x.sale_price_piastres < x.price_piastres)
      .map((x) => x.sale_price_piastres as number);
    return {
      id: row.id as string,
      name_ar: (row.name_ar as string) ?? "",
      name_en: (row.name_en as string) ?? "",
      status: row.status as Status,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
      submitted_at: (row.submitted_at as string | null) ?? null,
      image: img?.path ?? null,
      store_ar: v.store_name_ar ?? "",
      store_en: v.store_name_en ?? "",
      store_logo: v.logo_path ?? null,
      vendor_id: row.vendor_id as string,
      category_ar: c.name_ar ?? "",
      category_en: c.name_en ?? "",
      price: prices.length ? Math.min(...prices) : null,
      price_max: prices.length ? Math.max(...prices) : null,
      sale: sales.length ? Math.min(...sales) : null,
      stock: variants.reduce((n, x) => n + (x.stock ?? 0), 0),
      variants: variants.length,
      owner_name: people.get(v.owner_id ?? "") ?? "",
      reviewer_name: people.get((row.reviewed_by as string | null) ?? "") ?? "",
      reviewed_at: (row.reviewed_at as string | null) ?? null,
    };
  });

  const countOf = (r: { count?: number | null }) => r.count ?? 0;
  return data({
    ownStoreActive: ownStore?.status === "active",
    // the row edit button / the review page's edit action
    canEdit: canAny(viewer.profile.role, viewer.permissions ?? [], ["products.edit"]),
    lang,
    rows,
    total: pageRes.count ?? 0,
    page,
    perPage: PER_PAGE,
    filters: { status, q, vendor, category, sort },
    counts: {
      all: countOf(counts[0] as { count?: number | null }),
      ...Object.fromEntries(STATUSES.map((s, i) => [s, countOf(counts[i + 1] as { count?: number | null })])),
    } as Record<Status | "all", number>,
    vendors: ((vendorsRes.data ?? []) as Array<{ id: string; store_name_ar: string; store_name_en: string }>),
    categories: ((catsRes.data ?? []) as Array<{ id: string; name_ar: string; name_en: string }>),
  });
}

type ActionData = { ok: boolean; error?: string; intent?: string; deleted?: number; archived?: number; soldArchived?: number };

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data<ActionData>({ ok: false, error: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const form = await request.formData();
  const productId = String(form.get("productId") ?? "");
  const intent = String(form.get("intent") ?? "");
  const reason = String(form.get("reason") ?? "").trim();

  // bulk: permanent delete (sold products are archived instead) or archive
  if (intent === "bulk") {
    const mode = String(form.get("mode") ?? "") === "archive" ? "archive" : "delete";
    let ids: string[] = [];
    try { ids = (JSON.parse(String(form.get("ids") ?? "[]")) as unknown[]).map(String).filter((id) => /^[0-9a-f-]{36}$/i.test(id)); } catch { ids = []; }
    if (ids.length === 0) return data<ActionData>({ ok: false, error: "input" }, { status: 400 });
    if (reason.length < 3) return data<ActionData>({ ok: false, error: "reason_required" }, { status: 400 });
    const res = await client.rpc("fn_admin_delete_products", { p_ids: ids, p_reason: reason, p_mode: mode });
    if (res.error) return data<ActionData>({ ok: false, error: res.error.message }, { status: 400 });
    const r = res.data as { ok: boolean; reason?: string; deleted?: number; archived?: number; sold_archived?: number };
    return r?.ok
      ? { ok: true, intent, deleted: r.deleted ?? 0, archived: r.archived ?? 0, soldArchived: r.sold_archived ?? 0 }
      : data<ActionData>({ ok: false, error: r?.reason ?? "rpc" }, { status: 400 });
  }

  if (!productId) return data<ActionData>({ ok: false, error: "input" }, { status: 400 });

  // A-09/A-10 — clone (fn_clone_product) + soft-archive (audited)
  if (intent === "clone") {
    const res = await client.rpc("fn_clone_product", { p_product_id: productId });
    if (res.error) return data<ActionData>({ ok: false, error: res.error.message }, { status: 400 });
    const r = res.data as { ok: boolean; reason?: string };
    return r?.ok ? { ok: true, intent } : data<ActionData>({ ok: false, error: r?.reason ?? "rpc" }, { status: 400 });
  }
  if (intent === "archive") {
    if (reason.length < 3) return data<ActionData>({ ok: false, error: "reason_required" }, { status: 400 });
    const res = await client.rpc("fn_admin_archive_product", { p_product_id: productId, p_reason: reason });
    if (res.error) return data<ActionData>({ ok: false, error: res.error.message }, { status: 400 });
    const r = res.data as { ok: boolean; reason?: string };
    return r?.ok ? { ok: true, intent } : data<ActionData>({ ok: false, error: r?.reason ?? "rpc" }, { status: 400 });
  }
  return data<ActionData>({ ok: false, error: "input" }, { status: 400 });
}

const TONE: Record<Status, "success" | "warning" | "danger" | "neutral"> = {
  approved: "success",
  pending: "warning",
  rejected: "danger",
  draft: "neutral",
};

export default function AdminProducts({ loaderData }: Route.ComponentProps) {
  const listLoading = useListLoading();
  const { t } = useTranslation();
  const { lang, rows, total, page, perPage, filters, counts, vendors, categories } = loaderData;
  const en = lang === "en";
  const base = `/${lang}/admin/products`;
  const navigate = useNavigate();
  const submit = useSubmit();
  const navigation = useNavigation();
  const loading = navigation.state === "loading" && navigation.location?.pathname === base;
  const fetcher = useFetcher<ActionData>();
  const toast = useToast();
  const [archiveTarget, setArchiveTarget] = useState<ProductRow | null>(null);
  const [reason, setReason] = useState("");
  // bulk selection (current page) + the confirm dialog
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bulkMode, setBulkMode] = useState<"delete" | "archive" | null>(null);
  const [bulkReason, setBulkReason] = useState("");
  useEffect(() => { setSelected(new Set()); }, [rows]);
  const toggleOne = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll = () => setSelected(allOnPage ? new Set() : new Set(rows.map((r) => r.id)));
  const lastToast = useRef<unknown>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data || lastToast.current === fetcher.data) return;
    lastToast.current = fetcher.data;
    if (fetcher.data.ok && fetcher.data.intent === "bulk") {
      toast.showToast("success", t("adminProducts.bulkDone", { deleted: fetcher.data.deleted ?? 0, archived: fetcher.data.archived ?? 0 }));
      if (fetcher.data.soldArchived) toast.showToast("info", t("adminProducts.bulkSoldNote", { count: fetcher.data.soldArchived }));
      setBulkMode(null);
      setBulkReason("");
      setSelected(new Set());
    } else if (fetcher.data.ok) {
      toast.showToast("success", t(fetcher.data.intent === "clone" ? "adminProducts.cloned" : "adminProducts.archived"));
      setArchiveTarget(null);
      setReason("");
    } else {
      toast.showToast("error", t("errors.generic"));
    }
  }, [fetcher.state, fetcher.data, toast, t]);

  const money = (p: number | null) => (p == null ? "—" : formatPiastres(p, en ? "en" : "ar"));
  const date = (v: string | null) =>
    v ? new Date(v).toLocaleDateString(en ? "en-GB" : "ar-EG-u-nu-latn", { day: "numeric", month: "short", year: "numeric" }) : "—";
  const nameOf = (r: ProductRow) => (en ? r.name_en || r.name_ar : r.name_ar || r.name_en);
  const altName = (r: ProductRow) => (en ? r.name_ar : r.name_en);
  const storeOf = (r: ProductRow) => (en ? r.store_en || r.store_ar : r.store_ar || r.store_en);
  const catOf = (r: ProductRow) => (en ? r.category_en || r.category_ar : r.category_ar || r.category_en);

  /** URL for the current filters with some keys replaced (page resets unless given). */
  const hrefWith = (patch: Record<string, string | number | null>) => {
    const sp = new URLSearchParams();
    const merged: Record<string, string | number | null> = { ...filters, page: null, ...patch };
    for (const [k, v] of Object.entries(merged)) {
      if (v === null || v === "" || (k === "sort" && v === "newest") || (k === "page" && Number(v) <= 1)) continue;
      sp.set(k, String(v));
    }
    const s = sp.toString();
    return s ? `${base}?${s}` : base;
  };
  const hasFilters = Boolean(filters.q || filters.vendor || filters.category || filters.status || filters.sort !== "newest");
  const from = total === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(total, page * perPage);
  const open = (r: ProductRow) => navigate(`${base}/${r.id}`);
  /** row click, except on the row's own links / buttons */
  const onRowClick = (e: MouseEvent, r: ProductRow) => {
    if ((e.target as HTMLElement).closest("a,button,form,input,label")) return;
    open(r);
  };

  const tabs: Array<{ key: Status | ""; label: string; count: number }> = [
    { key: "", label: t("common.all"), count: counts.all },
    ...STATUSES.map((s) => ({ key: s, label: t(`vendorStates.status.${s}`), count: counts[s] })),
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("adminProducts.title")} count={counts.all} subtitle={t("adminProducts.subtitle")}
        actions={loaderData.ownStoreActive ? (
          <Link to={`/${loaderData.lang}/vendor/products/new`}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-md bg-action px-4 text-sm font-extrabold text-on-action hover:bg-action-hover">
            + {t("adminProducts.addProduct")}
          </Link>
        ) : (
          <Link to={`/${loaderData.lang}/vendor/onboarding`} title={t("adminProducts.openStoreHint")}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-border px-4 text-sm font-bold text-text hover:bg-surface-tint">
            <StoreIcon className="size-4" /> {t("adminProducts.openStore")}
          </Link>
        )} />

      {/* status tabs with live counts */}
      <nav aria-label={t("adminProducts.filter")} className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
        {tabs.map((tab) => {
          const active = filters.status === tab.key;
          return (
            <Link
              key={tab.key || "all"}
              to={hrefWith({ status: tab.key })}
              aria-current={active ? "page" : undefined}
              preventScrollReset
              className={`flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-bold transition-colors duration-150 ${
                active ? "border-action bg-action text-on-action shadow-1" : "border-border bg-surface text-text-muted hover:border-text-faint hover:text-text"
              }`}
            >
              {tab.key === "pending" && tab.count > 0 && !active ? <span aria-hidden="true" className="size-2 rounded-full bg-warning" /> : null}
              {tab.label}
              <span className={`num rounded-full px-1.5 text-2xs ${active ? "bg-white/20" : "bg-surface-tint text-text"}`}>{tab.count}</span>
            </Link>
          );
        })}
      </nav>

      {/* filters — a GET form, so every view is a shareable URL */}
      <Form
        ref={formRef}
        method="get"
        action={base}
        preventScrollReset
        className="grid gap-2.5 rounded-lg border border-border bg-surface p-3 shadow-1 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto]"
      >
        {filters.status ? <input type="hidden" name="status" value={filters.status} /> : null}
        <PanelProductSearch className="sm:col-span-2 lg:col-span-1" defaultValue={filters.q} placeholder={t("adminProducts.search")}
          hrefFor={(id) => `${base}/${id}`} lang={lang} />
        <FilterSelect
          label={t("adminProducts.f.store")}
          name="vendor"
          value={filters.vendor}
          onPick={() => submit(formRef.current, { preventScrollReset: true })}
          options={[{ value: "", label: t("adminProducts.f.allStores") }, ...vendors.map((v) => ({ value: v.id, label: (en ? v.store_name_en || v.store_name_ar : v.store_name_ar || v.store_name_en) || "—" }))]}
        />
        <FilterSelect
          label={t("adminProducts.f.category")}
          name="category"
          value={filters.category}
          onPick={() => submit(formRef.current, { preventScrollReset: true })}
          options={[{ value: "", label: t("adminProducts.f.allCategories") }, ...categories.map((c) => ({ value: c.id, label: en ? c.name_en || c.name_ar : c.name_ar || c.name_en }))]}
        />
        <FilterSelect
          label={t("adminProducts.f.sort")}
          name="sort"
          value={filters.sort}
          onPick={() => submit(formRef.current, { preventScrollReset: true })}
          options={SORTS.map((s) => ({ value: s, label: t(`adminProducts.sort.${s}`) }))}
        />
        <div className="flex gap-2 sm:col-span-2 lg:col-span-1">
          <Button type="submit" className="h-10 flex-1 lg:flex-none">{t("adminProducts.f.apply")}</Button>
          {hasFilters ? (
            <Link to={base} className="flex h-10 items-center gap-1 rounded-md px-3 text-sm font-bold text-text-muted hover:bg-surface-tint hover:text-text">
              <XIcon className="size-4" aria-hidden="true" />
              {t("adminProducts.f.clear")}
            </Link>
          ) : null}
        </div>
      </Form>

      {listLoading ? <ListSkeleton /> : rows.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-6 shadow-1">
          <EmptyState
            title={hasFilters ? t("adminProducts.emptySearch") : t("adminProducts.emptyAll")}
            body={hasFilters ? t("adminProducts.emptySearchBody") : t("adminProducts.emptyAllBody")}
          />
        </div>
      ) : (
        <section aria-busy={loading} className={`overflow-hidden rounded-lg border border-border bg-surface shadow-1 transition-opacity ${loading ? "opacity-60" : ""}`}>
          <div className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2 text-xs text-text-muted">
            {selected.size > 0 ? (
              <>
                <span className="num text-sm font-extrabold text-text">{t("adminProducts.selectedN", { count: selected.size })}</span>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>{t("adminProducts.clearSelection")}</Button>
                  <Button size="sm" variant="outline" onClick={() => { setBulkMode("archive"); setBulkReason(""); }}>{t("adminProducts.archive")}</Button>
                  <Button size="sm" variant="primary" onClick={() => { setBulkMode("delete"); setBulkReason(""); }}>{t("adminProducts.bulkDelete")}</Button>
                </div>
              </>
            ) : (
              <span className="num">{t("adminProducts.showing", { from, to, total })}</span>
            )}
          </div>

          {/* desktop table */}
          <div className="relative hidden overflow-x-auto lg:block">
            <table className="w-full min-w-[1040px] text-sm">
              <thead className="bg-surface-tint/60 text-xs text-text-muted">
                <tr className="text-start">
                  <th scope="col" className="w-10 ps-4 pe-0 py-2.5">
                    <input type="checkbox" className="size-4 cursor-pointer accent-action" checked={allOnPage} onChange={toggleAll} aria-label={t("adminProducts.selectAll")} />
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-start font-bold">{t("adminProducts.col.product")}</th>
                  <th scope="col" className="px-3 py-2.5 text-start font-bold">{t("adminProducts.col.store")}</th>
                  <th scope="col" className="px-3 py-2.5 text-start font-bold">{t("adminProducts.col.category")}</th>
                  <th scope="col" className="px-3 py-2.5 text-end font-bold">{t("adminProducts.col.price")}</th>
                  <th scope="col" className="px-3 py-2.5 text-end font-bold">{t("adminProducts.col.stock")}</th>
                  <th scope="col" className="px-3 py-2.5 text-start font-bold">{t("adminProducts.col.status")}</th>
                  <th scope="col" className="px-3 py-2.5 text-start font-bold">{t("adminProducts.col.added")}</th>
                  <th scope="col" className="px-4 py-2.5 text-end font-bold"><span className="sr-only">{t("adminProducts.col.actions")}</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.id} onClick={(e) => onRowClick(e, r)} className={`group cursor-pointer transition-colors hover:bg-surface-tint/50 ${selected.has(r.id) ? "bg-surface-tint/60" : ""}`}>
                    <td className="w-10 ps-4 pe-0 py-3">
                      <input type="checkbox" className="size-4 cursor-pointer accent-action" checked={selected.has(r.id)} onChange={() => toggleOne(r.id)} aria-label={t("adminProducts.selectRow", { name: nameOf(r) })} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Thumb path={r.image} size={56} />
                        <div className="min-w-0 max-w-[300px]">
                          <Link to={`${base}/${r.id}`} className="line-clamp-2 font-bold text-text group-hover:text-action">{nameOf(r) || "—"}</Link>
                          {altName(r) ? <p className="truncate text-xs text-text-faint" dir={en ? "rtl" : "ltr"}>{altName(r)}</p> : null}
                          <p className="num mt-0.5 text-2xs text-text-muted">{t("adminProducts.variantsCount", { count: r.variants })}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <StoreCell name={storeOf(r)} logo={r.store_logo} />
                      {r.owner_name ? <p className="mt-0.5 max-w-[180px] truncate ps-9 text-2xs text-text-muted" title={t("adminProducts.ownerAccount")}>{r.owner_name}</p> : null}
                    </td>
                    <td className="px-3 py-3 text-text-muted">{catOf(r) || "—"}</td>
                    <td className="px-3 py-3 text-end"><PriceCell price={r.price} sale={r.sale} max={r.price_max} money={money} /></td>
                    <td className="px-3 py-3 text-end"><StockCell stock={r.stock} variants={r.variants} /></td>
                    <td className="px-3 py-3">
                      <Badge tone={TONE[r.status]}>{t(`vendorStates.status.${r.status}`)}</Badge>
                      {r.reviewer_name && (r.status === "approved" || r.status === "rejected") ? (
                        <p className="mt-1 max-w-[150px] truncate text-2xs text-text-muted">{t("adminProducts.reviewedBy", { name: r.reviewer_name })}</p>
                      ) : null}
                    </td>
                    <td className="num px-3 py-3 text-xs text-text-muted">{date(r.created_at)}</td>
                    <td className="px-4 py-3">
                      <RowActions
                        row={r}
                        base={base}
                        canEdit={loaderData.canEdit}
                        onArchive={() => { setArchiveTarget(r); setReason(""); }}
                        fetcher={fetcher}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* phones / tablets: cards */}
          <ul className="divide-y divide-border lg:hidden">
            {rows.map((r) => (
              <li key={r.id} onClick={(e) => onRowClick(e, r)} className={`flex cursor-pointer gap-3 p-3 active:bg-surface-tint/60 ${selected.has(r.id) ? "bg-surface-tint/60" : ""}`}>
                <input type="checkbox" className="mt-1 size-5 shrink-0 cursor-pointer accent-action" checked={selected.has(r.id)} onChange={() => toggleOne(r.id)} aria-label={t("adminProducts.selectRow", { name: nameOf(r) })} />
                <Thumb path={r.image} size={72} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-2">
                    <Link to={`${base}/${r.id}`} className="line-clamp-2 min-w-0 flex-1 text-sm font-bold text-text">{nameOf(r) || "—"}</Link>
                    <Badge tone={TONE[r.status]}>{t(`vendorStates.status.${r.status}`)}</Badge>
                    {loaderData.canEdit ? (
                      <Link to={`${base}/${r.id}/edit`} aria-label={t("common.edit")} title={t("common.edit")} className="grid size-7 shrink-0 place-items-center rounded-md text-text-muted hover:bg-surface-tint hover:text-text">
                        <PencilIcon className="size-4" aria-hidden="true" />
                      </Link>
                    ) : null}
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-xs text-text-muted">
                    <StoreIcon aria-hidden="true" className="size-3.5 shrink-0" />
                    <span className="truncate">{storeOf(r) || "—"}{r.owner_name ? ` (${r.owner_name})` : ""}</span>
                    {catOf(r) ? <><span aria-hidden="true">·</span><span className="truncate">{catOf(r)}</span></> : null}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                    <PriceCell price={r.price} sale={r.sale} max={r.price_max} money={money} inline />
                    <StockCell stock={r.stock} variants={r.variants} />
                  </div>
                  {r.reviewer_name && (r.status === "approved" || r.status === "rejected") ? (
                    <p className="mt-1 truncate text-2xs text-text-muted">{t("adminProducts.reviewedBy", { name: r.reviewer_name })}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>

          <div className="border-t border-border px-4 py-3">
            <Pagination page={page} total={total} perPage={perPage} hrefFor={(p) => hrefWith({ page: p })} />
          </div>
        </section>
      )}

      {/* bulk: permanent delete (sold products → archived) or archive */}
      <Dialog open={bulkMode !== null} onClose={() => setBulkMode(null)} title={t(bulkMode === "delete" ? "adminProducts.bulkDeleteTitle" : "adminProducts.bulkArchiveTitle", { count: selected.size })}>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text">{t(bulkMode === "delete" ? "adminProducts.bulkDeleteNote" : "adminProducts.archiveNote")}</p>
          <label className="flex flex-col gap-1.5 text-sm font-bold text-text">
            {t("adminProducts.reason")}
            <textarea
              id="bulk-reason"
              className="min-h-16 rounded-md border border-border bg-surface p-2.5 text-sm text-text outline-none focus:shadow-focus"
              value={bulkReason}
              onChange={(e) => setBulkReason(e.target.value)}
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setBulkMode(null)}>{t("common.cancel")}</Button>
            <Button
              variant="primary"
              disabled={bulkReason.trim().length < 3 || fetcher.state !== "idle"}
              loading={fetcher.state !== "idle"}
              onClick={() => fetcher.submit({ intent: "bulk", mode: bulkMode ?? "archive", ids: JSON.stringify([...selected]), reason: bulkReason }, { method: "post" })}
            >
              {t(bulkMode === "delete" ? "adminProducts.bulkDeleteConfirm" : "adminProducts.archiveConfirm")}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* A-10 — archive (soft delete + audit) */}
      <Dialog open={archiveTarget !== null} onClose={() => setArchiveTarget(null)} title={t("adminProducts.archiveTitle")}>
        {archiveTarget ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3 rounded-md border border-border p-2.5">
              <Thumb path={archiveTarget.image} size={48} />
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-text">{nameOf(archiveTarget)}</p>
                <p className="truncate text-xs text-text-muted">{storeOf(archiveTarget)}</p>
              </div>
            </div>
            <p className="text-sm text-text">{t("adminProducts.archiveNote")}</p>
            <label className="flex flex-col gap-1.5 text-sm font-bold text-text">
              {t("adminProducts.reason")}
              <textarea
                className="min-h-16 rounded-md border border-border bg-surface p-2.5 text-sm text-text outline-none focus:shadow-focus"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setArchiveTarget(null)}>{t("common.cancel")}</Button>
              <Button
                disabled={reason.trim().length < 3 || fetcher.state !== "idle"}
                onClick={() => fetcher.submit({ intent: "archive", productId: archiveTarget.id, reason }, { method: "post" })}
              >
                {t("adminProducts.archiveConfirm")}
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}

function FilterSelect({ label, name, value, options, onPick }: {
  label: string;
  name: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onPick: () => void;
}) {
  return (
    <label className="block">
      <span className="sr-only">{label}</span>
      <select
        name={name}
        defaultValue={value}
        onChange={onPick}
        title={label}
        className="h-10 w-full cursor-pointer rounded-md border border-border bg-surface px-3 text-sm text-text outline-none transition-shadow focus:border-primary focus:shadow-focus"
      >
        {options.map((o) => (
          <option key={o.value || "all"} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

function Thumb({ path, size }: { path: string | null; size: number }) {
  return (
    <span className="grid shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-surface-tint" style={{ width: size, height: size }}>
      {path ? (
        <MediaImg path={path} alt="" width={size} height={size} className="size-full object-cover" />
      ) : (
        <span aria-hidden="true" className="text-2xs text-text-faint">—</span>
      )}
    </span>
  );
}

function StoreCell({ name, logo }: { name: string; logo: string | null }) {
  return (
    <span className="flex min-w-0 max-w-[180px] items-center gap-2">
      <span className="grid size-7 shrink-0 place-items-center overflow-hidden rounded-full border border-border bg-surface-tint text-text-faint">
        {logo ? <MediaImg path={logo} alt="" width={28} height={28} className="size-full object-cover" /> : <StoreIcon aria-hidden="true" className="size-3.5" />}
      </span>
      <span className="truncate font-bold text-text">{name || "—"}</span>
    </span>
  );
}

function PriceCell({ price, sale, max, money, inline = false }: {
  price: number | null;
  sale: number | null;
  max: number | null;
  money: (p: number | null) => string;
  inline?: boolean;
}) {
  if (price == null) return <span className="text-text-faint">—</span>;
  const range = max != null && max !== price;
  return (
    <span className={`num ${inline ? "flex items-baseline gap-1.5" : "flex flex-col items-end"}`}>
      {sale != null ? (
        <>
          <b className="text-danger">{money(sale)}</b>
          <s className="text-2xs text-text-faint">{money(price)}</s>
        </>
      ) : (
        <b className="text-text">{money(price)}{range ? <span className="font-normal text-text-muted"> – {money(max)}</span> : null}</b>
      )}
    </span>
  );
}

function StockCell({ stock, variants }: { stock: number; variants: number }) {
  const { t } = useTranslation();
  if (variants === 0) return <span className="text-xs text-text-faint">—</span>;
  const tone = stock === 0 ? "bg-danger-soft text-danger" : stock < 5 ? "bg-warning-soft text-warning-strong" : "bg-success-soft text-success-strong";
  return (
    <span className={`num inline-flex rounded-full px-2 py-0.5 text-xs font-bold ${tone}`}>
      {stock === 0 ? t("adminProducts.outOfStock") : t("adminProducts.inStock", { count: stock })}
    </span>
  );
}

function RowActions({ row, base, canEdit, onArchive, fetcher }: {
  row: ProductRow;
  base: string;
  canEdit: boolean;
  onArchive: () => void;
  fetcher: ReturnType<typeof useFetcher<ActionData>>;
}) {
  const { t } = useTranslation();
  const btn = "grid size-8 cursor-pointer place-items-center rounded-md text-text-muted transition-colors hover:bg-surface-tint hover:text-text";
  return (
    <div className="flex items-center justify-end gap-0.5">
      {row.status === "pending" ? (
        <Link to={`${base}/${row.id}`} className="me-1 rounded-md bg-action px-2.5 py-1.5 text-xs font-extrabold text-on-action hover:bg-action-hover">
          {t("adminProducts.review")}
        </Link>
      ) : (
        <Link to={`${base}/${row.id}`} className={btn} aria-label={t("adminProducts.view")} title={t("adminProducts.view")}>
          <EyeIcon className="size-4" />
        </Link>
      )}
      {canEdit ? (
        <Link to={`${base}/${row.id}/edit`} className={btn} aria-label={t("common.edit")} title={t("common.edit")}>
          <PencilIcon className="size-4" />
        </Link>
      ) : null}
      {row.status !== "pending" ? (
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="clone" />
          <input type="hidden" name="productId" value={row.id} />
          <button type="submit" className={btn} aria-label={t("adminProducts.clone")} title={t("adminProducts.clone")}>
            <CopyIcon className="size-4" />
          </button>
        </fetcher.Form>
      ) : null}
      {row.status !== "pending" && row.status !== "draft" ? (
        <button type="button" onClick={onArchive} className={`${btn} hover:text-danger`} aria-label={t("adminProducts.archive")} title={t("adminProducts.archive")}>
          <TrashIcon className="size-4" />
        </button>
      ) : null}
    </div>
  );
}

/** H-06: friendly route error page (500s log a CORERR id; 403/404 keep their message) */
export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonTable />;
}

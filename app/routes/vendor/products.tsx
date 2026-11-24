import { useEffect, useMemo, useState } from "react";
import type { Route } from "./+types/products";
import { Link, data, useFetcher, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  Card,
  CardBody,
  DataTable,
  Dialog,
  EmptyState,
  useToast,
  CopyIcon,
  PencilIcon,
  TrashIcon,
} from "~/components/ui";
import { AlertIcon, PackageIcon, StarIcon } from "~/components/ui/icons";
import { Rating } from "~/components/ui/Rating";
import { formatPiastres } from "~/lib/money";
import { requireLang } from "~/lib/lang.server";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { fetchVendorRow } from "~/features/vendor/api";
import { publicMediaUrl } from "~/lib/media.shared";
import { PanelProductSearch } from "~/components/admin/PanelProductSearch";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonPage } from "~/components/ui/Skeleton";
import { ListSkeleton, useListLoading } from "~/components/ui/ListLoading";


/**
 * Vendor product list (V-18): status filter tabs + search, badges, clone
 * (draft "(copy)" with unique SKUs) and soft archive with confirmation.
 */

export interface ProductListRow {
  id: string;
  name_ar: string;
  name_en: string;
  status: "draft" | "pending" | "approved" | "rejected";
  rejection_reason: string | null;
  review_note: string | null;
  rejected_final: boolean;
  updated_at: string;
  media_path: string | null;
  /** cheapest price a buyer pays now, and the regular price it is cut from */
  price_now: number | null;
  price_before: number | null;
  stock: number;
  /** live colour/size rows (stock is per row) */
  offers: number;
  sold: number;
  revenue: number;
  rating_avg: number | null;
  rating_count: number;
  category: string;
  /** pinned to the home page with a level reward slot */
  featured: boolean;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) {
    throw Response.redirect(new URL(`/${lang}/auth/login?error=db`, request.url).toString(), 302);
  }
  const viewer = await requirePanelAccess(client, lang, "vendor", request);
  const vendor = await fetchVendorRow(client, viewer.user.id);
  if (!vendor) {
    throw Response.redirect(new URL(`/${lang}/vendor/onboarding`, request.url).toString(), 302);
  }

  const status = new URL(request.url).searchParams.get("status") ?? "";
  const allowed = ["draft", "pending", "approved", "rejected"];
  let query = client
    .from("products")
    .select(
      `id, name_ar, name_en, status, rejection_reason, review_note, rejected_final, updated_at, featured_by_vendor,
       leaf_category_id, categories:leaf_category_id(name_ar, name_en),
       product_media(path, position, kind),
       variants(price_piastres, sale_price_piastres, sale_starts_at, sale_ends_at, stock, is_active, deleted_at)`,
    )
    .eq("vendor_id", vendor.id)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(200);
  if (allowed.includes(status)) query = query.eq("status", status);

  const [{ data: products }, { data: slots }, { data: soldRows }, { data: reviewRows }] = await Promise.all([
    query,
    // home-featured allowance from the store's current level (0 = no reward)
    client.rpc("fn_vendor_featured_slots", { p_vendor: vendor.id }),
    // units + revenue per product (own order lines; cancelled orders excluded)
    client.from("order_items").select("product_id, qty, line_total_piastres, orders!inner(status)")
      .eq("vendor_id", vendor.id).neq("orders.status", "cancelled").limit(5000),
    client.from("reviews").select("product_id, rating").eq("vendor_id", vendor.id).eq("status", "published").limit(5000),
  ]);
  const sold = new Map<string, { qty: number; revenue: number }>();
  for (const r of (soldRows ?? []) as Array<{ product_id: string; qty: number; line_total_piastres: number }>) {
    const cur = sold.get(r.product_id) ?? { qty: 0, revenue: 0 };
    cur.qty += r.qty; cur.revenue += r.line_total_piastres; sold.set(r.product_id, cur);
  }
  const ratings = new Map<string, number[]>();
  for (const r of (reviewRows ?? []) as Array<{ product_id: string; rating: number }>) {
    ratings.set(r.product_id, [...(ratings.get(r.product_id) ?? []), Number(r.rating)]);
  }
  const now = Date.now();
  const rows: ProductListRow[] = (products ?? []).map((row: Record<string, unknown>) => {
    const media = Array.isArray(row.product_media)
      ? (row.product_media as Array<{ path: string; kind: string }>)
      : [];
    const first = media.find((m) => m.kind === "image") ?? media[0];
    type V = { price_piastres: number | null; sale_price_piastres: number | null; sale_starts_at: string | null; sale_ends_at: string | null; stock: number; is_active: boolean; deleted_at: string | null };
    const variants = (Array.isArray(row.variants) ? (row.variants as V[]) : []).filter((v) => !v.deleted_at && v.is_active);
    const onSale = (v: V) => v.sale_price_piastres != null && v.price_piastres != null && v.sale_price_piastres < v.price_piastres &&
      (!v.sale_starts_at || new Date(v.sale_starts_at).getTime() <= now) && (!v.sale_ends_at || new Date(v.sale_ends_at).getTime() > now);
    const offers = variants.filter((v) => v.price_piastres != null)
      .map((v) => ({ now: onSale(v) ? v.sale_price_piastres! : v.price_piastres!, regular: v.price_piastres! }))
      .sort((a, b) => a.now - b.now);
    const cat = row.categories as { name_ar: string; name_en: string } | null;
    const rs = ratings.get(row.id as string) ?? [];
    const sales = sold.get(row.id as string);
    return {
      id: row.id as string,
      name_ar: row.name_ar as string,
      name_en: row.name_en as string,
      status: row.status as ProductListRow["status"],
      rejection_reason: (row.rejection_reason as string | null) ?? null,
      review_note: (row.review_note as string | null) ?? null,
      rejected_final: Boolean(row.rejected_final),
      updated_at: row.updated_at as string,
      media_path: first?.path ?? null,
      price_now: offers[0]?.now ?? null,
      price_before: offers[0] && offers[0].regular > offers[0].now ? offers[0].regular : null,
      stock: variants.reduce((sum, v) => sum + Math.max(0, v.stock), 0),
      offers: variants.length,
      sold: sales?.qty ?? 0,
      revenue: sales?.revenue ?? 0,
      rating_avg: rs.length ? Math.round((rs.reduce((a, b) => a + b, 0) / rs.length) * 10) / 10 : null,
      rating_count: rs.length,
      category: cat ? (lang === "ar" ? cat.name_ar : cat.name_en) : "",
      featured: Boolean(row.featured_by_vendor),
    };
  });
  // count across ALL products, not just the filtered tab
  const { count: featuredUsed } = await client.from("products").select("id", { count: "exact", head: true })
    .eq("vendor_id", vendor.id).eq("featured_by_vendor", true);

  return data({
    lang, rows, status, supabaseUrl: process.env.SUPABASE_URL ?? "", underReview: vendor.status === "pending",
    featuredSlots: Number(slots ?? 0), featuredUsed: featuredUsed ?? 0,
  });
}

type ActionData = { ok: true } | { ok: false; error: string };

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data<ActionData>({ ok: false, error: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "vendor", request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const productId = String(form.get("productId") ?? "");

  if (intent === "clone") {
    const { error } = await client.rpc("fn_clone_product", { p_product_id: productId });
    if (error) return data<ActionData>({ ok: false, error: error.message }, { status: 400 });
    return { ok: true as const };
  }
  if (intent === "feature") {
    const { data: res, error } = await client.rpc("fn_vendor_set_featured", {
      p_product_id: productId, p_on: form.get("on") === "1",
    });
    if (error) return data<ActionData>({ ok: false, error: error.message }, { status: 400 });
    const r = res as { ok: boolean; reason?: string };
    return r.ok ? { ok: true as const } : data<ActionData>({ ok: false, error: r.reason ?? "rpc" }, { status: 400 });
  }
  if (intent === "archive") {
    const { error } = await client.rpc("fn_archive_product", { p_product_id: productId });
    if (error) return data<ActionData>({ ok: false, error: error.message }, { status: 400 });
    return { ok: true as const };
  }
  return data<ActionData>({ ok: false, error: "intent" }, { status: 400 });
}

const STATUS_FILTERS = ["", "draft", "pending", "approved", "rejected"] as const;

export default function VendorProducts({ loaderData }: Route.ComponentProps) {
  const listLoading = useListLoading();
  const { t } = useTranslation();
  const lang = loaderData.lang;
  const [, setSearchParams] = useSearchParams();
  const fetcher = useFetcher<ActionData>();
  const toast = useToast();
  const [confirmArchive, setConfirmArchive] = useState<ProductListRow | null>(null);
  const [lastHandled, setLastHandled] = useState<string | null>(null);

  /* one toast per completed action (no render-time side effects); the
     lastHandled guard makes the extra dep-triggered runs no-ops */
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    const stamp = fetcher.data.ok ? "ok" : fetcher.data.error;
    if (lastHandled === stamp) return;
    setLastHandled(stamp);
    if (fetcher.data.ok) toast.showToast("success", t("vendor.products.done"));
    else toast.showToast("error", fetcher.data.error === "no_featured_slots" ? t("vendor.products.noFeaturedSlots") : t("errors.generic"));
  }, [fetcher.state, fetcher.data, lastHandled, toast, t]);

  const status = loaderData.status;
  const [searchParams] = useSearchParams();
  const stockFilter = searchParams.get("stock") ?? "";
  const rows = useMemo(() => loaderData.rows.filter((row) =>
    stockFilter === "out" ? row.offers > 0 && row.stock === 0 : stockFilter === "low" ? row.stock > 0 && row.stock <= 5 : true,
  ), [loaderData.rows, stockFilter]);
  const all = loaderData.rows;
  const kpis = [
    { key: "live", label: t("vendor.products.kpi.live"), value: all.filter((r) => r.status === "approved").length, to: "?status=approved", tone: "text-success-strong" },
    { key: "pending", label: t("vendor.products.kpi.pending"), value: all.filter((r) => r.status === "pending").length, to: "?status=pending", tone: "text-warning-strong" },
    { key: "changes", label: t("vendor.products.kpi.changes"), value: all.filter((r) => r.status === "rejected" && !r.rejected_final).length, to: "?status=rejected", tone: "text-danger" },
    { key: "low", label: t("vendor.products.kpi.low"), value: all.filter((r) => r.stock > 0 && r.stock <= 5).length, to: "?stock=low", tone: "text-warning-strong" },
    { key: "out", label: t("vendor.products.kpi.out"), value: all.filter((r) => r.offers > 0 && r.stock === 0).length, to: "?stock=out", tone: "text-danger" },
    { key: "sold", label: t("vendor.products.kpi.sold"), value: all.reduce((sum, r) => sum + r.sold, 0), to: "", tone: "text-text" },
  ];
  const money = (p: number) => formatPiastres(p, lang === "en" ? "en" : "ar");
  const addButton = loaderData.underReview ? (
    <div className="flex flex-col items-end gap-1">
      <Button size="md" disabled aria-describedby="under-review-note">{t("vendor.products.new")}</Button>
      <p id="under-review-note" className="max-w-xs text-end text-xs font-bold text-warning-strong">{t("vendor.products.underReviewNote")}</p>
    </div>
  ) : (
    <Link to={`/${lang}/vendor/products/new`}>
      <Button size="md">{t("vendor.products.new")}</Button>
    </Link>
  );

  const tone = (s: ProductListRow["status"]) =>
    s === "approved" ? "success" : s === "pending" ? "warning" : s === "rejected" ? "danger" : "neutral";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-black text-text">{t("vendor.products.title")}</h1>
            <span className="rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-black text-action">
              {rows.length} {t("vendor.products.countLabel")}
            </span>
          </div>
          <p className="mt-1 text-xs text-text-muted">
            {t("vendor.products.subtitle")}
          </p>
        </div>
        {addButton}
      </div>

      {loaderData.underReview ? (
        <div role="status" className="flex items-start gap-2.5 rounded-lg border border-warning/50 bg-warning-soft p-3.5 text-sm font-bold text-text">
          <AlertIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-warning-strong" />
          {t("vendor.products.underReviewNote")}
        </div>
      ) : null}

      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {kpis.map((k) => (
          <li key={k.key}>
            {k.to ? (
              <Link to={k.to} className="flex h-full flex-col gap-0.5 rounded-lg border border-border bg-surface px-3.5 py-3 shadow-1 transition-colors hover:border-action/40">
                <span className={`num text-2xl font-black ${k.tone}`}>{k.value}</span>
                <span className="text-xs font-bold text-text-muted">{k.label}</span>
              </Link>
            ) : (
              <div className="flex h-full flex-col gap-0.5 rounded-lg border border-border bg-surface px-3.5 py-3 shadow-1">
                <span className={`num text-2xl font-black ${k.tone}`}>{k.value}</span>
                <span className="text-xs font-bold text-text-muted">{k.label}</span>
              </div>
            )}
          </li>
        ))}
      </ul>

      {loaderData.featuredSlots > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-featured/60 bg-surface px-4 py-3 text-sm shadow-1">
          <StarIcon className="size-4 text-featured" aria-hidden="true" />
          <span className="font-bold text-text">
            {t("vendor.products.featuredSlots", { used: loaderData.featuredUsed, total: loaderData.featuredSlots })}
          </span>
          <span className="text-xs text-text-muted">{t("vendor.products.featuredHint")}</span>
        </div>
      ) : null}

      {/* quick find: image + title dropdown, opens the product's editor */}
      <PanelProductSearch placeholder={t("panelSearch.vendorPlaceholder")} lang={lang}
        hrefFor={(id) => `/${lang}/vendor/products/${id}/edit`} className="max-w-xl" />

      <div className="flex flex-wrap gap-1.5 rounded-lg border border-border bg-surface p-2 shadow-1" role="tablist" aria-label={t("vendor.products.filter")}>
        {STATUS_FILTERS.map((filter) => (
          <button
            key={filter || "all"}
            type="button"
            role="tab"
            aria-selected={status === filter}
            onClick={() => setSearchParams(filter ? { status: filter } : {})}
            className={`cursor-pointer rounded-md border px-3.5 py-1.5 text-xs font-bold transition-all duration-150 ${
              status === filter
                ? "border-action bg-action text-on-action shadow-1"
                : "border-transparent bg-transparent text-text-muted hover:bg-surface-tint hover:text-text"
            }`}
          >
            {filter ? t(`vendorStates.status.${filter}`) : t("common.all")}
          </button>
        ))}
      </div>

      {listLoading ? <ListSkeleton /> : rows.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState
              title={t("vendor.products.emptyTitle")}
              body={t("vendor.products.emptyBody")}
              action={addButton}
            />
          </CardBody>
        </Card>
      ) : (
        <DataTable
          rows={rows}
          rowKey={(row) => row.id}
          searchPlaceholder={t("vendor.products.search")}
          emptyTitle={t("vendor.products.emptySearch")}
          emptyBody={t("vendor.products.emptySearchBody")}
          cardTitle={(row) => (lang === "ar" ? row.name_ar : row.name_en)}
          columns={[
            {
              key: "name",
              header: t("vendor.products.col.name"),
              text: (row) => (row.name_ar + " " + row.name_en),
              render: (row) => (
                <div className="flex items-center gap-2.5">
                  <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-tint text-text-faint">
                    {row.media_path ? (
                      <img
                        src={publicMediaUrl(loaderData.supabaseUrl, row.media_path)}
                        alt=""
                        width={40}
                        height={40}
                        loading="lazy"
                        draggable={false}
                        className="size-full object-cover"
                      />
                    ) : <PackageIcon aria-hidden="true" className="size-5" />}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-text">
                      {(lang === "ar" ? row.name_ar || row.name_en : row.name_en || row.name_ar) || t("vendor.products.untitled")}
                    </p>
                    {row.category ? <p className="truncate text-2xs text-text-muted">{row.category}</p> : null}
                    {row.status === "rejected" && row.rejection_reason ? (
                      <p className="line-clamp-2 text-2xs font-bold text-danger" title={row.rejection_reason}>
                        {row.rejected_final ? `${t("productReview.finalBadge")} — ` : ""}{row.rejection_reason}
                      </p>
                    ) : null}
                    {row.status === "approved" && row.review_note ? (
                      <p className="line-clamp-2 text-2xs font-bold text-warning-strong" title={row.review_note}>{t("productReview.notes")}: {row.review_note}</p>
                    ) : null}
                  </div>
                </div>
              ),
            },
            {
              key: "status",
              header: t("vendor.products.col.status"),
              render: (row) => <Badge tone={tone(row.status)}>{t(`vendorStates.status.${row.status}`)}</Badge>,
              text: (row) => row.status,
            },
            {
              key: "price",
              header: t("vendor.products.col.price"),
              text: (row) => String(row.price_now ?? ""),
              render: (row) => row.price_now == null ? <span className="text-xs text-text-faint">—</span> : (
                <div className="flex flex-col">
                  <span className="num text-sm font-extrabold text-text">{money(row.price_now)}</span>
                  {row.price_before ? (
                    <span className="num relative inline-block text-2xs leading-none text-text-faint before:pointer-events-none before:absolute before:inset-x-[-2px] before:top-1/2 before:h-[1.5px] before:-translate-y-1/2 before:rounded-full before:bg-current before:content-['']">
                      {money(row.price_before)}
                    </span>
                  ) : null}
                </div>
              ),
            },
            {
              key: "stock",
              header: t("vendor.products.col.stock"),
              text: (row) => String(row.stock),
              render: (row) => (
                <div className="flex flex-col items-start gap-0.5">
                  <span className={`num rounded-full px-2 py-0.5 text-xs font-black ${row.offers === 0 ? "bg-surface-tint text-text-faint" : row.stock === 0 ? "bg-danger-soft text-danger" : row.stock <= 5 ? "bg-warning-soft text-warning-strong" : "bg-success-soft text-success-strong"}`}>
                    {row.offers === 0 ? "—" : row.stock === 0 ? t("vendor.products.outOfStock") : row.stock}
                  </span>
                  {row.offers > 1 ? <span className="num text-2xs text-text-faint">{t("vendor.products.offers", { count: row.offers })}</span> : null}
                </div>
              ),
            },
            {
              key: "sales",
              header: t("vendor.products.col.sales"),
              text: (row) => String(row.sold),
              render: (row) => (
                <div className="flex flex-col">
                  <span className="num text-sm font-bold text-text">{row.sold}</span>
                  {row.revenue > 0 ? <span className="num text-2xs text-text-muted">{money(row.revenue)}</span> : null}
                </div>
              ),
            },
            {
              key: "rating",
              header: t("vendor.products.col.rating"),
              text: (row) => String(row.rating_avg ?? ""),
              render: (row) => row.rating_count > 0 ? (
                <span className="inline-flex items-center gap-1.5 text-sm font-bold text-text">
                  <Rating value={row.rating_avg ?? 0} size="sm" />
                  <span className="num">{row.rating_avg?.toFixed(1)}</span>
                  <span className="num text-2xs font-normal text-text-muted">({row.rating_count})</span>
                </span>
              ) : <span className="text-2xs text-text-faint">{t("vendor.products.noRatings")}</span>,
            },
            {
              key: "updated",
              header: t("vendor.products.col.updated"),
              text: (row) => row.updated_at,
              render: (row) => (
                <span className="num text-xs text-text-muted">
                  {new Date(row.updated_at).toLocaleDateString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB")}
                </span>
              ),
            },
            {
              key: "actions",
              header: t("vendor.products.col.actions"),
              text: () => "",
              render: (row) => (
                <div className="flex items-center gap-1">
                  {row.status === "approved" && (row.featured || loaderData.featuredSlots > 0) ? (
                    <fetcher.Form method="post">
                      <input type="hidden" name="intent" value="feature" />
                      <input type="hidden" name="productId" value={row.id} />
                      <input type="hidden" name="on" value={row.featured ? "0" : "1"} />
                      <button
                        type="submit"
                        aria-pressed={row.featured}
                        aria-label={row.featured ? t("vendor.products.unfeature") : t("vendor.products.feature")}
                        title={row.featured ? t("vendor.products.unfeature") : t("vendor.products.feature")}
                        className={`flex size-8 cursor-pointer items-center justify-center rounded-md transition-colors duration-150 hover:bg-surface-tint ${row.featured ? "text-featured" : "text-text-muted"}`}
                      >
                        <StarIcon aria-hidden="true" className={row.featured ? "fill-current" : ""} />
                      </button>
                    </fetcher.Form>
                  ) : null}
                  {row.status !== "rejected" || !row.rejected_final ? (
                    <Link
                      to={`/${lang}/vendor/products/${row.id}/edit`}
                      aria-label={t("common.edit")}
                      title={t("common.edit")}
                      className="flex size-8 cursor-pointer items-center justify-center rounded-md text-text transition-colors duration-150 hover:bg-surface-tint"
                    >
                      <PencilIcon aria-hidden="true" />
                    </Link>
                  ) : null}
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="clone" />
                    <input type="hidden" name="productId" value={row.id} />
                    <button
                      type="submit"
                      aria-label={t("vendor.products.clone")}
                      title={t("vendor.products.clone")}
                      className="flex size-8 cursor-pointer items-center justify-center rounded-md text-text transition-colors duration-150 hover:bg-surface-tint"
                    >
                      <CopyIcon aria-hidden="true" />
                    </button>
                  </fetcher.Form>
                  <button
                    type="button"
                    aria-label={t("vendor.products.archive")}
                    title={t("vendor.products.archive")}
                    onClick={() => setConfirmArchive(row)}
                    className="flex size-8 cursor-pointer items-center justify-center rounded-md text-danger transition-colors duration-150 hover:bg-danger-soft"
                  >
                    <TrashIcon aria-hidden="true" />
                  </button>
                </div>
              ),
            },
          ]}
        />
      )}

      <Dialog
        open={confirmArchive !== null}
        onClose={() => setConfirmArchive(null)}
        title={t("vendor.products.archiveConfirmTitle")}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text-muted">{t("vendor.products.archiveConfirmBody")}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmArchive(null)}>
              {t("common.cancel")}
            </Button>
            <fetcher.Form method="post" onSubmit={() => setConfirmArchive(null)}>
              <input type="hidden" name="intent" value="archive" />
              <input type="hidden" name="productId" value={confirmArchive?.id ?? ""} />
              <Button type="submit">{t("vendor.products.archive")}</Button>
            </fetcher.Form>
          </div>
        </div>
      </Dialog>
    </div>
  );
}


/** H-06: friendly route error page (500s log a CORERR id; 403/404 keep their message) */
export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonPage />;
}

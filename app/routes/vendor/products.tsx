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
import { requireLang } from "~/lib/lang.server";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { fetchVendorRow } from "~/features/vendor/api";
import { publicMediaUrl } from "~/lib/media.shared";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonPage } from "~/components/ui/Skeleton";


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
  updated_at: string;
  media_path: string | null;
  variant_count: number;
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
      `id, name_ar, name_en, status, rejection_reason, updated_at,
       product_media(path, position, kind),
       variants(count)`,
    )
    .eq("vendor_id", vendor.id)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(200);
  if (allowed.includes(status)) query = query.eq("status", status);

  const { data: products } = await query;
  const rows: ProductListRow[] = (products ?? []).map((row: Record<string, unknown>) => {
    const media = Array.isArray(row.product_media)
      ? (row.product_media as Array<{ path: string; kind: string }>)
      : [];
    const first = media.find((m) => m.kind === "image") ?? media[0];
    const variants = Array.isArray(row.variants) ? (row.variants as Array<{ count: number }>) : [];
    return {
      id: row.id as string,
      name_ar: row.name_ar as string,
      name_en: row.name_en as string,
      status: row.status as ProductListRow["status"],
      rejection_reason: (row.rejection_reason as string | null) ?? null,
      updated_at: row.updated_at as string,
      media_path: first?.path ?? null,
      variant_count: variants[0]?.count ?? 0,
    };
  });

  return data({ lang, rows, status, supabaseUrl: process.env.SUPABASE_URL ?? "" });
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
  if (intent === "archive") {
    const { error } = await client.rpc("fn_archive_product", { p_product_id: productId });
    if (error) return data<ActionData>({ ok: false, error: error.message }, { status: 400 });
    return { ok: true as const };
  }
  return data<ActionData>({ ok: false, error: "intent" }, { status: 400 });
}

const STATUS_FILTERS = ["", "draft", "pending", "approved", "rejected"] as const;

export default function VendorProducts({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const lang = loaderData.lang;
  const [, setSearchParams] = useSearchParams();
  const fetcher = useFetcher<ActionData>();
  const toast = useToast();
  const [confirmArchive, setConfirmArchive] = useState<ProductListRow | null>(null);
  const [lastHandled, setLastHandled] = useState<string | null>(null);

  /* one toast per completed action (no render-time side effects) */
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    const stamp = fetcher.data.ok ? "ok" : fetcher.data.error;
    if (lastHandled === stamp) return;
    setLastHandled(stamp);
    if (fetcher.data.ok) toast.showToast("success", t("vendor.products.done"));
    else toast.showToast("error", t("errors.generic"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  const status = loaderData.status;
  const rows = useMemo(() => loaderData.rows, [loaderData.rows]);

  const tone = (s: ProductListRow["status"]) =>
    s === "approved" ? "success" : s === "pending" ? "warning" : s === "rejected" ? "danger" : "neutral";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-black text-text">{t("vendor.products.title")}</h1>
            <span className="rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-black text-action">
              {rows.length} {lang === "ar" ? "منتج" : "items"}
            </span>
          </div>
          <p className="mt-1 text-xs text-text-muted">
            {lang === "ar"
              ? "إدارة منتجات متجرك، تحديث المخزون والأسعار، وإضافة أصناف جديدة للكتالوج."
              : "Manage store listings, update inventory and prices, and publish new items."}
          </p>
        </div>
        <Link to={`/${lang}/vendor/products/new`}>
          <Button size="md">{t("vendor.products.new")}</Button>
        </Link>
      </div>

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
                ? "border-action bg-action text-on-action shadow-sm"
                : "border-transparent bg-transparent text-text-muted hover:bg-surface-tint hover:text-text"
            }`}
          >
            {filter ? t(`vendorStates.status.${filter}`) : t("common.all")}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState
              title={t("vendor.products.emptyTitle")}
              body={t("vendor.products.emptyBody")}
              action={
                <Link to={`/${lang}/vendor/products/new`}>
                  <Button>{t("vendor.products.new")}</Button>
                </Link>
              }
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
                  <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-tint">
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
                    ) : null}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-text">
                      {lang === "ar" ? row.name_ar : row.name_en}
                    </p>
                    {row.status === "rejected" && row.rejection_reason ? (
                      <p className="truncate text-2xs font-bold text-danger">{row.rejection_reason}</p>
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
              key: "variants",
              header: t("vendor.products.col.variants"),
              render: (row) => <span className="num text-sm text-text">{row.variant_count}</span>,
              text: (row) => String(row.variant_count),
            },
            {
              key: "updated",
              header: t("vendor.products.col.updated"),
              text: (row) => row.updated_at,
              render: (row) => (
                <span className="num text-xs text-text-muted">
                  {new Date(row.updated_at).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB")}
                </span>
              ),
            },
            {
              key: "actions",
              header: t("vendor.products.col.actions"),
              text: () => "",
              render: (row) => (
                <div className="flex items-center gap-1">
                  {row.status === "draft" || row.status === "rejected" ? (
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

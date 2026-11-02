import { useEffect, useRef, useState } from "react";
import type { Route } from "./+types/products";
import { data, useFetcher, useSearchParams } from "react-router";
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
} from "~/components/ui";
import { requireLang } from "~/lib/lang.server";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { publicMediaUrl } from "~/lib/media.shared";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonTable } from "~/components/ui/Skeleton";


/**
 * Admin product approvals (V-19 / US-11): queue with status filters, a
 * storefront-style preview, approve / reject with a MANDATORY reason
 * (enforced by fn_admin_review_product) + vendor notification.
 */

interface QueueRow {
  id: string;
  name_ar: string;
  name_en: string;
  status: "draft" | "pending" | "approved" | "rejected";
  rejection_reason: string | null;
  submitted_at: string | null;
  vendor_name_ar: string;
  vendor_name_en: string;
  media_path: string | null;
  variant_count: number;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) {
    throw Response.redirect(new URL(`/${lang}/auth/login?error=db`, request.url).toString(), 302);
  }
  await requirePanelAccess(client, lang, "admin", request);

  const status = new URL(request.url).searchParams.get("status") ?? "pending";
  let query = client
    .from("products")
    .select(
      `id, name_ar, name_en, status, rejection_reason, submitted_at, vendor_id,
       vendors(store_name_ar, store_name_en),
       product_media(path, kind, position),
       variants(count)`,
    )
    .is("deleted_at", null)
    .order("submitted_at", { ascending: true, nullsFirst: false })
    .limit(200);
  if (["draft", "pending", "approved", "rejected"].includes(status)) query = query.eq("status", status);

  const { data: rows } = await query;
  const queue: QueueRow[] = (rows ?? []).map((row: Record<string, unknown>) => {
    const vendor = (row.vendors ?? {}) as { store_name_ar?: string; store_name_en?: string };
    const media = Array.isArray(row.product_media) ? (row.product_media as Array<{ path: string; kind: string }>) : [];
    const first = media.find((m) => m.kind === "image") ?? media[0];
    const variants = Array.isArray(row.variants) ? (row.variants as Array<{ count: number }>) : [];
    return {
      id: row.id as string,
      name_ar: row.name_ar as string,
      name_en: row.name_en as string,
      status: row.status as QueueRow["status"],
      rejection_reason: (row.rejection_reason as string | null) ?? null,
      submitted_at: (row.submitted_at as string | null) ?? null,
      vendor_name_ar: vendor.store_name_ar ?? "",
      vendor_name_en: vendor.store_name_en ?? "",
      media_path: first?.path ?? null,
      variant_count: variants[0]?.count ?? 0,
    };
  });

  return data({ lang, queue, status, supabaseUrl: process.env.SUPABASE_URL ?? "" });
}

type ActionData = { ok: boolean; error?: string };

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data<ActionData>({ ok: false, error: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const form = await request.formData();
  const productId = String(form.get("productId") ?? "");
  const intent = String(form.get("intent") ?? "review");
  const reason = String(form.get("reason") ?? "").trim();

  // A-09/A-10 — clone (fn_clone_product) + soft-archive (audited)
  if (intent === "clone") {
    const res = await client.rpc("fn_clone_product", { p_product_id: productId });
    if (res.error) return data<ActionData>({ ok: false, error: res.error.message }, { status: 400 });
    const r = res.data as { ok: boolean; reason?: string };
    return r?.ok ? { ok: true } : data<ActionData>({ ok: false, error: r?.reason ?? "rpc" }, { status: 400 });
  }
  if (intent === "archive") {
    if (reason.length < 3) return data<ActionData>({ ok: false, error: "reason_required" }, { status: 400 });
    const res = await client.rpc("fn_admin_archive_product", { p_product_id: productId, p_reason: reason });
    if (res.error) return data<ActionData>({ ok: false, error: res.error.message }, { status: 400 });
    const r = res.data as { ok: boolean; reason?: string };
    return r?.ok ? { ok: true } : data<ActionData>({ ok: false, error: r?.reason ?? "rpc" }, { status: 400 });
  }

  const decision = String(form.get("decision") ?? "");
  if (!productId || !["approve", "reject"].includes(decision)) {
    return data<ActionData>({ ok: false, error: "input" }, { status: 400 });
  }
  const { error } = await client.rpc("fn_admin_review_product", {
    p_product_id: productId,
    p_decision: decision,
    p_reason: reason,
  });
  if (error) return data<ActionData>({ ok: false, error: error.message }, { status: 400 });
  return { ok: true };
}

const FILTERS = ["pending", "approved", "rejected", "draft", ""] as const;

export default function AdminProducts({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const lang = loaderData.lang;
  const isAr = lang === "ar";
  const [, setSearchParams] = useSearchParams();
  const fetcher = useFetcher<ActionData>();
  const toast = useToast();
  const [reviewTarget, setReviewTarget] = useState<QueueRow | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<QueueRow | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState(false);
  const lastToast = useRef<string | null>(null);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    const stamp = fetcher.data.ok ? "ok" : (fetcher.data.error ?? "err");
    if (lastToast.current === stamp) return;
    lastToast.current = stamp;
    if (fetcher.data.ok) {
      toast.showToast("success", t("adminProducts.reviewed"));
      setReviewTarget(null);
      setReason("");
    } else {
      toast.showToast("error", t("errors.generic"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  const tone = (s: QueueRow["status"]) =>
    s === "approved" ? "success" : s === "pending" ? "warning" : s === "rejected" ? "danger" : "neutral";

  function submitReview(decision: "approve" | "reject") {
    if (decision === "reject" && reason.trim() === "") {
      setReasonError(true);
      return;
    }
    setReasonError(false);
    fetcher.submit(
      { intent: "review", productId: reviewTarget?.id ?? "", decision, reason },
      { method: "post" },
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-black text-text">{t("adminProducts.title")}</h1>
            <span className="rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-black text-action">
              {loaderData.queue.length}
            </span>
          </div>
          <p className="mt-1 text-xs text-text-muted">
            {isAr
              ? "مراجعة المنتجات المرفوعة من التجار، اعتماد الجودة، والتحقق من الأسعار والمواصفات."
              : "Review vendor catalog submissions, verify pricing and details, and approve for marketplace storefront."}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 rounded-l border border-border bg-surface p-2 shadow-1" role="tablist" aria-label={t("adminProducts.filter")}>
        {FILTERS.map((filter) => (
          <button
            key={filter || "all"}
            type="button"
            role="tab"
            aria-selected={loaderData.status === filter}
            onClick={() => setSearchParams(filter ? { status: filter } : {})}
            className={`cursor-pointer rounded-m border px-3.5 py-1.5 text-xs font-bold transition-all duration-150 ${
              loaderData.status === filter
                ? "border-action bg-action text-on-action shadow-sm"
                : "border-transparent bg-transparent text-text-muted hover:bg-surface-tint hover:text-text"
            }`}
          >
            {filter ? t(`vendorStates.status.${filter}`) : t("common.all")}
          </button>
        ))}
      </div>

      {loaderData.queue.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState title={t("adminProducts.emptyTitle")} body={t("adminProducts.emptyBody")} />
          </CardBody>
        </Card>
      ) : (
        <DataTable
          rows={loaderData.queue}
          rowKey={(row) => row.id}
          searchPlaceholder={t("adminProducts.search")}
          emptyTitle={t("adminProducts.emptySearch")}
          emptyBody={t("adminProducts.emptySearchBody")}
          cardTitle={(row) => (isAr ? row.name_ar : row.name_en)}
          columns={[
            {
              key: "name",
              header: t("adminProducts.col.product"),
              text: (row) => `${row.name_ar} ${row.name_en} ${row.vendor_name_ar}`,
              render: (row) => (
                <div className="flex items-center gap-2.5">
                  <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-m border border-border bg-surface-tint">
                    {row.media_path ? (
                      <img src={publicMediaUrl(loaderData.supabaseUrl, row.media_path)} alt="" width={40} height={40} loading="lazy" draggable={false} className="size-full object-cover" />
                    ) : null}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-bold text-text">{isAr ? row.name_ar : row.name_en}</p>
                    <p className="truncate text-[11px] text-text-muted">{isAr ? row.vendor_name_ar : row.vendor_name_en}</p>
                  </div>
                </div>
              ),
            },
            {
              key: "status",
              header: t("adminProducts.col.status"),
              text: (row) => row.status,
              render: (row) => <Badge tone={tone(row.status)}>{t(`vendorStates.status.${row.status}`)}</Badge>,
            },
            {
              key: "variants",
              header: t("adminProducts.col.variants"),
              text: (row) => String(row.variant_count),
              render: (row) => <span className="num text-[13px] text-text">{row.variant_count}</span>,
            },
            {
              key: "actions",
              header: t("adminProducts.col.actions"),
              text: () => "",
              render: (row) => (
                <div className="flex flex-wrap items-center gap-1.5">
                  {row.status === "pending" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setReviewTarget(row);
                        setReason("");
                        setReasonError(false);
                      }}
                    >
                      {t("adminProducts.review")}
                    </Button>
                  ) : (
                    <>
                      {/* A-09 — clone / archive (A-10, soft delete with confirm) */}
                      <fetcher.Form method="post">
                        <input type="hidden" name="intent" value="clone" />
                        <input type="hidden" name="productId" value={row.id} />
                        <Button type="submit" size="sm" variant="ghost">{t("adminProducts.clone")}</Button>
                      </fetcher.Form>
                      {row.status !== "draft" ? (
                        <Button type="button" size="sm" variant="ghost"
                          onClick={() => { setArchiveTarget(row); setReason(""); }}>
                          {t("adminProducts.archive")}
                        </Button>
                      ) : null}
                    </>
                  )}
                </div>
              ),
            },
          ]}
        />
      )}

      <Dialog open={reviewTarget !== null} onClose={() => setReviewTarget(null)} title={t("adminProducts.reviewTitle")}>
        {reviewTarget ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-m border border-border bg-surface-tint">
                {reviewTarget.media_path ? (
                  <img src={publicMediaUrl(loaderData.supabaseUrl, reviewTarget.media_path)} alt="" width={56} height={56} draggable={false} className="size-full object-cover" />
                ) : null}
              </div>
              <div className="min-w-0">
                <p className="truncate text-[13px] font-extrabold text-text">{isAr ? reviewTarget.name_ar : reviewTarget.name_en}</p>
                <p className="truncate text-[12px] text-text-muted">{isAr ? reviewTarget.vendor_name_ar : reviewTarget.vendor_name_en}</p>
              </div>
            </div>
            <p className="text-[13px] text-text-muted">
              {t("adminProducts.reviewNote")}
            </p>
            <label className="flex flex-col gap-1.5 text-[13px] font-bold text-text">
              {t("adminProducts.reason")} <span className="font-normal text-text-faint">{t("adminProducts.reasonHint")}</span>
              <textarea
                className={`min-h-20 rounded-m border bg-surface p-2.5 text-sm text-text outline-none focus:shadow-focus ${
                  reasonError ? "border-danger" : "border-border"
                }`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                aria-invalid={reasonError || undefined}
              />
            </label>
            {reasonError ? (
              <p role="alert" className="text-xs font-bold text-danger">{t("adminProducts.reasonRequired")}</p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setReviewTarget(null)}>
                {t("common.cancel")}
              </Button>
              <Button variant="outline" onClick={() => submitReview("reject")}>
                {t("adminProducts.reject")}
              </Button>
              <Button onClick={() => submitReview("approve")}>{t("adminProducts.approve")}</Button>
            </div>
          </div>
        ) : null}
      </Dialog>

      {/* A-10 — archive (soft delete + audit) */}
      <Dialog open={archiveTarget !== null} onClose={() => setArchiveTarget(null)} title={t("adminProducts.archiveTitle")}>
        {archiveTarget ? (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] text-text">{t("adminProducts.archiveNote")}</p>
            <label className="flex flex-col gap-1.5 text-[13px] font-bold text-text">
              {t("adminProducts.reason")}
              <textarea className="min-h-16 rounded-m border border-border bg-surface p-2.5 text-sm text-text outline-none focus:shadow-focus"
                value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setArchiveTarget(null)}>{t("common.cancel")}</Button>
              <Button disabled={reason.trim().length < 3 || fetcher.state !== "idle"}
                onClick={() => fetcher.submit({ intent: "archive", productId: archiveTarget.id, reason }, { method: "post" })}>
                {t("adminProducts.archiveConfirm")}
              </Button>
            </div>
          </div>
        ) : null}
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
  return <SkeletonTable />;
}

import { data, useFetcher } from "react-router";
import type { Route } from "./+types/reviews";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { Button } from "~/components/ui/Button";
import { Badge } from "~/components/ui/Badge";
import { Rating } from "~/components/ui/Rating";
import { EmptyState } from "~/components/ui/EmptyState";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonTable } from "~/components/ui/Skeleton";


/**
 * A-13 — Reviews moderation (US-08): tabs All/Pending/Published/Spam/Trash →
 * publish/reject(spam/trash) with reason; product rating recalculated by the
 * rating trigger after each moderation (same predicate the storefront uses).
 */

interface ReviewRow {
  id: string; rating: number; title: string; body: string; status: string;
  created_at: string;
  product: string; vendor: string; customer: string;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const status = new URL(request.url).searchParams.get("status") ?? "pending";
  // H-04/H-06 root cause: the previous single query embedded products +
  // vendors + profiles. reviews → profiles has NO FK (customer_id points at
  // auth.users) so PostgREST rejected the ENTIRE request (PGRST200 → 500), and
  // the vendors embed is RLS-scoped which can fail role-dependent. Fix: fetch
  // the review rows plain, then resolve the three label maps separately and
  // never fail the page on a label lookup.
  let q = client
    .from("reviews")
    .select("id, rating, title, body, status, created_at, product_id, vendor_id, customer_id")
    .order("created_at", { ascending: false })
    .limit(100);
  if (["pending", "published", "spam", "trash"].includes(status)) q = q.eq("status", status);
  const { data: rows, error } = await q;
  if (error) throw new Error(error.message);
  const reviewRows = (rows ?? []) as unknown as Array<{
    id: string; rating: number; title: string; body: string; status: string; created_at: string;
    product_id: string; vendor_id: string; customer_id: string;
  }>;
  const productIds = [...new Set(reviewRows.map((r) => r.product_id))];
  const vendorIds = [...new Set(reviewRows.map((r) => r.vendor_id))];
  const customerIds = [...new Set(reviewRows.map((r) => r.customer_id))];
  const [productRows, vendorRows, profileRows] = await Promise.all([
    productIds.length ? client.from("products").select("id, name_ar, name_en").in("id", productIds) : Promise.resolve({ data: [] as unknown[] }),
    vendorIds.length ? client.from("vendors").select("id, store_name_ar, store_name_en").in("id", vendorIds).limit(vendorIds.length) : Promise.resolve({ data: [] as unknown[] }),
    customerIds.length ? client.from("profiles").select("id, full_name").in("id", customerIds) : Promise.resolve({ data: [] as unknown[] }),
  ]);
  const productName = new Map(((productRows.data ?? []) as Array<{ id: string; name_ar: string; name_en: string }>).map((p) => [p.id, p.name_ar || p.name_en]));
  const vendorName = new Map(((vendorRows.data ?? []) as Array<{ id: string; store_name_ar: string; store_name_en: string }>).map((v) => [v.id, v.store_name_ar || v.store_name_en]));
  const customerName = new Map(((profileRows.data ?? []) as Array<{ id: string; full_name: string }>).map((p) => [p.id, p.full_name]));
  const reviews: ReviewRow[] = reviewRows.map((r) => ({
    id: r.id,
    rating: Number(r.rating),
    title: r.title ?? "",
    body: r.body ?? "",
    status: r.status,
    created_at: r.created_at,
    product: productName.get(r.product_id) ?? "—",
    vendor: vendorName.get(r.vendor_id) ?? "—",
    customer: customerName.get(r.customer_id) ?? "—",
  }));
  return { lang, status, reviews: JSON.parse(JSON.stringify(reviews)) };
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const form = await request.formData();
  const id = String(form.get("id") ?? "");
  const decision = String(form.get("decision") ?? "");
  if (!["published", "spam", "trash"].includes(decision)) {
    return data({ ok: false, reason: "bad_decision" }, { status: 400 });
  }
  const reason = String(form.get("reason") ?? "").trim();
  if (decision !== "published" && reason.length < 3) {
    return data({ ok: false, reason: "reason_required" }, { status: 400 });
  }
  const { error } = await client.from("reviews").update({ status: decision }).eq("id", id);
  if (error) return data({ ok: false, reason: error.message }, { status: 400 });
  await client.rpc("fn_audit", {
    p_action: "review.moderated", p_entity: "reviews", p_entity_id: id, p_before: null, p_after: { decision },
  });
  return { ok: true as const };
}

const TABS = ["pending", "published", "spam", "trash", ""] as const;

export default function AdminReviews({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const fetcher = useFetcher<typeof action>();
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const lang = loaderData.lang;

  return (
    <div>
      <h1 className="text-lg font-extrabold text-text">{t("rv.title")}</h1>
      <nav className="mt-3 flex flex-wrap gap-2" aria-label={t("rv.title")}>
        {TABS.map((s) => (
          <a key={s || "all"} href={`/${lang}/admin/reviews?status=${s}`}
            aria-current={loaderData.status === s ? "page" : undefined}
            className={`rounded-m border px-3 py-1.5 text-[13px] font-bold ${
              loaderData.status === s ? "border-primary bg-primary-soft text-primary" : "border-border text-text-muted hover:bg-surface-tint"
            }`}>
            {s ? t(`rv.tab_${s}`) : t("common.all")}
          </a>
        ))}
      </nav>

      {loaderData.reviews.length === 0 ? (
        <div className="mt-4"><EmptyState title={t("rv.empty")} body={t("rv.emptyHint")} /></div>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {(loaderData.reviews as ReviewRow[]).map((r) => (
            <li key={r.id} className="rounded-m border border-border bg-surface p-4 text-[13px]">
              <div className="flex flex-wrap items-center gap-2">
                <Rating value={r.rating} size="sm" />
                <span className="font-bold text-text">{r.title || t("rv.noTitle")}</span>
                <Badge tone={r.status === "published" ? "success" : r.status === "pending" ? "warning" : "neutral"}>
                  {t(`rv.tab_${r.status}`)}
                </Badge>
                <span className="text-xs text-text-muted" dir="ltr">{r.created_at.slice(0, 10)}</span>
              </div>
              <p className="mt-1 text-text-muted">{r.body}</p>
              <p className="mt-1 text-xs text-text-faint">
                {r.customer} · {r.product} · {r.vendor}
              </p>
              {r.status !== "trash" ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {r.status !== "published" ? (
                    <fetcher.Form method="post">
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="decision" value="published" />
                      <Button type="submit" size="sm" disabled={fetcher.state !== "idle"}>{t("rv.publish")}</Button>
                    </fetcher.Form>
                  ) : null}
                  <button type="button"
                    onClick={() => { setReasonFor(r.id); setReason(""); }}
                    className="cursor-pointer rounded-m border border-border px-3 py-1.5 text-[13px] font-bold text-text hover:bg-surface-tint">
                    {t("rv.reject")}
                  </button>
                </div>
              ) : null}
              {reasonFor === r.id ? (
                <fetcher.Form method="post" onSubmit={(e) => { if (reason.trim().length < 3) e.preventDefault(); }}
                  className="mt-2 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="reason" value={reason} />
                  <select name="decision" defaultValue="spam" className="rounded-m border border-border bg-surface px-2 py-1.5 text-[13px]">
                    <option value="spam">{t("rv.tab_spam")}</option>
                    <option value="trash">{t("rv.tab_trash")}</option>
                  </select>
                  <input value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3}
                    placeholder={t("rv.reasonPlaceholder")}
                    className="w-56 rounded-m border border-border bg-surface px-2.5 py-2 text-[13px]" />
                  <Button type="submit" size="sm" variant="outline" disabled={fetcher.state !== "idle"}>{t("rv.confirm")}</Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setReasonFor(null)}>{t("common.cancel")}</Button>
                </fetcher.Form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
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

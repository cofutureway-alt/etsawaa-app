import { data } from "react-router";
import type { Route } from "./+types/reviews";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { Rating } from "~/components/ui/Rating";
import { Badge } from "~/components/ui/Badge";
import { EmptyState } from "~/components/ui/EmptyState";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonTable } from "~/components/ui/Skeleton";

/**
 * Vendor reviews (ARCHITECTURE §7 lists /vendor/reviews; the route was missing).
 * Read-only: moderation is admin-only (A-13), so a vendor sees what customers
 * published about their store and nothing more. RLS: reviews_vendor_read.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "vendor", request);

  const { data: ownVendor } = await client.rpc("own_vendor_id");
  const vendorId = (ownVendor as string | null) ?? null;
  if (!vendorId) return { lang, rows: [], avg: null as number | null, count: 0 };

  const { data: rows, error } = await client
    .from("reviews")
    .select("id, rating, title, body, status, created_at, product_id")
    .eq("vendor_id", vendorId)
    .in("status", ["published", "pending"])
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);

  const list = (rows ?? []) as Array<Record<string, unknown>>;
  const productIds = [...new Set(list.map((r) => r.product_id as string))];
  const names = new Map<string, string>();
  if (productIds.length > 0) {
    const { data: prods } = await client.from("products").select("id, name_ar, name_en").in("id", productIds);
    for (const p of (prods ?? []) as Array<{ id: string; name_ar: string; name_en: string }>) {
      names.set(p.id, lang === "ar" ? p.name_ar || p.name_en : p.name_en || p.name_ar);
    }
  }

  const published = list.filter((r) => r.status === "published");
  const avg = published.length
    ? published.reduce((s, r) => s + Number(r.rating ?? 0), 0) / published.length
    : null;

  return {
    lang,
    rows: JSON.parse(JSON.stringify(list)),
    productNames: Object.fromEntries(names),
    avg,
    count: published.length,
  };
}

export default function VendorReviews({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const rows = loaderData.rows as Array<{
    id: string; rating: number; title: string | null; body: string | null;
    status: string; created_at: string; product_id: string;
  }>;
  const names = loaderData.productNames as Record<string, string>;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-extrabold text-text">{t("vr.title")}</h1>
        {loaderData.avg !== null ? (
          <span className="flex items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1">
            <Rating value={loaderData.avg} size="sm" />
            <span className="num text-sm font-black text-text" dir="ltr">
              {loaderData.avg.toFixed(1)}
            </span>
            <span className="text-xs text-text-muted">({loaderData.count})</span>
          </span>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <div className="mt-6">
          <EmptyState title={t("vr.empty")} body={t("vr.emptyHint")} />
        </div>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.id} className="rounded-md border border-border bg-surface p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <Rating value={Number(r.rating)} size="sm" />
                  <span className="text-sm font-extrabold text-text">
                    {names[r.product_id] ?? "—"}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  {r.status === "pending" ? <Badge tone="warning">{t("vr.pending")}</Badge> : null}
                  <span className="num text-xs text-text-muted">
                    {new Date(r.created_at).toLocaleDateString(en ? "en-EG" : "ar-EG")}
                  </span>
                </span>
              </div>
              {r.title ? <p className="mt-1.5 text-sm font-bold text-text">{r.title}</p> : null}
              {r.body ? <p className="mt-0.5 text-sm leading-relaxed text-text-muted">{r.body}</p> : null}
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

/** H-24: stable skeleton while the loader streams. */
export function HydrateFallback() {
  return <SkeletonTable />;
}

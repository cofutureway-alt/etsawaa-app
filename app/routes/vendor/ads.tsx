import { data } from "react-router";
import type { Route } from "./+types/ads";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { formatPiastres } from "~/lib/money";
import { Badge } from "~/components/ui/Badge";
import { EmptyState } from "~/components/ui/EmptyState";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonTable } from "~/components/ui/Skeleton";

/**
 * Vendor ad campaigns (ARCHITECTURE §7 lists /vendor/ads; the route was
 * missing). Read-only view of what the vendor currently has: purchased
 * campaigns and admin grants. Purchase/grants stay admin-side (A-20) — a
 * vendor never writes ad_campaigns directly.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "vendor", request);

  const { data: ownVendor } = await client.rpc("own_vendor_id");
  const vendorId = (ownVendor as string | null) ?? null;
  if (!vendorId) return { lang, rows: [], packages: [] };

  const [campaigns, packages] = await Promise.all([
    client
      .from("ad_campaigns")
      .select("id, status, source, starts_at, ends_at, impressions, clicks, product_id, package_id")
      .eq("vendor_id", vendorId)
      .order("created_at", { ascending: false })
      .limit(100),
    // Packages visible to vendors with their slots/pricing — informational.
    client
      .from("ad_packages")
      .select("id, name_ar, name_en, placement, duration_days, price_piastres, discount_percent, slots, is_active, visibility")
      .eq("is_active", true)
      .order("price_piastres"),
  ]);
  if (campaigns.error) throw new Error(campaigns.error.message);

  const rows = (campaigns.data ?? []) as Array<Record<string, unknown>>;
  const productIds = [...new Set(rows.map((r) => r.product_id as string).filter(Boolean))];
  const names = new Map<string, string>();
  if (productIds.length > 0) {
    const { data: prods } = await client.from("products").select("id, name_ar, name_en").in("id", productIds);
    for (const p of (prods ?? []) as Array<{ id: string; name_ar: string; name_en: string }>) {
      names.set(p.id, lang === "ar" ? p.name_ar || p.name_en : p.name_en || p.name_ar);
    }
  }

  // Only vendor-visible packages are advertised here.
  const visible = ((packages.data ?? []) as Array<{ visibility: string }>)
    .filter((p) => p.visibility === "vendors" || p.visibility === "both");

  return {
    lang,
    rows: JSON.parse(JSON.stringify(rows)),
    productNames: Object.fromEntries(names),
    packages: JSON.parse(JSON.stringify(visible)),
  };
}

export default function VendorAds({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const rows = loaderData.rows as Array<{
    id: string; status: string; source: string;
    starts_at: string | null; ends_at: string | null;
    impressions: number; clicks: number; product_id: string | null;
  }>;
  const pkgs = loaderData.packages as Array<{
    id: string; name_ar: string; name_en: string; placement: string;
    duration_days: number; price_piastres: number; discount_percent: number; slots: number;
  }>;
  const names = loaderData.productNames as Record<string, string>;

  return (
    <div>
      <h1 className="text-lg font-extrabold text-text">{t("va.title")}</h1>
      <p className="mt-1 text-xs text-text-muted">{t("va.hint")}</p>

      {rows.length === 0 ? (
        <div className="mt-6">
          <EmptyState title={t("va.empty")} body={t("va.emptyHint")} />
        </div>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {rows.map((c) => {
            const ctr = c.impressions > 0 ? ((c.clicks / c.impressions) * 100).toFixed(1) : "—";
            return (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface p-3 text-sm">
                <span className="font-extrabold text-text">
                  {c.product_id ? names[c.product_id] ?? "—" : t("va.storeWide")}
                </span>
                <Badge tone={c.source === "admin_grant" ? "info" : "neutral"}>
                  {c.source === "admin_grant" ? t("va.granted") : t("va.paid")}
                </Badge>
                <Badge tone={c.status === "active" ? "success" : c.status === "expired" ? "neutral" : "warning"}>
                  {t(`va.status_${c.status}`)}
                </Badge>
                <span className="num text-xs text-text-muted" dir="ltr">
                  {c.impressions} · {c.clicks} · {ctr}%
                </span>
                <span className="num text-xs text-text-muted" dir="ltr">
                  {c.ends_at ? new Date(c.ends_at).toLocaleDateString(en ? "en-EG" : "ar-EG") : "—"}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {pkgs.length > 0 ? (
        <section className="mt-8">
          <h2 className="text-sm font-extrabold text-text">{t("va.packages")}</h2>
          <p className="mt-1 text-xs text-text-muted">{t("va.packagesHint")}</p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {pkgs.map((p) => (
              <li key={p.id} className="rounded-md border border-border bg-surface p-3">
                <p className="text-sm font-extrabold text-text">{en ? p.name_en || p.name_ar : p.name_ar || p.name_en}</p>
                <p className="text-xs text-text-muted">{t(`ad.placement_${p.placement}`)}</p>
                <p className="num mt-1 text-sm font-black text-action" dir="ltr">
                  {formatPiastres(p.price_piastres, en ? "en" : "ar")}
                </p>
                <p className="mt-0.5 text-xs text-text-muted">
                  {t("va.pkgMeta", { days: p.duration_days, slots: p.slots })}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
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

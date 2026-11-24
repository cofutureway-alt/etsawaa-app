import type { Route } from "./+types/dashboard";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState } from "~/components/ui";
import { requireLang } from "~/lib/lang.server";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { fetchVendorRow } from "~/features/vendor/api";
import { PackageIcon, PlusIcon, StoreIcon, UploadIcon } from "~/components/ui/icons";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonPage } from "~/components/ui/Skeleton";
import { SellerAchievements, type MyAchievements } from "~/components/achievements/SellerAchievements";
import { DashboardInsights, LiveEventNotice, type DashboardCards, type LiveEvent } from "~/features/vendor/components/DashboardInsights";
import { VendorAnalytics, type VendorAnalyticsData } from "~/features/vendor/components/VendorAnalytics";


/**
 * Vendor dashboard (V-09/V-10): one banner per state comes from the vendor
 * layout; this page shows real counts (products by status) + quick actions.
 * No mock numbers — every card is a live DB count.
 */
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

  const days = [7, 30, 90].includes(Number(new URL(request.url).searchParams.get("days"))) ? Number(new URL(request.url).searchParams.get("days")) : 30;
  const [{ data: statusRows }, { data: achievements }, { data: cards }, { data: events }, { data: analytics }] = await Promise.all([
    client.from("products").select("status").eq("vendor_id", vendor.id).is("deleted_at", null),
    // level, progress to the next level, badges and active level rewards
    client.rpc("fn_my_achievements"),
    // categories + commission, child-level low stock, best sellers, unsold ≥10 days
    client.rpc("fn_vendor_dashboard_cards", { p_low_stock: 5, p_unsold_days: 10 }),
    client.rpc("fn_vendor_event_overview"),
    client.rpc("fn_vendor_analytics", { p_days: days }),
  ]);

  const counts = { draft: 0, pending: 0, approved: 0, rejected: 0 };
  for (const row of statusRows ?? []) {
    if (row.status in counts) counts[row.status as keyof typeof counts] += 1;
  }

  const ach = achievements as MyAchievements | null;
  const insights = cards as DashboardCards | null;
  const liveEvent = ((events ?? []) as Array<LiveEvent & { phase: string }>).find((e) => e.phase === "live") ?? null;
  return {
    lang, vendor, counts, total: (statusRows ?? []).length, achievements: ach?.ok ? ach : null,
    insights: insights?.ok ? insights : null, liveEvent, supabaseUrl: process.env.SUPABASE_URL ?? "",
    analytics: (analytics as VendorAnalyticsData | null)?.ok ? (analytics as VendorAnalyticsData) : null,
  };
}

export default function VendorDashboard({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { lang, vendor, counts, total } = loaderData;
  const isAr = lang === "ar";
  const storeName = isAr ? vendor.store_name_ar : vendor.store_name_en;

  const statusBadge = {
    draft: { tone: "neutral" as const, key: "vendorStates.status.draft" },
    pending: { tone: "warning" as const, key: "vendorStates.status.pending" },
    active: { tone: "success" as const, key: "vendorStates.status.active" },
    rejected: { tone: "danger" as const, key: "vendorStates.status.rejected" },
    suspended: { tone: "danger" as const, key: "vendorStates.status.suspended" },
  }[vendor.status];

  const cards = [
    {
      to: `/${lang}/vendor/products?status=draft`,
      label: t("vendor.dash.drafts"),
      value: counts.draft,
      tone: "neutral" as const,
    },
    {
      to: `/${lang}/vendor/products?status=pending`,
      label: t("vendor.dash.inReview"),
      value: counts.pending,
      tone: "warning" as const,
    },
    {
      to: `/${lang}/vendor/products?status=approved`,
      label: t("vendor.dash.published"),
      value: counts.approved,
      tone: "success" as const,
    },
    {
      to: `/${lang}/vendor/products?status=rejected`,
      label: t("vendor.dash.rejected"),
      value: counts.rejected,
      tone: "danger" as const,
    },
  ];

  const toneBorders = {
    neutral: "border-t-border-strong",
    warning: "border-t-warning",
    success: "border-t-success",
    danger: "border-t-danger",
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Store Header Banner */}
      <Card className="border-t-[3px] border-t-action">
        <CardBody className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-md bg-ink text-white font-black text-lg shadow-1">
              {storeName.charAt(0)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-lg font-black text-text">{storeName}</h1>
                <Badge tone={statusBadge.tone} dot>{t(statusBadge.key)}</Badge>
                {vendor.verification_status === "verified" ? (
                  <Badge tone="success" dot>{t("vendorStates.verifiedBadge")}</Badge>
                ) : null}
              </div>
              <p className="mt-1 text-xs text-text-muted">
                {t("vendor.dash.slug")}: <span className="num font-bold text-text">@{vendor.slug}</span>
              </p>
            </div>
          </div>

          {vendor.status === "pending" ? (
            <div className="flex flex-col items-end gap-1">
              <Button size="md" disabled>
                <PlusIcon aria-hidden="true" className="size-4" />
                <span>{t("vendor.products.new")}</span>
              </Button>
              <p className="max-w-xs text-end text-xs font-bold text-warning-strong">{t("vendor.products.underReviewNote")}</p>
            </div>
          ) : (
            <Link to={`/${lang}/vendor/products/new`}>
              <Button size="md">
                <PlusIcon aria-hidden="true" className="size-4" />
                <span>{t("vendor.products.new")}</span>
              </Button>
            </Link>
          )}
        </CardBody>
      </Card>

      {loaderData.liveEvent ? <LiveEventNotice event={loaderData.liveEvent} lang={isAr ? "ar" : "en"} /> : null}

      {loaderData.achievements ? <SellerAchievements data={loaderData.achievements} /> : null}

      {/* Product Status Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <Link
            key={card.label}
            to={card.to}
            className={`rounded-lg border border-border border-t-[3px] ${toneBorders[card.tone]} bg-surface p-4 shadow-1 transition-all duration-150 hover:-translate-y-0.5 hover:shadow-2`}
          >
            <div className="flex items-center justify-between">
              <p className="num text-2xl font-black text-text">{card.value}</p>
              <span className="text-xs font-bold text-text-muted">
                {card.value > 0 ? (
                  <span className="text-action">{t("vendor.dash.view")} &larr;</span>
                ) : (
                  "—"
                )}
              </span>
            </div>
            <p className="mt-1.5 text-xs font-bold text-text-muted">{card.label}</p>
          </Link>
        ))}
      </div>

      {loaderData.analytics ? <VendorAnalytics data={loaderData.analytics} lang={isAr ? "ar" : "en"} supabaseUrl={loaderData.supabaseUrl} /> : null}

      {loaderData.insights ? <DashboardInsights cards={loaderData.insights} lang={isAr ? "ar" : "en"} supabaseUrl={loaderData.supabaseUrl} /> : null}

      {/* Quick Actions Shortcuts */}
      <Card>
        <CardHeader title={t("vendor.dash.quickActions")} />
        <CardBody className="grid gap-3 sm:grid-cols-3">
          <Link
            to={`/${lang}/vendor/products`}
            className="flex items-center gap-3 rounded-md border border-border bg-surface p-3.5 shadow-1 transition-all duration-150 hover:border-action/40 hover:bg-surface-tint"
          >
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary-soft text-action">
              <PackageIcon aria-hidden="true" className="size-4" />
            </div>
            <div>
              <p className="text-sm font-black text-text">{t("vendor.products.title")}</p>
              <p className="text-2xs text-text-muted">{total} {t("vendor.dash.totalItems")}</p>
            </div>
          </Link>

          <Link
            to={`/${lang}/vendor/store`}
            className="flex items-center gap-3 rounded-md border border-border bg-surface p-3.5 shadow-1 transition-all duration-150 hover:border-action/40 hover:bg-surface-tint"
          >
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary-soft text-action">
              <StoreIcon aria-hidden="true" className="size-4" />
            </div>
            <div>
              <p className="text-sm font-black text-text">{t("vendorStore.title")}</p>
              <p className="text-2xs text-text-muted">{t("vendor.dash.brandingBio")}</p>
            </div>
          </Link>

          <Link
            to={`/${lang}/vendor/media`}
            className="flex items-center gap-3 rounded-md border border-border bg-surface p-3.5 shadow-1 transition-all duration-150 hover:border-action/40 hover:bg-surface-tint"
          >
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary-soft text-action">
              <UploadIcon aria-hidden="true" className="size-4" />
            </div>
            <div>
              <p className="text-sm font-black text-text">{t("media.title")}</p>
              <p className="text-2xs text-text-muted">{t("vendor.dash.filesLibrary")}</p>
            </div>
          </Link>
        </CardBody>
      </Card>

      {total === 0 ? (
        <Card>
          <CardBody>
            <EmptyState
              title={t("vendor.dash.emptyTitle")}
              body={t("vendor.dash.emptyBody")}
              action={vendor.status === "pending" ? (
                <p className="text-sm font-bold text-warning-strong">{t("vendor.products.underReviewNote")}</p>
              ) : (
                <Link to={`/${lang}/vendor/products/new`}>
                  <Button>{t("vendor.products.new")}</Button>
                </Link>
              )}
            />
          </CardBody>
        </Card>
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
  return <SkeletonPage />;
}

import { Outlet, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/vendor";
import { Link, redirect } from "react-router";
import { useTranslation } from "react-i18next";
import { requireLang } from "~/lib/lang.server";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { fetchVendorRow } from "~/features/vendor/api";
import type { VendorRow } from "~/features/vendor/config";
import { graceMsLeft, isGraceActive, isGraceExpired } from "~/features/vendor/config";
import type { RootLoaderData } from "~/features/settings/api";
import { PanelShell } from "~/components/layout/PanelShell";
import type { SidebarGroup } from "~/components/layout/SidebarNav";
import { LanguageSwitch } from "~/components/layout/LanguageSwitch";
import { AlertIcon, ChartIcon, ListIcon, MegaphoneIcon, PackageIcon, PlusIcon, StarIcon, StoreIcon, TagIcon, UploadIcon } from "~/components/ui/icons";
import { RoutePending } from "~/components/layout/RoutePending";

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) {
    throw redirect(`/${lang}/auth/login?error=db`);
  }
  const viewer = await requirePanelAccess(client, lang, "vendor", request);

  // Forced onboarding (no skip): a vendor account without a submitted store
  // (no row, or draft) can reach nothing else in the panel (US-01).
  const vendor = await fetchVendorRow(client, viewer.user.id);
  if (!vendor || vendor.status === "draft") {
    const path = new URL(request.url).pathname;
    if (!path.endsWith("/vendor/onboarding")) {
      throw redirect(`/${lang}/vendor/onboarding`);
    }
  }

  return {
    lang,
    role: viewer.profile.role,
    name: viewer.profile.full_name,
    vendorStatus: vendor?.status ?? "draft",
    verification: vendor
      ? {
          verification_status: vendor.verification_status,
          verification_note: vendor.verification_note,
          grace_until: vendor.grace_until,
          status: vendor.status,
          rejection_reason: vendor.rejection_reason,
        }
      : null,
  };
}

/** Vendor panel shell — reference sidebar (grouped, dark) + topbar. */
export default function VendorLayout({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { lang } = loaderData;
  const root = useRouteLoaderData("root") as RootLoaderData | undefined;
  const siteName =
    (root?.locale === "en" ? root?.site.site_name_en : root?.site.site_name_ar) ?? t("app.name");

  const groups: SidebarGroup[] = [
    {
      label: lang === "ar" ? "متجري" : "Store",
      items: [
        { to: `/${lang}/vendor`, label: t("vendor.dashboard"), end: true, icon: <ChartIcon /> },
        { to: "products", label: t("vendor.products.title"), icon: <PackageIcon /> },
        { to: `/${lang}/vendor/products/new`, label: t("vendor.products.new"), icon: <PlusIcon /> },
      ],
    },
    {
      label: lang === "ar" ? "إعدادات المتجر" : "Store settings",
      items: [
        { to: "store", label: t("vendorStore.title"), icon: <StoreIcon /> },
        { to: `/${lang}/vendor/media`, label: t("media.title"), icon: <UploadIcon /> },
      ],
    },
    {
      label: lang === "ar" ? "الحساب" : "Account",
      items: [
        { to: "orders", label: t("vendorNav.orders"), icon: <TagIcon /> },
        { to: "wallet", label: t("vendorNav.wallet"), icon: <ListIcon /> },
        { to: `/${lang}/vendor/reports`, label: t("vendorNav.reports"), icon: <ChartIcon /> },
        { to: `/${lang}/vendor/reviews`, label: t("vr.title"), icon: <StarIcon /> },
        { to: `/${lang}/vendor/events`, label: t("vev.title"), icon: <TagIcon /> },
        { to: `/${lang}/vendor/ads`, label: t("va.title"), icon: <MegaphoneIcon /> },
        { to: `/${lang}/vendor/print-history`, label: t("vph.title"), icon: <ListIcon /> },
        { to: `/${lang}/vendor/penalties`, label: t("penalties.title"), icon: <AlertIcon /> },
        { to: `/${lang}/vendor/profile`, label: t("vendorNav.profile"), icon: <StoreIcon /> },
      ],
    },
  ];

  return (
    <PanelShell
      lang={lang}
      siteName={siteName}
      panelTitle={t("vendor.title")}
      subtitle={`${loaderData.name} · ${t("account.role")}: ${loaderData.role}`}
      groups={groups}
      actions={
        <>
          <VerificationIndicator verification={loaderData.verification} lang={lang} />
          <LanguageSwitch current={root?.locale ?? "ar"} />
        </>
      }
    >
      {/* V-07: persistent, non-dismissible verification warning — visible on
          every vendor page until verified or grace end. No close button. */}
      <VerificationBanner verification={loaderData.verification} lang={lang} />
      <RoutePending>
        <Outlet />
      </RoutePending>
    </PanelShell>
  );
}

type VerificationInfo = {
  verification_status: VendorRow["verification_status"];
  verification_note: string | null;
  grace_until: string | null;
  status: VendorRow["status"];
  rejection_reason: string | null;
} | null;

/**
 * The persistent warning (V-07): shows on dashboard + account icon, cannot be
 * dismissed, disappears only on verification or grace end. Topbar form: a
 * labelled warning indicator linking to the onboarding verification step.
 */
function VerificationIndicator({
  verification,
  lang,
}: {
  verification: VerificationInfo;
  lang: string;
}) {
  const { t } = useTranslation();
  if (!verification) return null;
  if (verification.verification_status === "verified") return null;
  if (isGraceExpired({ verification_status: verification.verification_status })) {
    return (
      <Link
        to={`/${lang}/vendor/onboarding`}
        className="flex items-center gap-1.5 rounded-full border border-danger/50 bg-danger-soft px-3 py-1 text-xs font-extrabold text-danger"
        aria-label={t("vendorStates.graceExpiredBadge")}
      >
        <AlertIcon aria-hidden="true" className="size-4" />
        <span className="max-sm:hidden">{t("vendorStates.graceExpiredBadge")}</span>
      </Link>
    );
  }
  if (verification.status === "active") {
    return (
      <Link
        to={`/${lang}/vendor/onboarding`}
        className="flex items-center gap-1.5 rounded-full border border-warning/50 bg-warning-soft px-3 py-1 text-xs font-extrabold text-warning-strong"
        aria-label={t("vendorStates.unverifiedBadge")}
      >
        <AlertIcon aria-hidden="true" className="size-4" />
        <span className="max-sm:hidden">{t("vendorStates.unverifiedBadge")}</span>
      </Link>
    );
  }
  return null;
}

/** Dashboard/page-level banner: the same warning, spelled out with the countdown. */
function VerificationBanner({
  verification,
  lang,
}: {
  verification: VerificationInfo;
  lang: string;
}) {
  const { t } = useTranslation();
  if (!verification) return null;

  if (verification.status === "pending") {
    return (
      <div role="status" className="mb-4 flex items-start gap-2 rounded-lg border border-info/40 bg-info-soft p-3.5">
        <AlertIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-info" />
        <p className="text-sm leading-relaxed text-text">
          <span className="font-extrabold">{t("vendorStates.pendingTitle")}</span>{" "}
          {t("vendorStates.pendingBody")}
        </p>
      </div>
    );
  }
  if (verification.status === "rejected") {
    return (
      <div role="alert" className="mb-4 flex items-start gap-2 rounded-lg border border-danger/40 bg-danger-soft p-3.5">
        <AlertIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-danger" />
        <div className="text-sm leading-relaxed text-text">
          <p className="font-extrabold">{t("vendorStates.rejectedTitle")}</p>
          {verification.rejection_reason ? (
            <p className="mt-1 text-text-muted">{verification.rejection_reason}</p>
          ) : null}
          <Link to={`/${lang}/vendor/onboarding`} className="mt-1 inline-block font-bold text-danger underline underline-offset-2">
            {t("vendorStates.resubmit")}
          </Link>
        </div>
      </div>
    );
  }
  if (verification.status === "suspended") {
    return (
      <div role="alert" className="mb-4 flex items-start gap-2 rounded-lg border border-danger/40 bg-danger-soft p-3.5">
        <AlertIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-danger" />
        <p className="text-sm font-extrabold text-text">{t("vendorStates.suspendedTitle")}</p>
      </div>
    );
  }
  if (isGraceExpired({ verification_status: verification.verification_status })) {
    return (
      <div role="alert" className="mb-4 flex items-start gap-2 rounded-lg border border-danger/40 bg-danger-soft p-3.5">
        <AlertIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-danger" />
        <div className="text-sm leading-relaxed text-text">
          <p className="font-extrabold">{t("vendorStates.graceExpiredTitle")}</p>
          <p className="mt-1 text-text-muted">{t("vendorStates.graceExpiredBody")}</p>
          <Link to={`/${lang}/vendor/onboarding`} className="mt-1 inline-block font-bold text-danger underline underline-offset-2">
            {t("vendorStates.verifyNow")}
          </Link>
        </div>
      </div>
    );
  }
  if (isGraceActive(verification)) {
    const ms = graceMsLeft(verification);
    const days = Math.max(Math.floor(ms / 86_400_000), 0);
    const hours = Math.max(Math.floor((ms % 86_400_000) / 3_600_000), 0);
    return (
      <div role="status" className="mb-4 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft p-3.5">
        <AlertIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-warning" />
        <p className="text-sm leading-relaxed text-text">
          <span className="font-extrabold">{t("vendorStates.unverifiedTitle")}</span>{" "}
          {t("vendorStates.graceCountdown", { days, hours })}{" "}
          {t("vendorStates.unverifiedBody")}{" "}
          <Link to={`/${lang}/vendor/onboarding`} className="font-bold text-warning-strong underline underline-offset-2">
            {t("vendorStates.verifyNow")}
          </Link>
        </p>
      </div>
    );
  }
  return null;
}

import { Outlet, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/vendor";
import { Link, redirect } from "react-router";
import { useTranslation } from "react-i18next";
import { requireLang } from "~/lib/lang.server";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { getViewerContext, requirePanelAccess } from "~/lib/auth/guards";
import type { VendorRow } from "~/features/vendor/config";
import { graceMsLeft, isGraceActive, isGraceExpired } from "~/features/vendor/config";
import type { RootLoaderData } from "~/features/settings/api";
import { PanelShell } from "~/components/layout/PanelShell";
import type { PanelLink } from "~/components/layout/PanelShell";
import { MobileBottomNav } from "~/components/layout/MobileBottomNav";
import type { SidebarGroup } from "~/components/layout/SidebarNav";
import { LanguageSwitch } from "~/components/layout/LanguageSwitch";
import { AlertIcon, CameraIcon, ShieldIcon, ChartIcon, CreditCardIcon, ListIcon, MegaphoneIcon, PackageIcon, PlusIcon, ReceiptIcon, StarIcon, StoreIcon, TagIcon, UploadIcon, UserIcon, FileIcon } from "~/components/ui/icons";
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
  // The store, its "needs changes" count and suspension reason all arrive
  // with the request's viewer context (one DB call shared with the page).
  const { ctx } = await getViewerContext(client);
  const vendor = ctx?.vendor ?? null;
  // admins and staff reach the seller panel from the avatar menu; without a
  // store of their own they land on onboarding and can open one (dual role)
  if (!vendor || vendor.status === "draft") {
    const path = new URL(request.url).pathname;
    if (!path.endsWith("/vendor/onboarding")) {
      throw redirect(`/${lang}/vendor/onboarding`);
    }
  }

  // products the review sent back for changes (yellow banner on every page)
  const needsChanges = vendor?.needs_changes ?? 0;
  // a suspended seller still sees the panel (read-only) and why
  const suspension = vendor?.status === "suspended" ? vendor.suspension_reason : null;

  // dashboards this person can open (admin/staff reach the admin panel too)
  const role = viewer.profile.role;
  const panels: PanelLink[] = [
    ...(role === "admin" || role === "staff"
      ? [{ to: `/${lang}/admin`, labelKey: "admin.title" }]
      : []),
    { to: `/${lang}/vendor`, labelKey: "vendor.title", current: true },
    { to: `/${lang}/account`, labelKey: "account.title" },
  ];

  return {
    lang,
    role,
    name: viewer.profile.full_name,
    panels,
    vendorStatus: vendor?.status ?? "draft",
    needsChanges: needsChanges ?? 0,
    suspension,
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
  const { lang } = loaderData;  const root = useRouteLoaderData("root") as RootLoaderData | undefined;
  const siteName =
    (root?.locale === "en" ? root?.site.site_name_en : root?.site.site_name_ar) ?? t("app.name");

  // ordered by daily use: sell → get paid → grow → store set-up
  const groups: SidebarGroup[] = [
    {
      label: t("vendorNav.group.main"),
      items: [
        { to: `/${lang}/vendor`, label: t("vendor.dashboard"), end: true, icon: <ChartIcon /> },
        { to: `/${lang}/vendor/orders`, label: t("vendorNav.orders"), icon: <ReceiptIcon /> },
        { to: `/${lang}/vendor/products`, label: t("vendor.products.title"), icon: <PackageIcon />, end: true },
        // a store under review cannot list products yet
        loaderData.vendorStatus === "pending"
          ? { to: `/${lang}/vendor/products/new`, label: t("vendor.products.new"), icon: <PlusIcon />, disabled: true, phase: t("vendorStates.underReviewShort") }
          : { to: `/${lang}/vendor/products/new`, label: t("vendor.products.new"), icon: <PlusIcon /> },
      ],
    },
    {
      label: t("vendorNav.group.money"),
      items: [
        { to: `/${lang}/vendor/wallet`, label: t("vendorNav.wallet"), icon: <CreditCardIcon /> },
        { to: `/${lang}/vendor/reports`, label: t("vendorNav.reports"), icon: <ChartIcon /> },
      ],
    },
    {
      label: t("vendorNav.group.growth"),
      items: [
        { to: `/${lang}/vendor/ads`, label: t("va.title"), icon: <MegaphoneIcon /> },
        { to: `/${lang}/vendor/services`, label: t("svc.navTitle"), icon: <CameraIcon /> },
        { to: `/${lang}/vendor/events`, label: t("vev.title"), icon: <TagIcon /> },
        { to: `/${lang}/vendor/reviews`, label: t("vr.title"), icon: <StarIcon /> },
        { to: `/${lang}/vendor/packaging`, label: t("pkg.navStore"), icon: <PackageIcon />, end: true },
        { to: `/${lang}/vendor/packaging/orders`, label: t("pkg.myOrders"), icon: <ListIcon /> },
      ],
    },
    // store set-up sits last; changes there go to admin review
    {
      label: t("vendorNav.group.storeSettings"),
      items: [
        { to: `/${lang}/vendor/store`, label: t("vendorStore.title"), icon: <StoreIcon /> },
        { to: `/${lang}/vendor/verification`, label: t("verify.title"), icon: <ShieldIcon /> },
        { to: `/${lang}/vendor/agreement`, label: t("legal.myAgreement"), icon: <FileIcon /> },
        { to: `/${lang}/vendor/categories`, label: t("vcat.title"), icon: <ListIcon /> },
        { to: `/${lang}/vendor/levels`, label: t("vlv.title"), icon: <StarIcon /> },
        { to: `/${lang}/vendor/media`, label: t("media.title"), icon: <UploadIcon /> },
        { to: `/${lang}/vendor/print-history`, label: t("vph.title"), icon: <ListIcon /> },
        { to: `/${lang}/vendor/penalties`, label: t("penalties.title"), icon: <AlertIcon /> },
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
      panels={loaderData.panels}
      bottomNav={<MobileBottomNav lang={lang} context="vendor" signedIn />}
      actions={
        <>
          <VerificationIndicator verification={loaderData.verification} lang={lang} />
          <LanguageSwitch current={root?.locale ?? "ar"} />
        </>
      }
    >
      {/* V-07: persistent, non-dismissible verification warning — visible on
          every vendor page until verified or grace end. No close button. */}
      <VerificationBanner verification={loaderData.verification} suspension={loaderData.suspension} lang={lang} />
      {loaderData.needsChanges > 0 ? (
        <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border-2 border-warning bg-warning-soft p-4">
          <AlertIcon aria-hidden="true" className="size-6 shrink-0 text-warning-strong" />
          <p className="min-w-0 flex-1 text-sm font-bold text-text">{t("vendorStates.needsChangesBanner", { count: loaderData.needsChanges })}</p>
          <Link to={`/${lang}/vendor/products?status=rejected`} className="inline-flex min-h-10 items-center rounded-lg bg-warning px-4 text-sm font-black text-ink hover:opacity-90">
            {t("vendorStates.needsChangesCta")}
          </Link>
        </div>
      ) : null}
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
        to={`/${lang}/vendor/verification`}
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
        to={`/${lang}/vendor/verification`}
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
  suspension,
  lang,
}: {
  verification: VerificationInfo;
  suspension: string | null;
  lang: string;
}) {
  const { t } = useTranslation();
  if (!verification) return null;

  if (verification.verification_status === "needs_changes" && verification.status !== "suspended") {
    return (
      <div role="alert" className="mb-4 flex items-start gap-2 rounded-lg border border-warning bg-warning-soft p-3.5">
        <AlertIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-warning-strong" />
        <div className="text-sm leading-relaxed text-text">
          <p className="font-extrabold">{t("verify.state.needs_changes")}</p>
          {verification.verification_note ? <p className="mt-1 whitespace-pre-line">{verification.verification_note}</p> : null}
          <Link to={`/${lang}/vendor/verification`} className="mt-1 inline-block font-bold text-warning-strong underline underline-offset-2">
            {t("verify.openPage")}
          </Link>
        </div>
      </div>
    );
  }

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
          <Link to={`/${lang}/vendor/verification`} className="mt-1 inline-block font-bold text-danger underline underline-offset-2">
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
        <div className="text-sm leading-relaxed text-text">
          <p className="font-extrabold">{t("vendorStates.suspendedTitle")}</p>
          {suspension ? <p className="mt-1">{suspension}</p> : null}
          <p className="mt-1 text-xs font-bold text-danger">{t("verify.suspendedHelp")}</p>
          <Link to={`/${lang}/vendor/verification`} className="mt-1 inline-block font-bold text-danger underline underline-offset-2">
            {t("verify.openPage")}
          </Link>
        </div>
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
          <Link to={`/${lang}/vendor/verification`} className="mt-1 inline-block font-bold text-danger underline underline-offset-2">
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
      <div role="alert" className="mb-5 flex flex-col gap-3 rounded-xl border-2 border-danger bg-danger-soft p-4 shadow-1 sm:flex-row sm:items-center sm:p-5">
        <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-full bg-danger text-white">
          <AlertIcon className="size-6" />
        </span>
        <div className="min-w-0 flex-1 text-base leading-relaxed text-text">
          <p className="text-lg font-black text-danger">{t("vendorStates.unverifiedTitle")}</p>
          <p className="mt-0.5 font-extrabold">{t("vendorStates.graceCountdown", { days, hours })}</p>
          <p className="mt-0.5 text-sm text-text-muted">{t("vendorStates.unverifiedBody")}</p>
        </div>
        <Link to={`/${lang}/vendor/verification`}
          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-danger px-5 text-sm font-black text-white hover:opacity-90">
          {t("vendorStates.verifyNow")}
        </Link>
      </div>
    );
  }
  return null;
}

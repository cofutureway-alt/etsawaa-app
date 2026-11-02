import { Link, Outlet } from "react-router";
import type { Route } from "./+types/auth";
import { useTranslation } from "react-i18next";
import { requireLang } from "~/lib/lang.server";
import { useRouteLoaderData } from "react-router";
import type { RootLoaderData } from "~/features/settings/api";
import { LanguageSwitch } from "~/components/layout/LanguageSwitch";
import { RoutePending } from "~/components/layout/RoutePending";

export async function loader({ params }: Route.LoaderArgs) {
  return { lang: requireLang(params) };
}

/**
 * Compact auth shell (per design reference: centered card, logo on top).
 * Auth and panel pages are explicitly noindex (AGENT.md §11).
 */
export default function AuthLayout() {
  const { t } = useTranslation();
  const root = useRouteLoaderData("root") as RootLoaderData | undefined;
  const siteName = root?.locale === "en" ? root?.site.site_name_en : root?.site.site_name_ar;
  return (
    // Centered card shell INSIDE the public frame (header/footer come from
    // the parent layout); auth pages stay noindex (AGENT.md §11).
    <div className="flex w-full flex-col items-center py-4">
      <meta name="robots" content="noindex, nofollow" />
      <div className="mb-6 flex flex-col items-center gap-2">
        <Link to={`/${root?.locale ?? "ar"}`} aria-label={t("a11y.logoAlt")}>
          <img src="/logo-transparent.webp" alt={siteName ?? t("app.name")} width={279} height={224} className="h-14 w-auto" />
        </Link>
        <p className="text-sm text-text-muted">{t("auth.login.subtitle")}</p>
      </div>
      <RoutePending>
        <Outlet />
      </RoutePending>
      <div className="mt-5 flex items-center gap-3 text-xs text-text-muted">
        <LanguageSwitch current={root?.locale ?? "ar"} />
        <Link to={`/${root?.locale ?? "ar"}`} className="hover:text-action">
          {t("errors.goHome")}
        </Link>
      </div>
    </div>
  );
}

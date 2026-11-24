import { Link, Outlet, useLocation } from "react-router";
import type { Route } from "./+types/auth";
import { useTranslation } from "react-i18next";
import { requireLang } from "~/lib/lang.server";
import { getI18n } from "~/lib/i18n/config";
import { useRouteLoaderData } from "react-router";
import type { RootLoaderData } from "~/features/settings/api";
import { RoutePending } from "~/components/layout/RoutePending";

export async function loader({ params }: Route.LoaderArgs) {
  return { lang: requireLang(params) };
}

const AUTH_TITLES: Record<string, string> = {
  login: "auth.login.title", register: "auth.register.title", forgot: "auth.forgot.title",
  verify: "auth.verify.title", complete: "auth.complete.title",
};

/** Browser-tab title for each auth screen (none of them is indexed). */
export const meta = ({ data, location }: Route.MetaArgs) => {
  const lang = (data?.lang as "ar" | "en") ?? "ar";
  const t = getI18n(lang).t;
  const page = location.pathname.split("/").filter(Boolean)[2] ?? "login";
  return [
    { title: `${t(AUTH_TITLES[page] ?? "auth.login.title")} — ${t("app.name")}` },
    { name: "robots", content: "noindex, nofollow" },
  ];
};

/**
 * Compact auth shell (per design reference: centered card, logo on top).
 * Auth and panel pages are explicitly noindex (AGENT.md §11).
 */
export default function AuthLayout() {
  const { t } = useTranslation();
  const root = useRouteLoaderData("root") as RootLoaderData | undefined;
  const { pathname } = useLocation();
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
        {/* "welcome back" belongs to the login screen only */}
        {pathname.endsWith("/auth/login") ? <p className="text-sm text-text-muted">{t("auth.login.subtitle")}</p> : null}
      </div>
      <RoutePending>
        <Outlet />
      </RoutePending>
      <div className="mt-5 flex items-center gap-3 text-xs text-text-muted">
        <Link to={`/${root?.locale ?? "ar"}`} className="hover:text-action">
          {t("errors.goHome")}
        </Link>
      </div>
    </div>
  );
}

import { Link, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { GlobeIcon } from "~/components/ui/icons";
import { switchLocalePath, type Locale } from "~/lib/i18n/config";

/**
 * Language switch: keeps the current route, query string and hash
 * (US-01: "switch keeps the current route and filters").
 */
export function LanguageSwitch({ current }: { current: Locale }) {
  const { t } = useTranslation();
  const location = useLocation();
  const next: Locale = current === "ar" ? "en" : "ar";
  return (
    <Link
      to={switchLocalePath(location.pathname, location.search, location.hash, next)}
      className="flex cursor-pointer items-center gap-1 rounded-m border border-border-strong px-2 py-1.5 text-xs font-bold text-text transition-colors duration-150 hover:border-primary hover:text-action min-[420px]:gap-1.5 min-[420px]:px-3 min-[420px]:py-2 min-[420px]:text-[13px]"
      aria-label={t("common.language")}
    >
      <GlobeIcon aria-hidden="true" />
      {next === "en" ? t("common.english") : t("common.arabic")}
    </Link>
  );
}

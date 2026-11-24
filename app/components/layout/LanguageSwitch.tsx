import { Link, useLocation, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { GlobeIcon } from "~/components/ui/icons";
import { switchLocalePath, type Locale } from "~/lib/i18n/config";

/**
 * Language switch: keeps the current route, query string and hash
 * (US-01: "switch keeps the current route and filters"). Some pages update
 * the address bar without a router navigation (the product wizard writes the
 * new draft's id there), so the click reads the real address, not the
 * router's last known one.
 */
export function LanguageSwitch({ current }: { current: Locale }) {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const next: Locale = current === "ar" ? "en" : "ar";
  return (
    <Link
      to={switchLocalePath(location.pathname, location.search, location.hash, next)}
      onClick={(e) => {
        const real = window.location;
        if (real.pathname === location.pathname && real.search === location.search) return;
        e.preventDefault();
        navigate(switchLocalePath(real.pathname, real.search, real.hash, next));
      }}
      className="flex cursor-pointer items-center gap-1 rounded-md border border-border-strong px-2 py-1.5 text-xs font-bold text-text transition-colors duration-150 hover:border-primary hover:text-action min-[420px]:gap-1.5 min-[420px]:px-3 min-[420px]:py-2 min-[420px]:text-sm"
      aria-label={t("common.language")}
    >
      <GlobeIcon aria-hidden="true" className="size-4 shrink-0" />
      {next === "en" ? t("common.english") : t("common.arabic")}
    </Link>
  );
}

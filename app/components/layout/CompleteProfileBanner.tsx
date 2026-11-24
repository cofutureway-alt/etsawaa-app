import { Link, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { UserIcon } from "~/components/ui/icons";
import { profileIsComplete } from "~/lib/profile-complete";

/**
 * Site-wide reminder for signed-in people whose profile is missing a name or
 * one of the two phones (typically after a Google sign-up). Links to the
 * complete-profile page and comes back to the current page afterwards.
 */
export function CompleteProfileBanner({ lang, profile }: {
  lang: string;
  profile: { full_name?: string | null; phone?: string | null; phone_alternate?: string | null } | null;
}) {
  const { t } = useTranslation();
  const { pathname, search } = useLocation();
  if (!profile || profileIsComplete(profile) || pathname.includes("/auth/")) return null;
  const next = encodeURIComponent(pathname + search);
  return (
    <div role="status" className="border-b border-warning/30 bg-warning-soft">
      <div className="mx-auto flex w-full max-w-page items-center gap-3 px-4 py-2.5">
        <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-surface text-warning-strong">
          <UserIcon className="size-4" />
        </span>
        <p className="min-w-0 flex-1 text-sm font-bold text-text">{t("auth.complete.banner")}</p>
        <Link
          to={`/${lang}/auth/complete?next=${next}`}
          className="flex min-h-9 shrink-0 items-center rounded-lg bg-action px-3 text-sm font-extrabold text-on-action transition-colors duration-150 hover:bg-action-hover"
        >
          {t("auth.complete.bannerCta")}
        </Link>
      </div>
    </div>
  );
}

import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { BellIcon } from "~/components/ui/icons";

/**
 * NotificationBellLink — ACCOUNT BANNER variant (owner round 3): a plain LINK
 * to the notifications page. The bell sits on the dark brand banner, so it is
 * light-on-dark with a strong unread badge; clicking navigates directly to
 * /account/notifications (no overlay dropdown — the interactive bell lives in
 * the header of the admin panel).
 */
export function NotificationBellLink({
  lang,
  initialCount,
}: {
  lang: string;
  initialCount: number;
}) {
  const { t } = useTranslation();
  const shown = Math.min(initialCount, 9);
  return (
    <Link
      to={`/${lang}/account/notifications`}
      aria-label={`${t("a11y.notifications")}${initialCount > 0 ? ` (${initialCount})` : ""}`}
      className="relative flex size-10 items-center justify-center rounded-full border border-white/40 text-white transition-colors duration-150 hover:bg-white/10"
    >
      <BellIcon width={19} height={19} />
      {initialCount > 0 ? (
        <span className="num absolute -top-1 -end-1 flex min-w-5 justify-center rounded-full bg-white px-1 text-2xs font-extrabold leading-5 text-action ring-1 ring-action/20">
          {initialCount > 9 ? "9+" : shown}
        </span>
      ) : null}
    </Link>
  );
}

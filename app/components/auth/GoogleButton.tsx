import { useTranslation } from "react-i18next";

/** Google "G" mark (official four-colour glyph, per Google sign-in branding). */
export function GoogleMark({ className = "size-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className={className}>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

/**
 * "Continue with Google" — a plain POST to /auth/google, which starts the
 * Supabase OAuth flow (works before hydration too). New Google users land on
 * the complete-profile step for their two phones.
 */
export function GoogleButton({ lang, next, label }: { lang: string; next?: string | null; label?: string }) {
  const { t } = useTranslation();
  return (
    <form method="post" action={`/${lang}/auth/google`}>
      <input type="hidden" name="next" value={next ?? ""} />
      <button
        type="submit"
        className="flex min-h-12 w-full cursor-pointer items-center justify-center gap-3 rounded-lg border border-border bg-surface px-4 text-sm font-bold text-text transition-colors duration-150 hover:border-text-faint hover:bg-surface-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
      >
        <GoogleMark />
        {label ?? t("auth.login.google")}
      </button>
    </form>
  );
}

/** "or" divider between the Google button and the email form. */
export function OrDivider() {
  const { t } = useTranslation();
  return (
    <div className="relative text-center">
      <span aria-hidden="true" className="absolute inset-x-0 top-1/2 border-t border-border" />
      <span className="relative z-10 bg-surface px-3 text-xs font-bold text-text-faint">{t("auth.or")}</span>
    </div>
  );
}

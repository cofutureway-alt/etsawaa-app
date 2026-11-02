import {
  isRouteErrorResponse,
  Link,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  data,
  useLocation,
  useRouteError,
} from "react-router";
import type { Route } from "./+types/root";
import { I18nextProvider } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { getI18n, dirFor, isLocale, DEFAULT_LOCALE, type Locale } from "~/lib/i18n/config";
import { loadPublicSettings } from "~/features/settings/api";
import { tokensToCss } from "~/lib/tokens";
import { ToastProvider } from "~/components/ui";
import { NavigationProgress } from "~/components/layout/NavigationProgress";

import "~/styles/globals.css";

/**
 * Root loader: resolves locale from the URL, loads public settings
 * (site identity + design tokens) and passes them down. Token overrides are
 * injected as a <style> block server-side (F-02: changing a token in the DB
 * restyles the page with no code edits).
 */
export async function loader({ request }: Route.LoaderArgs) {
  const { client } = createSupabaseServerClient(request);
  const url = new URL(request.url);
  const segment = url.pathname.split("/")[1];
  const locale: Locale = isLocale(segment) ? segment : DEFAULT_LOCALE;
  const settings = await loadPublicSettings(client);
  return data({
    locale,
    site: settings.site,
    design: settings.design,
    dbConnected: settings.connected,
  });
}

/**
 * The root component renders the full document so <html lang dir> comes from
 * loader data — English renders LTR from the very first server byte.
 */
export default function App({ loaderData }: Route.ComponentProps) {
  const i18n = getI18n(loaderData.locale);
  const { locale } = loaderData;

  return (
    <I18nextProvider i18n={i18n}>
      <html lang={locale} dir={dirFor(locale)}>
        <head>
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
          <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.jpg" />
          {/* The LCP image (and every product image) lives on the storage
              origin — a NEW third-party host. Warming DNS+TCP+TLS in head
              removes ~2-3 round trips from the banner's critical path. */}
          {(() => {
            const sb = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
            return sb ? <link rel="preconnect" href={new URL(sb).origin} crossOrigin="anonymous" /> : null;
          })()}
          {/* H-02 — Arabic typography is SELF-HOSTED (public/fonts): variable
              Cairo woff2 in arabic+latin subsets, wght 200..1000 (~63KB total).
              Preloaded here; declared with @font-face + font-display:swap in
              globals.css. Same-origin: zero runtime dependency on
              fonts.googleapis.com/gstatic, no third-party font requests at
              all, every layout (storefront/admin/vendor/auth) inherits it
              through --font-body. */}
          <link rel="preload" href="/fonts/cairo-var-arabic.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
          <link rel="preload" href="/fonts/cairo-var-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
          <Meta />
          <Links />
          {/* DB-driven token overrides (F-02): must come AFTER the built
              stylesheet so the DB values win the :root cascade. React 19
              hoists <style precedence> ABOVE <Links>, where tokens.css
              re-declares the vars and the overrides lose — so this is a
              plain in-place <style>. */}
          <style dangerouslySetInnerHTML={{ __html: tokensToCss(loaderData.design) }} />
        </head>
        <body>
          <ToastProvider>
            {/* H-07: global top progress bar on every client navigation */}
            <NavigationProgress />
            <Outlet />
          </ToastProvider>
          <ScrollRestoration />
          <Scripts />
        </body>
      </html>
    </I18nextProvider>
  );
}

/**
 * The root boundary renders outside App, so it cannot read the loader — derive
 * the locale from the URL instead of hardcoding Arabic (English readers got an
 * Arabic RTL error page before).
 */
function useErrorLocale(): Locale {
  const location = useLocation();
  const segment = location.pathname.split("/")[1];
  return isLocale(segment) ? segment : DEFAULT_LOCALE;
}

export function ErrorBoundary() {
  const error = useRouteError();
  const lang = useErrorLocale();
  const status = isRouteErrorResponse(error) ? error.status : 500;
  if (status === 403) return <StandaloneForbidden lang={lang} />;
  // Full standalone document: root-level errors render outside App.
  return (
    <html lang={lang} dir={dirFor(lang)}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{status === 404 ? COPY[lang].notFoundTitle : COPY[lang].errorTitle}</title>
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
        <Meta />
        <Links />
      </head>
      <body>
        <StandaloneErrorPage status={status} lang={lang} />
        <Scripts />
      </body>
    </html>
  );
}

const COPY = {
  ar: {
    notFoundTitle: "اتسوء — الصفحة غير موجودة",
    errorTitle: "اتسوء — حدث خطأ",
    notFound: "الصفحة غير موجودة",
    error: "حدث خطأ ما",
    notFoundBody: "الصفحة التي تبحث عنها غير موجودة أو تم نقلها.",
    errorBody: "حدث خطأ غير متوقع. يمكنك إعادة المحاولة أو العودة للرئيسية.",
    searchPlaceholder: "ابحث في المنتجات…",
    search: "بحث",
    home: "العودة للرئيسية",
    refresh: "تحديث الصفحة",
    forbiddenTitle: "اتسوء — لا تملك صلاحية",
    forbidden: "لا تملك صلاحية",
    forbiddenBody: "حسابك لا يملك صلاحية عرض هذه الصفحة.",
  },
  en: {
    notFoundTitle: "Etsawaa — Page not found",
    errorTitle: "Etsawaa — Something went wrong",
    notFound: "Page not found",
    error: "Something went wrong",
    notFoundBody: "The page you are looking for does not exist or has moved.",
    errorBody: "An unexpected error occurred. Retry or go back home.",
    searchPlaceholder: "Search products…",
    search: "Search",
    home: "Back to home",
    refresh: "Reload page",
    forbiddenTitle: "Etsawaa — Not allowed",
    forbidden: "Not allowed",
    forbiddenBody: "Your account does not have access to this page.",
  },
} as const;

function StandaloneErrorPage({ status, lang }: { status: number; lang: Locale }) {
  const notFound = status === 404;
  const c = COPY[lang];
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <img src="/logo-transparent.webp" alt="Etsawaa" width={279} height={224} className="h-12 w-auto" />
      <p className="num text-5xl font-black text-action">{status}</p>
      <h1 className="text-xl font-extrabold text-text">
        {notFound ? c.notFound : c.error}
      </h1>
      <p className="max-w-md text-sm text-text-muted">
        {notFound ? c.notFoundBody : c.errorBody}
      </p>
      {notFound ? (
        <form action={`/${lang}/search`} method="get" className="mt-2 flex w-full max-w-sm items-center gap-2">
          <input
            type="search"
            name="q"
            placeholder={c.searchPlaceholder}
            aria-label={c.searchPlaceholder}
            className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-action"
          />
          <button
            type="submit"
            className="cursor-pointer rounded-md bg-action px-4 py-2.5 text-[13px] font-bold text-on-action transition-colors duration-200 hover:bg-action-hover"
          >
            {c.search}
          </button>
        </form>
      ) : null}
      <div className="flex items-center gap-3">
        <Link
          to={`/${lang}`}
          className="rounded-md bg-action px-5 py-2.5 text-sm font-bold text-on-action transition-colors duration-200 hover:bg-action-hover"
        >
          {c.home}
        </Link>
        {notFound ? null : (
          <Link to={`/${lang}`} className="rounded-md border border-border px-5 py-2.5 text-sm font-bold text-text hover:bg-surface-tint">
            {c.refresh}
          </Link>
        )}
      </div>
    </main>
  );
}

/** 403 for signed-in users without panel permission (US-09 edge case). */
function StandaloneForbidden({ lang }: { lang: Locale }) {
  const c = COPY[lang];
  return (
    <html lang={lang} dir={dirFor(lang)}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{c.forbiddenTitle}</title>
        <Meta />
        <Links />
      </head>
      <body>
        <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="num text-5xl font-black text-action">403</p>
          <h1 className="text-xl font-extrabold text-text">{c.forbidden}</h1>
          <p className="max-w-md text-sm text-text-muted">{c.forbiddenBody}</p>
          <Link to={`/${lang}`} className="font-bold text-action hover:underline">
            {c.home}
          </Link>
        </main>
        <Scripts />
      </body>
    </html>
  );
}

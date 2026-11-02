import {
  isRouteErrorResponse,
  Link,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  data,
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
  const { site, locale } = loaderData;
  const siteName = locale === "ar" ? site.site_name_ar : site.site_name_en;
  const tagline = locale === "ar" ? site.tagline_ar : site.tagline_en;

  return (
    <I18nextProvider i18n={i18n}>
      <html lang={locale} dir={dirFor(locale)}>
        <head>
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>{`${siteName} — ${tagline}`}</title>
          <meta name="description" content={tagline} />
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

export function ErrorBoundary() {
  const error = useRouteError();
  const status = isRouteErrorResponse(error) ? error.status : 500;
  if (status === 403) return <StandaloneForbidden />;
  // Full standalone document: root-level errors render outside App.
  return (
    <html lang="ar" dir="rtl">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{status === 404 ? "اتسوء — الصفحة غير موجودة" : "اتسوء — حدث خطأ"}</title>
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
        <Meta />
        <Links />
      </head>
      <body>
        <StandaloneErrorPage status={status} />
        <Scripts />
      </body>
    </html>
  );
}

function StandaloneErrorPage({ status }: { status: number }) {
  const notFound = status === 404;
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <img src="/logo-transparent.webp" alt="Etsawaa" width={279} height={224} className="h-12 w-auto" />
      <p className="num text-5xl font-black text-action">{status}</p>
      <h1 className="text-xl font-extrabold text-text">
        {notFound ? "الصفحة غير موجودة" : "حدث خطأ ما"}
      </h1>
      <p className="max-w-md text-sm text-text-muted">
        {notFound
          ? "الصفحة التي تبحث عنها غير موجودة أو تم نقلها."
          : "حدث خطأ غير متوقع. يمكنك إعادة المحاولة أو العودة للرئيسية."}
      </p>
      {notFound ? (
        <form action="/ar/search" method="get" className="mt-2 flex w-full max-w-sm items-center gap-2">
          <input
            type="search"
            name="q"
            placeholder="ابحث في المنتجات…"
            aria-label="ابحث في المنتجات"
            className="min-w-0 flex-1 rounded-m border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-action"
          />
          <button
            type="submit"
            className="cursor-pointer rounded-m bg-action px-4 py-2.5 text-[13px] font-bold text-on-action transition-colors duration-200 hover:bg-action-hover"
          >
            بحث
          </button>
        </form>
      ) : null}
      <div className="flex items-center gap-3">
        <Link
          to="/ar"
          className="rounded-m bg-action px-5 py-2.5 text-sm font-bold text-on-action transition-colors duration-200 hover:bg-action-hover"
        >
          العودة للرئيسية
        </Link>
        {notFound ? null : (
          <Link to="/ar" className="rounded-m border border-border px-5 py-2.5 text-sm font-bold text-text hover:bg-surface-tint">
            تحديث الصفحة
          </Link>
        )}
      </div>
    </main>
  );
}

/** 403 for signed-in users without panel permission (US-09 edge case). */
function StandaloneForbidden() {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>اتسوء — لا تملك صلاحية</title>
        <Meta />
        <Links />
      </head>
      <body>
        <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="num text-5xl font-black text-action">403</p>
          <h1 className="text-xl font-extrabold text-text">لا تملك صلاحية</h1>
          <p className="max-w-md text-sm text-text-muted">حسابك لا يملك صلاحية عرض هذه الصفحة.</p>
          <Link to="/ar" className="font-bold text-action hover:underline">
            العودة للرئيسية
          </Link>
          <Scripts />
        </main>
      </body>
    </html>
  );
}

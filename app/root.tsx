import { getViewer } from "~/lib/auth/guards";
import { useEffect } from "react";
import {
  isRouteErrorResponse,
  Link,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  data,
  redirect,
  useLocation,
  useRouteError,
} from "react-router";
import { EMBED_HOSTS } from "~/lib/embed-hosts";
import type { Route } from "./+types/root";
import { I18nextProvider } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { getI18n, dirFor, ensureLocale, isLocale, DEFAULT_LOCALE, type Locale } from "~/lib/i18n/config";
import { loadPublicSettings } from "~/features/settings/api";
import { tokensToCss } from "~/lib/tokens";
import { ToastProvider } from "~/components/ui";
import { NavigationProgress } from "~/components/layout/NavigationProgress";
import { LocalePreference } from "~/components/layout/LocalePreference";
import { cookieLocale } from "~/lib/locale-preference.server";

import "~/styles/globals.css";

/** Reload ONCE (per 30 s) when a lazily loaded route chunk of an older build is missing. */
const CHUNK_RELOAD_SCRIPT = `(function(){var K="etsawaa:chunk-reload";function go(){try{var t=+sessionStorage.getItem(K)||0;if(Date.now()-t<30000)return;sessionStorage.setItem(K,String(Date.now()))}catch(e){}location.reload()}function bad(m){return /dynamically imported module|Importing a module script failed|Failed to fetch dynamically|error loading dynamically imported module|Unable to preload CSS/i.test(String(m||""))}addEventListener("vite:preloadError",function(e){if(e&&e.preventDefault)e.preventDefault();go()});addEventListener("unhandledrejection",function(e){if(bad(e.reason&&(e.reason.message||e.reason)))go()});addEventListener("error",function(e){if(bad(e.message))go()});window.__etsawaaChunkReload=function(m){if(bad(m)){go();return true}return false}})();`;

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
  // links without a language prefix (/contact, /product/x, /AR/…) → the same
  // page under /ar or /en instead of a 404 (a thrown redirect outranks the
  // child route's 404 in React Router's loader results)
  if (segment && !isLocale(segment) && segment !== "api" && segment !== "assets" && !/\.[a-z0-9]{2,5}$/i.test(url.pathname)) {
    const lower = segment.toLowerCase();
    const rest = isLocale(lower) ? url.pathname.slice(segment.length + 1) : url.pathname;
    const prefersEn = /^en\b/i.test(request.headers.get("accept-language") ?? "");
    const target = isLocale(lower) ? lower : cookieLocale(request) ?? (prefersEn ? "en" : DEFAULT_LOCALE);
    // language-guessed targets stay 302 so a cached redirect never pins the wrong language
    throw redirect(`/${target}${rest === "/" ? "" : rest}${url.search}`, { status: isLocale(lower) ? 301 : 302, headers: { "Cache-Control": "private, no-store", Vary: "Cookie, Accept-Language" } });
  }
  const locale: Locale = isLocale(segment) ? segment : DEFAULT_LOCALE;
  const settings = await loadPublicSettings(client);
  // event emails run in the server process (no-op after the first call / in the browser)
  if (typeof window === "undefined") void import("~/lib/email/notify-worker.server").then((m) => m.ensureNotifyWorker()).catch(() => undefined);
  if (typeof window === "undefined") void import("~/lib/email/auth-queue.server").then((m) => m.ensureAuthEmailWorker()).catch(() => undefined);
  // unused uploads older than 30 days are removed daily (media retention)
  if (typeof window === "undefined") void import("~/lib/media-cleanup.server").then((m) => m.ensureMediaCleanupWorker()).catch(() => undefined);
  // the staff portal address goes to the team only (admins and staff, supervisors included);
  // everyone else never gets it, not even in the page data
  // the same rule for the team webmail (mail.etsawaa.com); the mail admin site (dmail) is never linked
  const role = client ? (await getViewer(client).catch(() => null))?.viewer?.profile.role : null;
  const team = role === "admin" || role === "staff";
  const site = team ? settings.site : { ...settings.site, portal_url: "", portal_label_ar: "", portal_label_en: "" };
  const teamMailUrl = team ? "https://mail.etsawaa.com" : "";
  return data({
    locale,
    site,
    teamMailUrl,
    design: settings.design,
    social: settings.social,
    contact: settings.contact,
    dbConnected: settings.connected,
  });
}

/**
 * Document security headers (root route → every page of the app).
 *
 * CSP — derived from what the app actually loads in the browser:
 * - script-src 'self' 'unsafe-inline': React Router 7 SSR embeds inline
 *   hydration/bootstrap <script> blocks in the document, so a strict
 *   nonce-less policy would break hydration. Upgrade path: generate a
 *   per-response nonce (context in this loader), pass it to <Scripts
 *   nonce={...}>, and tighten to script-src 'self' 'nonce-…' (+'strict-dynamic').
 * - style-src 'self' 'unsafe-inline': the built stylesheet is 'self', but the
 *   DB-driven design tokens are injected as an inline <style> below (App
 *   head) — values are validated hex colors (app/lib/tokens.ts).
 * - img-src 'self' data: blob: https:: product/banner images render straight
 *   from the Supabase storage origin (app/lib/media.shared.ts publicMediaUrl
 *   → {SUPABASE_URL}/storage/v1/object/public/media/…), Leaflet checkout-map
 *   tiles come from tile.openstreetmap.org, and data:/blob: cover upload
 *   previews. The same-origin /api/media proxy stays under 'self'.
 * - connect-src: same-origin loaders/proxies ('self'); the Supabase project
 *   URL (browser REST/auth/storage calls) plus its wss: equivalent —
 *   NotificationBell subscribes to a Supabase Realtime channel; and
 *   photon.komoot.io, fetched client-side by the checkout MapPin for reverse
 *   geocoding. Verified there are no other browser connect origins (the
 *   Kashier hosted checkout is a server-built top-level redirect; resend is
 *   server-side only).
 * - frame-ancestors 'none' (+ legacy X-Frame-Options: DENY): clickjacking
 *   protection for the admin/vendor/checkout flows. The admin email-template
 *   previews are <iframe srcdoc>, which inherit this document's policy and
 *   keep working.
 * - HSTS + upgrade-insecure-requests: the site is served HTTPS-only.
 */
export function headers(): Record<string, string> {
  // Build-time define (vite.config.ts) — the same literal the root component
  // uses for <link rel="preconnect">. Auth/storage/realtime share this origin.
  const sb = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ?? "";
  const sbOrigin = sb ? new URL(sb).origin : "";
  const connectSrc = ["'self'"];
  if (sbOrigin) {
    connectSrc.push(sbOrigin);
    // Supabase Realtime websockets ride the same project host.
    connectSrc.push(sbOrigin.replace(/^https:/, "wss:"));
  }
  connectSrc.push("https://photon.komoot.io");
  connectSrc.push("https://cloudflareinsights.com"); // analytics beacon reports
  return {
    "Content-Security-Policy": [
      "default-src 'self'",
      // 'unsafe-inline': RR7's inline hydration scripts — see nonce note above.
      // + Cloudflare Web Analytics beacon (injected by Cloudflare's proxy)
      "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com",
      // 'unsafe-inline': inline design-token <style> (validated hex only).
      "style-src 'self' 'unsafe-inline'",
      // https: covers the Supabase storage origin + OSM map tiles.
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:", // self-hosted Cairo woff2
      // article videos: uploaded files (Supabase storage) and approved embeds
      `media-src 'self' blob: ${sbOrigin}`.trim(),
      `frame-src 'self' ${EMBED_HOSTS.map((h) => `https://${h}`).join(" ")}`,
      `connect-src ${connectSrc.join(" ")}`,
      "object-src 'none'",
      "base-uri 'self'",
      // form-action also governs the REDIRECTS after a form post (Chrome):
      // Google sign-in posts to /auth/google → Supabase authorize → Google;
      // checkout posts → Kashier hosted payment page.
      `form-action 'self' ${sbOrigin} https://accounts.google.com https://*.kashier.io`.replace(/\s+/g, " "),
      "frame-ancestors 'none'",
      "upgrade-insecure-requests",
    ].join("; "),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    // geolocation=(self): the checkout MapPin uses navigator.geolocation.
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(self), payment=()",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    // Legacy belt-and-braces alongside frame-ancestors 'none'.
    "X-Frame-Options": "DENY",
  };
}

/**
 * The root component renders the full document so <html lang dir> comes from
 * loader data — English renders LTR from the very first server byte.
 */
/** Switching /ar ↔ /en: re-run the root loader so the new language is fetched first. */
export function shouldRevalidate({ currentUrl, nextUrl, defaultShouldRevalidate }: { currentUrl: URL; nextUrl: URL; defaultShouldRevalidate: boolean }) {
  return defaultShouldRevalidate || currentUrl.pathname.split("/")[1] !== nextUrl.pathname.split("/")[1];
}

/** Browser: the other language's dictionary is loaded before the page renders in it. */
export async function clientLoader({ request, serverLoader }: Route.ClientLoaderArgs) {
  const segment = new URL(request.url).pathname.split("/")[1];
  const [loaded] = await Promise.all([serverLoader(), ensureLocale(isLocale(segment) ? segment : DEFAULT_LOCALE)]);
  return loaded;
}

export default function App({ loaderData }: Route.ComponentProps) {
  const i18n = getI18n(loaderData.locale);
  // marks the end of the first hydration (client-only state may be read after it)
  useEffect(() => { (window as unknown as { __etsawaaHydrated?: boolean }).__etsawaaHydrated = true; }, []);
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
          {/* A page opened before a deploy asks for the old build's route chunk on
              the next click; if that chunk is gone the click would end on an error
              page for a perfectly valid URL. Reload once into the new build instead. */}
          <script dangerouslySetInnerHTML={{ __html: CHUNK_RELOAD_SCRIPT }} />
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
            <LocalePreference locale={locale} />
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
  // stale build after a deploy → reload into the new one instead of an error page
  if (typeof window !== "undefined" && error instanceof Error) {
    const w = window as unknown as { __etsawaaChunkReload?: (m: string) => boolean };
    w.__etsawaaChunkReload?.(error.message);
  }
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
    notFoundTitle: "إتسوء — الصفحة غير موجودة",
    errorTitle: "إتسوء — حدث خطأ",
    notFound: "الصفحة غير موجودة",
    error: "حدث خطأ ما",
    notFoundBody: "الصفحة التي تبحث عنها غير موجودة أو تم نقلها.",
    errorBody: "حدث خطأ غير متوقع. يمكنك إعادة المحاولة أو العودة للرئيسية.",
    searchPlaceholder: "ابحث في المنتجات…",
    search: "بحث",
    home: "العودة للرئيسية",
    refresh: "تحديث الصفحة",
    forbiddenTitle: "إتسوء — لا تملك صلاحية",
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
            className="cursor-pointer rounded-md bg-action px-4 py-2.5 text-sm font-bold text-on-action transition-colors duration-200 hover:bg-action-hover"
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

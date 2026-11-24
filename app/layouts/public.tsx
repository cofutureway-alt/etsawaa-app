import { Suspense, lazy, useState } from "react";
import { getActiveAds, getAdProductCards, pickRandom } from "~/features/ads/ads.server";
import { AdPopup, type PopupAd } from "~/components/catalog/AdPopup";
import { Outlet, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/public";
import { useTranslation } from "react-i18next";
import { requireLang } from "~/lib/lang.server";
import type { RootLoaderData } from "~/features/settings/api";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { getViewer } from "~/lib/auth/guards";
import type { Locale } from "~/lib/i18n/config";
import { getCategories, listHeaderPages } from "~/features/storefront/api";
import { CartProvider } from "~/features/cart/store";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { RoutePending } from "~/components/layout/RoutePending";
import { PublicHeader } from "~/components/layout/public/header";
import { PublicFooter } from "~/components/layout/public/footer";
import { NavDrawer } from "~/components/layout/public/nav-drawer";
import { MobileBottomNav } from "~/components/layout/MobileBottomNav";
import { CompleteProfileBanner } from "~/components/layout/CompleteProfileBanner";

// Interaction-only / below-fold widgets ship as separate chunks and hydrate
// lazily — the initial pipe carries header + content only.
const CartDrawer = lazy(() => import("~/features/cart/components/CartDrawer").then((m) => ({ default: m.CartDrawer })));
const CompareBar = lazy(() => import("~/components/catalog/CompareBar").then((m) => ({ default: m.CompareBar })));

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  // session + menu data in ONE parallel round (the session is shared with the page loader)
  const [viewerRes, categories, headerPages, popupAds] = client
    ? await Promise.all([
        getViewer(client),
        getCategories(client, { maxDepth: 3 }).catch(() => []),
        listHeaderPages(client),
        getActiveAds(client, ["popup"]),
      ])
    : [null, [], [], []];
  const viewer = viewerRes?.viewer ?? null;
  // one paid popup per page load, picked at random among the live ones
  let popup: PopupAd | null = null;
  const pick = pickRandom(popupAds, 1)[0];
  if (client && pick?.product_id) {
    const card = (await getAdProductCards(client, [pick.product_id])).get(pick.product_id);
    if (card) popup = { campaign: pick.id, template: pick.template, card };
  }
  return { lang, viewer: viewer?.profile ?? null, viewerId: viewer?.user.id ?? null, categories, headerPages, popup };
}

/**
 * Public storefront shell (S-10 / JOURNEYS §0): header row (logo, search,
 * actions) + main nav with the categories menu; footer with policies from
 * the DB. Cart + compare providers wrap the whole tree so any page can add.
 *
 * Structure only — the header (with cart button/user dropdown/categories
 * menu), footer and mobile drawer bodies live in
 * app/components/layout/public/* (pure structural refactor). The menuOpen
 * state stays here because the drawer renders as a sibling AFTER the footer,
 * not inside the header.
 */
export default function PublicLayout({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const root = useRouteLoaderData("root") as RootLoaderData | undefined;
  const lang: Locale = root?.locale ?? "ar";
  const siteName =
    (lang === "ar" ? root?.site.site_name_ar : root?.site.site_name_en) ?? t("app.name");
  const profile = loaderData.viewer;
  const [menuOpen, setMenuOpen] = useState(false);

  const navItems = [
    { to: `/${lang}`, label: t("nav.home"), end: true },
    { to: `/${lang}/products`, label: t("nav.allProducts"), end: false },
    { to: `/${lang}/vendors`, label: t("nav.vendors"), end: false },
    { to: `/${lang}/brands`, label: t("nav.brands"), end: false },
    { to: `/${lang}/blog`, label: t("nav.blog"), end: false },
    { to: `/${lang}/contact`, label: t("nav.contact"), end: false },
  ];

  return (
    <CartProvider viewerId={loaderData.viewerId}>
      <div className="flex min-h-dvh flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:start-2 focus:z-[100] focus:rounded-md focus:bg-action focus:px-4 focus:py-2 focus:text-on-action"
        >
          {t("nav.skipToContent")}
        </a>

        <PublicHeader
          lang={lang}
          siteName={siteName}
          profile={profile}
          categories={loaderData.categories}
          navItems={navItems}
          menuOpen={menuOpen}
          onOpenMenu={() => setMenuOpen(true)}
        />

        <CompleteProfileBanner lang={lang} profile={profile} />

        <main id="main" className="mx-auto w-full max-w-page flex-1 px-4 py-6">
          <RoutePending>
            <Outlet />
          </RoutePending>
        </main>

        <PublicFooter siteName={siteName} lang={lang} headerPages={loaderData.headerPages} />

        {menuOpen ? (
          <NavDrawer
            lang={lang}
            siteName={siteName}
            navItems={navItems}
            categories={loaderData.categories}
            headerPages={loaderData.headerPages}
            profile={profile}
            onClose={() => setMenuOpen(false)}
          />
        ) : null}

        <MobileBottomNav lang={lang} context="store" signedIn={Boolean(profile)} />
        <AdPopup ad={loaderData.popup ?? null} lang={lang} />
        <Suspense fallback={null}>
          <CartDrawer />
          <CompareBar />
        </Suspense>
      </div>
    </CartProvider>
  );
}

/** H-06: friendly route error page (500s log a CORERR id; 403/404 keep their message) */
export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}

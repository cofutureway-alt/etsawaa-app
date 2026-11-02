import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useNavigate, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/public";
import { useTranslation } from "react-i18next";
import { requireLang } from "~/lib/lang.server";
import type { RootLoaderData } from "~/features/settings/api";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { getViewer } from "~/lib/auth/guards";
import type { Locale } from "~/lib/i18n/config";
import { getCategories, listHeaderPages, type CategoryNode } from "~/features/storefront/api";
import { MediaImg } from "~/components/catalog/MediaImg";
import { CartProvider, useCart } from "~/features/cart/store";
import {
  CartIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  GlobeIcon,
  GridIcon,
  HeartIcon,
  MenuIcon,
  StoreIcon,
  UserIcon,
  XIcon,
} from "~/components/ui/icons";
import { LanguageSwitch } from "~/components/layout/LanguageSwitch";
import { SearchBox } from "~/components/catalog/SearchBox";
import { Suspense, lazy } from "react";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { RoutePending } from "~/components/layout/RoutePending";

// Interaction-only / below-fold widgets ship as separate chunks and hydrate
// lazily — the initial pipe carries header + content only.
const CartDrawer = lazy(() => import("~/components/catalog/CartDrawer").then((m) => ({ default: m.CartDrawer })));
const CompareBar = lazy(() => import("~/components/catalog/CompareBar").then((m) => ({ default: m.CompareBar })));

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  const { viewer } = client ? ((await getViewer(client)) ?? { viewer: null }) : { viewer: null };
  const [categories, headerPages] = client
    ? await Promise.all([getCategories(client).catch(() => []), listHeaderPages(client)])
    : [[], []];
  return { lang, viewer: viewer?.profile ?? null, viewerId: viewer?.user.id ?? null, categories, headerPages };
}

interface HeaderPage {
  slug_ar: string;
  slug_en: string;
  title_ar: string;
  title_en: string;
}

/**
 * Public storefront shell (S-10 / JOURNEYS §0): header row (logo, search,
 * actions) + main nav with the categories menu; footer with policies from
 * the DB. Cart + compare providers wrap the whole tree so any page can add.
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

        <header className="sticky top-0 z-40 border-b border-border bg-surface">
          <div className="mx-auto max-w-page px-3 min-[420px]:px-4">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2 min-[420px]:gap-x-3 min-[420px]:py-2.5 sm:gap-x-4">
              <Link to={`/${lang}`} className="shrink-0" aria-label={t("a11y.logoAlt")}>
                <img
                  src="/logo-mark.webp"
                  alt={siteName}
                  width={548}
                  height={245}
                  className="h-9 w-auto min-[420px]:h-11 sm:h-[52px]"
                />
              </Link>

              <div className="relative hidden min-w-0 flex-1 md:block">
                <SearchBox lang={lang} />
              </div>

              <div className="ms-auto flex shrink-0 items-center gap-1 md:ms-0">
                <LanguageSwitch current={lang} />
                {/* signed-in: avatar button opening the USER DROPDOWN (owner:
                    phone users need a menu). Signed-out visitors keep the icon. */}
                {profile ? (
                  <UserMenu
                    lang={lang}
                    name={profile.full_name}
                    avatarUrl={profile.avatar_url}
                  />
                ) : (
                  <IconLink to={`/${lang}/auth/login`} label={t("nav.login")}>
                    <UserIcon />
                  </IconLink>
                )}
                <IconLink
                  to={`/${lang}${profile ? "/account/wishlist" : "/auth/login?next=" + encodeURIComponent(`/${lang}/account/wishlist`)}`}
                  label={t("nav.wishlist")}
                  className="hidden sm:flex"
                >
                  <HeartIcon />
                </IconLink>
                <CartButton lang={lang} signedIn={Boolean(profile)} />
                {profile ? null : (
                  <Link
                    to={`/${lang}/auth/login`}
                    className="ms-1 hidden rounded-md bg-action px-3.5 py-2 text-[13px] font-bold text-on-action transition-colors duration-200 hover:bg-action-hover sm:inline-flex"
                  >
                    {t("nav.login")}
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => setMenuOpen(true)}
                  aria-label={t("nav.menu")}
                  aria-expanded={menuOpen}
                  className="ms-1 flex size-10 cursor-pointer items-center justify-center rounded-md text-text transition-colors duration-150 hover:bg-surface-tint md:hidden"
                >
                  <MenuIcon />
                </button>
              </div>
            </div>

            <div className="pb-2.5 md:hidden">
              <SearchBox lang={lang} compact />
            </div>

            <nav aria-label={t("a11y.mainNav")} className="hidden border-t border-border md:block">
              <ul className="flex items-center gap-0.5">
                {navItems.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) =>
                        `flex whitespace-nowrap border-b-2 px-3.5 py-2.5 text-[13px] font-semibold transition-colors duration-150 ${
                          isActive
                            ? "border-action text-action"
                            : "border-transparent text-text hover:bg-surface-tint hover:text-action"
                        }`
                      }
                    >
                      {item.label}
                    </NavLink>
                  </li>
                ))}
                {loaderData.categories.length > 0 ? (
                  <li>
                    <CategoriesMenu lang={lang} categories={loaderData.categories} />
                  </li>
                ) : null}
                <li className="ms-auto">
                  <Link
                    to={`/${lang}/sell`}
                    className="flex items-center gap-1.5 whitespace-nowrap px-3.5 py-2.5 text-[13px] font-extrabold text-action hover:bg-surface-tint"
                  >
                    <StoreIcon aria-hidden="true" />
                    {t("nav.sell")}
                  </Link>
                </li>
              </ul>
            </nav>
          </div>
        </header>

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

        <Suspense fallback={null}>
          <CartDrawer />
          <CompareBar />
        </Suspense>
      </div>
    </CartProvider>
  );
}

/** Cart icon with the live count badge; guests open the drawer, too. */
function CartButton({ lang, signedIn }: { lang: string; signedIn: boolean }) {
  const { t } = useTranslation();
  const cart = useCart();
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => (signedIn || cart.count > 0 ? cart.openDrawer() : navigate(`/${lang}/cart`))}
      aria-label={t("nav.cart")}
      className="relative flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-md text-text transition-colors duration-150 hover:bg-surface-tint hover:text-action"
    >
      <CartIcon />
      <span
        aria-hidden="true"
        className={`num absolute -end-0.5 -top-0.5 min-w-4 rounded-full px-1 text-center text-[10px] font-black leading-4 ${
          cart.count > 0 ? "bg-action text-on-action" : "invisible"
        }`}
      >
        {cart.count > 99 ? "99+" : cart.count}
      </span>
    </button>
  );
}

/**
 * Categories mega-menu in the main nav (desktop; owner reference): the
 * trigger opens a dropdown panel BELOW the header — level-1 categories in
 * the first column; hovering one with children reveals the SECOND column
 * beside it; hovering a child reveals the third. Clicking any node
 * navigates. Side-by-side columns (no absolute flyouts — they get clipped
 * by the column scroller). Keyboard: rows focusable via hover/focus,
 * Escape closes, outside click closes. Mobile keeps the drawer list.
 */
function CategoriesMenu({ lang, categories }: { lang: string; categories: CategoryNode[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [activeRoot, setActiveRoot] = useState<string | null>(null);
  const [activeSub, setActiveSub] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const roots = categories.filter((c) => c.depth === 1);
  const childrenOf = (id: string) => categories.filter((c) => c.parent_id === id);
  const catHref = (node: { slug_ar: string; slug_en: string }) =>
    `/${lang}/category/${encodeURIComponent(lang === "en" ? node.slug_en || node.slug_ar : node.slug_ar || node.slug_en)}`;
  const catName = (node: { name_ar: string; name_en: string }) => (lang === "ar" ? node.name_ar : node.name_en);

  const activeRootNode = roots.find((r) => r.id === activeRoot) ?? null;
  const rootChildren = activeRootNode ? childrenOf(activeRootNode.id) : [];
  const activeSubNode = rootChildren.find((s) => s.id === activeSub) ?? null;
  const subChildren = activeSubNode ? childrenOf(activeSubNode.id) : [];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        className={`flex cursor-pointer items-center gap-1.5 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-[13px] font-semibold transition-colors duration-150 ${
          open ? "border-action text-action" : "border-transparent text-text hover:bg-surface-tint hover:text-action"
        }`}
      >
        <GridIcon aria-hidden="true" className="size-4" />
        {t("nav.categories")}
        <ChevronDownIcon aria-hidden="true" className={`size-3.5 transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div
          className="absolute start-0 top-full z-50 mt-px flex max-h-[min(520px,70vh)] items-stretch rounded-b-md border border-t-0 border-border bg-surface shadow-2"
          onMouseLeave={() => { setActiveRoot(null); setActiveSub(null); }}
        >
          {/* column 1: level-1 categories */}
          <ul className="w-60 overflow-y-auto py-1.5">
            {roots.map((rootCat) => {
              const subs = childrenOf(rootCat.id);
              const active = activeRoot === rootCat.id;
              return (
                <li key={rootCat.id}>
                  <Link
                    to={catHref(rootCat)}
                    onClick={() => setOpen(false)}
                    onMouseEnter={() => { setActiveRoot(rootCat.id); setActiveSub(null); }}
                    onFocus={() => { setActiveRoot(rootCat.id); setActiveSub(null); }}
                    className={`flex min-h-11 items-center justify-between gap-2 rounded-md px-3 text-[13px] font-bold transition-colors duration-150 ${
                      active ? "bg-surface-tint text-action" : "text-text hover:bg-surface-tint hover:text-action"
                    }`}
                  >
                    <span className="truncate">{catName(rootCat)}</span>
                    {subs.length > 0 ? (
                      <ChevronRightIcon aria-hidden="true" className="size-3.5 shrink-0 rtl:rotate-180" />
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
          {/* column 2: children of the hovered level-1 */}
          {activeRootNode && rootChildren.length > 0 ? (
            <ul className="w-56 overflow-y-auto border-s border-border py-1.5">
              {rootChildren.map((sub) => {
                const subsSubs = childrenOf(sub.id);
                const subActive = activeSub === sub.id;
                return (
                  <li key={sub.id}>
                    <Link
                      to={catHref(sub)}
                      onClick={() => setOpen(false)}
                      onMouseEnter={() => setActiveSub(sub.id)}
                      onFocus={() => setActiveSub(sub.id)}
                      className={`flex min-h-10 items-center justify-between gap-2 rounded-md px-3 text-[13px] font-semibold transition-colors duration-150 ${
                        subActive ? "bg-surface-tint text-action" : "text-text hover:bg-surface-tint hover:text-action"
                      }`}
                    >
                      <span className="truncate">{catName(sub)}</span>
                      {subsSubs.length > 0 ? (
                        <ChevronRightIcon aria-hidden="true" className="size-3.5 shrink-0 rtl:rotate-180" />
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {/* column 3: grandchildren of the hovered level-2 */}
          {activeSubNode && subChildren.length > 0 ? (
            <ul className="w-56 overflow-y-auto border-s border-border py-1.5">
              {subChildren.map((subSub) => (
                <li key={subSub.id}>
                  <Link
                    to={catHref(subSub)}
                    onClick={() => setOpen(false)}
                    className="flex min-h-10 items-center rounded-md px-3 text-[13px] text-text transition-colors duration-150 hover:bg-surface-tint hover:text-action"
                  >
                    <span className="truncate">{catName(subSub)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function NavDrawer({
  lang,
  siteName,
  navItems,
  categories,
  headerPages,
  profile,
  onClose,
}: {
  lang: string;
  siteName: string;
  navItems: Array<{ to: string; label: string }>;
  categories: CategoryNode[];
  headerPages: HeaderPage[];
  profile: { full_name: string; role: string; avatar_url: string | null } | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const roots = categories.filter((c) => c.depth === 1);
  return (
    <div className="fixed inset-0 z-50 md:hidden" role="presentation">
      <div className="absolute inset-0 bg-ink/60" onClick={onClose} aria-hidden="true" />
      <nav
        aria-label={t("nav.menu")}
        aria-modal="true"
        role="dialog"
        className="absolute inset-y-0 start-0 flex w-[min(320px,86vw)] flex-col border-e border-border bg-surface shadow-2"
      >
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <img src="/logo-mark.webp" alt={siteName} width={548} height={245} className="h-8 w-auto" />
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="flex size-10 cursor-pointer items-center justify-center rounded-md text-text hover:bg-surface-tint"
          >
            <XIcon />
          </button>
        </div>
        <ul className="flex-1 overflow-y-auto py-2">
          {navItems.map((item) => (
            <li key={item.to}>
              <Link
                to={item.to}
                onClick={onClose}
                className="flex min-h-12 items-center gap-2.5 border-s-[3px] border-transparent px-3 text-sm font-semibold text-text hover:bg-surface-tint hover:text-action"
              >
                {item.label}
              </Link>
            </li>
          ))}
          {roots.map((rootCat) => (
            <li key={rootCat.id}>
              <Link
                to={`/${lang}/category/${encodeURIComponent(lang === "en" ? rootCat.slug_en || rootCat.slug_ar : rootCat.slug_ar || rootCat.slug_en)}`}
                onClick={onClose}
                className="flex min-h-11 items-center gap-2.5 border-s-[3px] border-transparent px-3 ps-6 text-[13px] font-semibold text-text-muted hover:bg-surface-tint hover:text-action"
              >
                {lang === "ar" ? rootCat.name_ar : rootCat.name_en}
              </Link>
            </li>
          ))}
          {headerPages.map((page) => (
            <li key={page.slug_en}>
              <Link
                to={`/${lang}/p/${encodeURIComponent(lang === "en" ? page.slug_en : page.slug_ar)}`}
                onClick={onClose}
                className="flex min-h-11 items-center border-s-[3px] border-transparent px-3 ps-6 text-[13px] font-semibold text-text-muted hover:bg-surface-tint hover:text-action"
              >
                {lang === "ar" ? page.title_ar : page.title_en}
              </Link>
            </li>
          ))}
          <li>
            <Link
              to={`/${lang}/sell`}
              onClick={onClose}
              className="flex min-h-12 items-center gap-2.5 border-s-[3px] border-transparent px-3 text-sm font-semibold text-action hover:bg-surface-tint"
            >
              <StoreIcon aria-hidden="true" />
              {t("nav.sell")}
            </Link>
          </li>
        </ul>
        <div className="border-t border-border p-3">
          <Link
            to={`/${lang}${profile ? "/account" : "/auth/login"}`}
            onClick={onClose}
            className="flex min-h-11 items-center justify-center gap-2 rounded-md bg-action text-[13px] font-bold text-on-action"
          >
            {profile ? (
              profile.avatar_url ? (
                <MediaImg path={profile.avatar_url} alt="" width={20} height={20} className="size-5 rounded-full object-cover" />
              ) : (
                <span aria-hidden="true" className="flex size-5 items-center justify-center rounded-full bg-surface text-[11px] font-black text-action">
                  {profile.full_name?.trim()?.[0] || "؟"}
                </span>
              )
            ) : (
              <UserIcon aria-hidden="true" />
            )}
            {profile ? t("nav.myAccount") : t("nav.login")}
          </Link>
        </div>
      </nav>
    </div>
  );
}

/** H-01 owner round 3 — header user dropdown (avatar button → account menu). */
function UserMenu({ lang, name, avatarUrl }: { lang: string; name: string; avatarUrl: string | null }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const items = [
    { to: `/${lang}/account`, label: t("account.overview") },
    { to: `/${lang}/account/orders`, label: t("account.ordersTab") },
    { to: `/${lang}/account/addresses`, label: t("account.addressesTab") },
    { to: `/${lang}/account/wishlist`, label: t("account.wishlistTab") },
    { to: `/${lang}/account/profile`, label: t("account.profile") },
  ];
  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t("nav.myAccount")}
        className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors duration-150 hover:bg-surface-tint"
      >
        {avatarUrl ? (
          <MediaImg path={avatarUrl} alt="" width={28} height={28} className="size-7 rounded-full border border-border object-cover" />
        ) : (
          <span aria-hidden="true" className="flex size-7 items-center justify-center rounded-full bg-action text-[13px] font-black text-on-action">
            {name?.trim()?.[0] || "؟"}
          </span>
        )}
      </button>
      {open ? (
        <div role="menu" aria-label={t("nav.myAccount")}
          className="absolute top-[calc(100%+6px)] end-0 z-50 w-52 overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
          <div className="border-b border-border bg-surface-tint px-4 py-2.5">
            <p className="truncate text-[13px] font-extrabold text-text">{name || t("nav.myAccount")}</p>
          </div>
          <ul className="p-1.5">
            {items.map((it) => (
              <li key={it.to}>
                <NavLink to={it.to} role="menuitem" onClick={() => setOpen(false)}
                  className="flex min-h-11 items-center rounded-md px-3 text-[13px] font-bold text-text hover:bg-surface-tint hover:text-action">
                  {it.label}
                </NavLink>
              </li>
            ))}
          </ul>
          <div className="border-t border-border p-1.5">
            <form method="post" action={`/${lang}/auth/logout`}>
              <button type="submit" role="menuitem"
                className="flex min-h-11 w-full cursor-pointer items-center rounded-md px-3 text-[13px] font-bold text-danger hover:bg-danger-soft">
                {t("nav.logout")}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function IconLink({
  to,
  label,
  children,
  className = "",
}: {
  to: string;
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <NavLink
      to={to}
      aria-label={label}
      className={`flex size-10 shrink-0 items-center justify-center rounded-md text-text transition-colors duration-150 hover:bg-surface-tint hover:text-action ${className}`}
    >
      {children}
    </NavLink>
  );
}

/** Footer (JOURNEYS §0): about · policies (DB) · sell · contact + payments. */
function PublicFooter({
  siteName,
  lang,
  headerPages,
}: {
  siteName: string;
  lang: string;
  headerPages: HeaderPage[];
}) {
  const { t } = useTranslation();
  const groups = [
    {
      title: t("footer.about"),
      links: [
        { to: `/${lang}/p/about`, label: t("footer.about") },
        { to: `/${lang}/p/terms`, label: t("footer.terms") },
        { to: `/${lang}/p/privacy`, label: t("footer.privacy") },
        { to: `/${lang}/p/returns`, label: t("footer.returns") },
      ],
    },
    {
      title: t("nav.categories"),
      links: [
        { to: `/${lang}/products`, label: t("nav.allProducts") },
        { to: `/${lang}/vendors`, label: t("nav.vendors") },
        { to: `/${lang}/brands`, label: t("nav.brands") },
        { to: `/${lang}/contact`, label: t("nav.contact") },
      ],
    },
    {
      title: t("nav.sell"),
      links: [
        { to: `/${lang}/sell`, label: t("nav.sell") },
        { to: `/${lang}/auth/register`, label: t("nav.register") },
        { to: `/${lang}/auth/login`, label: t("nav.login") },
      ],
    },
  ];

  return (
    <footer className="mt-auto bg-footer text-footer-text">
      <div className="mx-auto grid max-w-page gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex min-w-0 flex-col gap-3">
          <img
            src="/logo-mark.webp"
            alt={siteName}
            width={548}
            height={245}
            loading="lazy"
            decoding="async"
            className="h-10 w-auto self-start"
          />
          <p className="max-w-xs text-[13px] leading-relaxed">{t("app.tagline")}</p>
          <div className="mt-1 flex flex-wrap gap-2">
            <span className="rounded-sm border border-white/30 px-2.5 py-1 text-[11px] font-extrabold">
              {t("footer.cod")}
            </span>
            <span className="rounded-sm border border-white/30 px-2.5 py-1 text-[11px] font-extrabold">
              Kashier
            </span>
          </div>
        </div>
        {groups.map((group) => (
          <nav key={group.title} aria-label={group.title} className="min-w-0">
            <h3 className="mb-3 text-[13px] font-extrabold text-white">{group.title}</h3>
            <ul className="flex flex-col gap-2">
              {group.links.map((link) => (
                <li key={`${group.title}-${link.to}`}>
                  <Link
                    to={link.to}
                    className="block text-[13px] transition-colors duration-150 hover:text-white"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      {headerPages.length > 0 ? (
        <div className="border-t border-white/10">
          <div className="mx-auto flex max-w-page flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-[12px]">
            {headerPages.map((page) => (
              <Link
                key={page.slug_en}
                to={`/${lang}/p/${encodeURIComponent(lang === "en" ? page.slug_en : page.slug_ar)}`}
                className="transition-colors duration-150 hover:text-white"
              >
                {lang === "ar" ? page.title_ar : page.title_en}
              </Link>
            ))}
          </div>
        </div>
      ) : null}
      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-page flex-wrap items-center justify-between gap-2 px-4 py-3.5 text-xs">
          <span>
            © {new Date().getFullYear()} {siteName}. {t("footer.rights")}
          </span>
          <span className="flex items-center gap-1.5">
            <GlobeIcon aria-hidden="true" />
            {t("footer.languages")}
          </span>
        </div>
      </div>
    </footer>
  );
}


/** H-06: friendly route error page (500s log a CORERR id; 403/404 keep their message) */
export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}

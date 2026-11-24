/**
 * Public storefront header (top of the shell): sticky bar with the logo,
 * search, the account/wishlist/cart action row, the phone-only category
 * strip and the desktop main nav hosting the categories mega-menu. The
 * mobile nav drawer itself lives in nav-drawer.tsx and is toggled by the
 * layout through onOpenMenu / menuOpen (kept open on the button's
 * aria-expanded for the same a11y state as before).
 *
 * Extracted from app/layouts/public.tsx — pure structural refactor, no
 * behavior change.
 */
import { CategoryIcon } from "~/components/catalog/CategoryIcon";
import { Link, NavLink, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import type { CategoryNode } from "~/features/storefront/api";
import type { Locale } from "~/lib/i18n/config";
import { SearchBox } from "~/components/catalog/SearchBox";
import { LanguageSwitch } from "~/components/layout/LanguageSwitch";
import {
  CartIcon,
  HeartIcon,
  MenuIcon,
  StoreIcon,
  UserIcon,
} from "~/components/ui/icons";
// Layering exception: cart state is feature-owned; the header reads the
// store hook directly to keep the cart badge live.
import { useCart } from "~/features/cart/store";
import { CategoriesMenu } from "./categories-menu";
import { UserMenu } from "./user-menu";
import { IconLink, categoryHref, type NavItem, type ViewerProfile } from "./shared";

export function PublicHeader({
  lang,
  siteName,
  profile,
  categories,
  navItems,
  menuOpen,
  onOpenMenu,
}: {
  lang: Locale;
  siteName: string;
  profile: ViewerProfile | null;
  categories: CategoryNode[];
  navItems: NavItem[];
  menuOpen: boolean;
  onOpenMenu: () => void;
}) {
  const { t } = useTranslation();
  const level1 = categories.filter((c) => c.depth === 1);

  return (
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
                role={profile.role}
              />
            ) : (
              <IconLink to={`/${lang}/auth/login`} label={t("nav.login")}>
                <UserIcon className="size-6" />
              </IconLink>
            )}
            <IconLink
              to={`/${lang}${profile ? "/account/wishlist" : "/auth/login?next=" + encodeURIComponent(`/${lang}/account/wishlist`)}`}
              label={t("nav.wishlist")}
              className="hidden sm:flex"
            >
              <HeartIcon className="size-6" />
            </IconLink>
            <CartButton lang={lang} signedIn={Boolean(profile)} />
            {profile ? null : (
              <Link
                to={`/${lang}/auth/login`}
                className="ms-1 hidden rounded-md bg-action px-3.5 py-2 text-sm font-bold text-on-action transition-colors duration-200 hover:bg-action-hover sm:inline-flex"
              >
                {t("nav.login")}
              </Link>
            )}
            <button
              type="button"
              onClick={onOpenMenu}
              aria-label={t("nav.menu")}
              aria-expanded={menuOpen}
              className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-md text-text transition-colors duration-150 hover:bg-surface-tint sm:size-11 md:hidden"
            >
              <MenuIcon className="size-6" />
            </button>
          </div>
        </div>

        <div className="pb-2.5 md:hidden">
          <SearchBox lang={lang} compact />
        </div>

        {/* Category strip — phones only. The desktop nav already carries
            the الأقسام menu; repeating it here stacked two nav rows. */}
        {level1.length > 1 ? (
          <nav aria-label={t("home.cats.title")} className="border-t border-border md:hidden">
            <ul className="-mx-3 flex gap-1 overflow-x-auto px-3 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {level1.slice(0, 12).map((cat) => (
                <li key={cat.id} className="shrink-0">
                  <Link
                    to={categoryHref(lang, cat)}
                    className="flex min-h-8 items-center gap-1.5 rounded-full px-3 text-xs font-bold text-text-muted transition-colors duration-150 hover:bg-surface-tint hover:text-action"
                  >
                    <CategoryIcon icon={cat.icon} className="size-4 shrink-0 text-action" />
                    {lang === "ar" ? cat.name_ar : cat.name_en}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}

        <nav aria-label={t("a11y.mainNav")} className="hidden border-t border-border md:block">
          <ul className="flex items-center gap-0.5">
            {categories.length > 0 ? (
              <li>
                <CategoriesMenu lang={lang} categories={categories} />
              </li>
            ) : null}
            {navItems.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `flex whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-semibold transition-colors duration-150 ${
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
            <li className="ms-auto">
              <Link
                to={`/${lang}/sell`}
                className="flex items-center gap-1.5 whitespace-nowrap px-3.5 py-2.5 text-sm font-extrabold text-action hover:bg-surface-tint"
              >
                <StoreIcon aria-hidden="true" className="size-5" />
                {t("nav.sell")}
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </header>
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
      className="relative flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-md text-text transition-colors duration-150 hover:bg-surface-tint hover:text-action sm:size-11"
    >
      <CartIcon className="size-6" />
      <span
        aria-hidden="true"
        className={`num absolute end-0 top-0 min-w-5 rounded-full px-1 text-center text-2xs font-black leading-5 ${
          cart.count > 0 ? "bg-action text-on-action" : "invisible"
        }`}
      >
        {cart.count > 99 ? "99+" : cart.count}
      </span>
    </button>
  );
}

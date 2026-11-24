import { Link, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";
import { HeartIcon, HomeIcon, PackageIcon, ReceiptIcon, UserIcon } from "~/components/ui/icons";

export type BottomNavContext = "store" | "vendor" | "admin";

interface Item {
  key: "account" | "orders" | "home" | "products" | "favorites";
  to: string;
  label: string;
  icon: ReactNode;
  active: boolean;
}

/** Pages where a bottom bar would cover the main task (checkout, sign-in…). */
const HIDDEN = /^\/(ar|en)\/(checkout|auth|legal\/accept)(\/|$)/;

/**
 * Phone-only bottom navigation (below md): My account · Orders · Home
 * (raised, centre) · Products · Favorites. Links follow the context — the
 * storefront/account area, the seller dashboard or the admin/staff panel —
 * while Home always returns to the storefront. Its presence sets
 * --bottom-nav-h (globals.css) so page bottoms and other fixed bars clear it.
 */
export function MobileBottomNav({ lang, context, signedIn, show }: {
  lang: string;
  context: BottomNavContext;
  signedIn: boolean;
  /** admin/staff: which panel entries this viewer may open */
  show?: { orders?: boolean; products?: boolean };
}) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  if (HIDDEN.test(pathname)) return null;

  const L = `/${lang}`;
  const at = (prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);
  const guard = (to: string) => (signedIn ? to : `${L}/auth/login?next=${encodeURIComponent(to)}`);

  const favorites: Item = {
    key: "favorites", to: guard(`${L}/account/wishlist`), label: t("bnav.favorites"),
    icon: <HeartIcon />, active: at(`${L}/account/wishlist`),
  };
  const home: Item = { key: "home", to: L, label: t("nav.home"), icon: <HomeIcon />, active: pathname === L || pathname === `${L}/` };

  let account: Item;
  let orders: Item | null;
  let products: Item | null;
  if (context === "vendor") {
    account = { key: "account", to: `${L}/vendor/profile`, label: t("bnav.account"), icon: <UserIcon />, active: at(`${L}/vendor/profile`) || at(`${L}/vendor/store`) };
    orders = { key: "orders", to: `${L}/vendor/orders`, label: t("bnav.orders"), icon: <ReceiptIcon />, active: at(`${L}/vendor/orders`) };
    products = { key: "products", to: `${L}/vendor/products`, label: t("bnav.products"), icon: <PackageIcon />, active: at(`${L}/vendor/products`) };
  } else if (context === "admin") {
    account = { key: "account", to: `${L}/admin/profile`, label: t("bnav.account"), icon: <UserIcon />, active: at(`${L}/admin/profile`) };
    orders = show?.orders === false ? null
      : { key: "orders", to: `${L}/admin/orders`, label: t("bnav.orders"), icon: <ReceiptIcon />, active: at(`${L}/admin/orders`) };
    products = show?.products === false ? null
      : { key: "products", to: `${L}/admin/products`, label: t("bnav.products"), icon: <PackageIcon />, active: at(`${L}/admin/products`) };
  } else {
    const accountActive = at(`${L}/account`) && !at(`${L}/account/orders`) && !at(`${L}/account/wishlist`);
    account = { key: "account", to: guard(`${L}/account`), label: t("bnav.account"), icon: <UserIcon />, active: accountActive };
    orders = { key: "orders", to: guard(`${L}/account/orders`), label: t("bnav.orders"), icon: <ReceiptIcon />, active: at(`${L}/account/orders`) || at(`${L}/order`) };
    products = {
      key: "products", to: `${L}/products`, label: t("bnav.products"), icon: <PackageIcon />,
      active: at(`${L}/products`) || at(`${L}/category`) || at(`${L}/search`) || at(`${L}/product`),
    };
  }

  const side = (it: Item | null) =>
    it ? (
      <li className="flex-1">
        <Link
          to={it.to}
          aria-current={it.active ? "page" : undefined}
          prefetch="intent"
          className={`flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-bold leading-tight transition-colors duration-150 ${
            it.active ? "text-action" : "text-text-muted hover:text-text"
          }`}
        >
          <span aria-hidden className="relative text-[22px]">
            {it.icon}
            {it.active ? <span className="absolute -bottom-1 start-1/2 size-1 -translate-x-1/2 rounded-full bg-action rtl:translate-x-1/2" /> : null}
          </span>
          <span className="max-w-full truncate">{it.label}</span>
        </Link>
      </li>
    ) : (
      <li className="flex-1" aria-hidden />
    );

  return (
    <nav
      data-bottom-nav
      aria-label={t("bnav.label")}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgb(0_0_0/0.06)] backdrop-blur-sm md:hidden"
    >
      <ul className="mx-auto flex h-16 max-w-lg items-stretch px-1">
        {side(account)}
        {side(orders)}
        <li className="flex flex-1 justify-center">
          <Link
            to={home.to}
            aria-current={home.active ? "page" : undefined}
            aria-label={home.label}
            prefetch="intent"
            className="group -mt-5 flex flex-col items-center gap-0.5 text-[11px] font-bold"
          >
            <span
              aria-hidden
              className={`grid size-14 place-items-center rounded-full border-4 border-surface text-2xl shadow-[0_4px_12px_rgb(190_4_4/0.35)] transition-transform duration-150 group-active:scale-95 ${
                home.active ? "bg-action text-on-action" : "bg-action text-on-action/90"
              }`}
            >
              {home.icon}
            </span>
            <span className={home.active ? "text-action" : "text-text-muted"}>{home.label}</span>
          </Link>
        </li>
        {side(products)}
        {side(favorites)}
      </ul>
    </nav>
  );
}

/**
 * Header user dropdown (avatar button → account menu).
 *
 * H-01 owner round 3 — part of the public header; extracted from
 * app/layouts/public.tsx — pure structural refactor, no behavior change.
 */
import { useEffect, useRef, useState } from "react";
import { NavLink, useRouteLoaderData } from "react-router";
import { useTranslation } from "react-i18next";
import { MediaImg } from "~/components/catalog/MediaImg";
import { ChartIcon, StoreIcon, UserIcon, UsersIcon } from "~/components/ui/icons";
import type { RootLoaderData } from "~/features/settings/api";
import { panelLinks } from "./shared";

export function UserMenu({ lang, name, avatarUrl, role }: { lang: string; name: string; avatarUrl: string | null; role?: string }) {
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
  const panels = panelLinks(lang, role);
  // the staff portal (external site, admin → settings) — for the team only
  const site = (useRouteLoaderData("root") as RootLoaderData | undefined)?.site;
  const portal = (role === "admin" || role === "staff") && site?.portal_url
    ? { url: site.portal_url, label: lang === "en" ? site.portal_label_en : site.portal_label_ar }
    : null;
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
        className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors duration-150 hover:bg-surface-tint sm:size-11"
      >
        {avatarUrl ? (
          <MediaImg path={avatarUrl} alt="" width={32} height={32} className="size-8 rounded-full border border-border object-cover" />
        ) : (
          <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-full bg-action text-sm font-black text-on-action">
            {name?.trim()?.[0] || "؟"}
          </span>
        )}
      </button>
      {open ? (
        <div role="menu" aria-label={t("nav.myAccount")}
          className="absolute top-[calc(100%+6px)] end-0 z-50 w-60 overflow-hidden rounded-lg border border-border bg-surface shadow-2">
          <div className="border-b border-border bg-surface-tint px-4 py-2.5">
            <p className="truncate text-sm font-extrabold text-text">{name || t("nav.myAccount")}</p>
          </div>
          {panels.length > 0 ? (
            <div className="flex flex-col gap-1 border-b border-border p-1.5">
              {panels.map((panel) => {
                const Icon = panel.kind === "admin" ? ChartIcon : panel.kind === "vendor" ? StoreIcon : UserIcon;
                return (
                  <NavLink key={panel.to} to={panel.to} role="menuitem" onClick={() => setOpen(false)}
                    className="flex min-h-11 items-center gap-2.5 rounded-md bg-surface-tint px-3 text-sm font-extrabold text-action hover:bg-action hover:text-on-action">
                    <Icon aria-hidden="true" className="size-4 shrink-0" />
                    {t(panel.labelKey)}
                  </NavLink>
                );
              })}
              {portal ? (
                <a href={portal.url} target="_blank" rel="noopener noreferrer" role="menuitem" onClick={() => setOpen(false)}
                  className="flex min-h-11 items-center gap-2.5 rounded-md bg-surface-tint px-3 text-sm font-extrabold text-action hover:bg-action hover:text-on-action">
                  <UsersIcon aria-hidden="true" className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{portal.label}</span>
                  <span aria-hidden="true" className="text-xs opacity-70">↗</span>
                </a>
              ) : null}
            </div>
          ) : null}
          <ul className="p-1.5">
            {items.map((it) => (
              <li key={it.to}>
                <NavLink to={it.to} role="menuitem" onClick={() => setOpen(false)}
                  className="flex min-h-11 items-center rounded-md px-3 text-sm font-bold text-text hover:bg-surface-tint hover:text-action">
                  {it.label}
                </NavLink>
              </li>
            ))}
          </ul>
          <div className="border-t border-border p-1.5">
            <form method="post" action={`/${lang}/auth/logout`}>
              <button type="submit" role="menuitem"
                className="flex min-h-11 w-full cursor-pointer items-center rounded-md px-3 text-sm font-bold text-danger hover:bg-danger-soft">
                {t("nav.logout")}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

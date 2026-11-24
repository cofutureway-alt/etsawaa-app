/**
 * Mobile navigation drawer (the md:hidden overlay opened by the header's
 * menu button): slide-in panel with two tabs — Menu (main nav items, header
 * pages, the sell link) and Categories (level-1 categories, each expandable
 * to its sub-categories) — plus the account/login CTA. Rendered by
 * app/layouts/public.tsx only while menuOpen.
 *
 * Extracted from app/layouts/public.tsx — pure structural refactor, no
 * behavior change.
 */
import { useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { CategoryNode } from "~/features/storefront/api";
import { ChartIcon, ChevronDownIcon, GridIcon, MenuIcon, StoreIcon, UserIcon, XIcon } from "~/components/ui/icons";
import { MediaImg } from "~/components/catalog/MediaImg";
import { CategoryIcon } from "~/components/catalog/CategoryIcon";
import {
  categoryHref,
  headerPageHref,
  type HeaderPage,
  type NavItem,
  type ViewerProfile,
  panelLinks,
} from "./shared";

export function NavDrawer({
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
  navItems: NavItem[];
  categories: CategoryNode[];
  headerPages: HeaderPage[];
  profile: ViewerProfile | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const roots = categories.filter((c) => c.depth === 1);
  const [tab, setTab] = useState<"menu" | "categories">("menu");
  const [openCat, setOpenCat] = useState<string | null>(null);
  const name = (c: CategoryNode) => (lang === "ar" ? c.name_ar : c.name_en);
  const panels = panelLinks(lang, profile?.role).filter((p) => p.kind !== "account");
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
        <div role="tablist" aria-label={t("nav.menu")} className="grid grid-cols-2 gap-1 border-b border-border bg-surface-alt p-1.5">
          {([["menu", t("nav.menu"), <MenuIcon key="m" />], ["categories", t("nav.categories"), <GridIcon key="c" />]] as const).map(([id, label, icon]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`flex min-h-11 items-center justify-center gap-2 rounded-md text-sm font-bold transition-colors duration-150 ${
                tab === id ? "bg-surface text-action shadow-1" : "text-text-muted hover:text-text"
              }`}
            >
              <span aria-hidden="true">{icon}</span>
              {label}
            </button>
          ))}
        </div>
        {tab === "categories" ? (
          <ul role="tabpanel" className="flex-1 overflow-y-auto py-2">
            {roots.map((rootCat) => {
              const children = categories.filter((c) => c.parent_id === rootCat.id);
              const open = openCat === rootCat.id;
              return (
                <li key={rootCat.id} className="border-b border-border/60 last:border-b-0">
                  <div className="flex items-stretch">
                    <Link
                      to={categoryHref(lang, rootCat)}
                      onClick={onClose}
                      className="flex min-h-12 flex-1 items-center gap-3 px-3 text-sm font-semibold text-text hover:bg-surface-tint hover:text-action"
                    >
                      <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-tint text-action">
                        <CategoryIcon icon={rootCat.icon} className="size-5" />
                      </span>
                      {name(rootCat)}
                    </Link>
                    {children.length ? (
                      <button
                        type="button"
                        onClick={() => setOpenCat(open ? null : rootCat.id)}
                        aria-expanded={open}
                        aria-label={name(rootCat)}
                        className="flex w-12 shrink-0 items-center justify-center text-text-muted hover:bg-surface-tint hover:text-action"
                      >
                        <ChevronDownIcon className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
                      </button>
                    ) : null}
                  </div>
                  {open ? (
                    <ul className="bg-surface-alt pb-1">
                      {children.map((child) => (
                        <li key={child.id}>
                          <Link
                            to={categoryHref(lang, child)}
                            onClick={onClose}
                            className="flex min-h-11 items-center gap-2.5 px-3 ps-6 text-sm text-text-muted hover:text-action"
                          >
                            <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-full bg-surface text-action">
                              <CategoryIcon icon={child.icon} className="size-4" />
                            </span>
                            {name(child)}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
        <ul role="tabpanel" className="flex-1 overflow-y-auto py-2">
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
          {headerPages.map((page) => (
            <li key={page.slug_en}>
              <Link
                to={headerPageHref(lang, page)}
                onClick={onClose}
                className="flex min-h-11 items-center border-s-[3px] border-transparent px-3 ps-6 text-sm font-semibold text-text-muted hover:bg-surface-tint hover:text-action"
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
        )}
        <div className="flex flex-col gap-2 border-t border-border p-3">
          {panels.map((panel) => (
            <Link
              key={panel.to}
              to={panel.to}
              onClick={onClose}
              className="flex min-h-11 items-center justify-center gap-2 rounded-md border border-action bg-surface text-sm font-bold text-action hover:bg-surface-tint"
            >
              <ChartIcon aria-hidden="true" />
              {t(panel.labelKey)}
            </Link>
          ))}
          <Link
            to={`/${lang}${profile ? "/account" : "/auth/login"}`}
            onClick={onClose}
            className="flex min-h-11 items-center justify-center gap-2 rounded-md bg-action text-sm font-bold text-on-action"
          >
            {profile ? (
              profile.avatar_url ? (
                <MediaImg path={profile.avatar_url} alt="" width={20} height={20} className="size-5 rounded-full object-cover" />
              ) : (
                <span aria-hidden="true" className="flex size-5 items-center justify-center rounded-full bg-surface text-2xs font-black text-action">
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

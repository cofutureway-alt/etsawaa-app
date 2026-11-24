/**
 * Home hero categories sidebar as a mega menu (desktop ≥1100px): hovering or
 * focusing a level-1 row opens a wide panel over the banner with every
 * level-2 category as a column heading and its level-3 children listed under
 * it. A short close delay lets the pointer cross the gap into the panel.
 * Must be rendered inside a `relative` grid row (the panel covers the banner
 * column: start = sidebar width + gap).
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { CategoryNode } from "~/features/storefront/api";
import { CategoryIcon } from "~/components/catalog/CategoryIcon";
import { ChevronRightIcon, GridIcon } from "~/components/ui/icons";
import { categoryHref } from "~/components/layout/public/shared";

const MAX_LEAVES = 6;

/** Admin art for one top-level menu (admin → Mega menu). */
export interface MegaArt { category_id: string; image_path: string; mode: "corner" | "background"; link_url: string }

const artSrc = (path: string) => `/api/media?path=${encodeURIComponent(path)}`;

export function HeroCategoryMenu({ lang, categories, arts = [] }: { lang: string; categories: CategoryNode[]; arts?: MegaArt[] }) {
  const { t } = useTranslation();
  const [active, setActive] = useState<string | null>(null);
  const closeTimer = useRef<number | null>(null);

  const roots = categories.filter((c) => c.depth === 1).slice(0, 12);
  const childrenOf = (id: string) => categories.filter((c) => c.parent_id === id);
  const name = (n: { name_ar: string; name_en: string }) => (lang === "ar" ? n.name_ar || n.name_en : n.name_en || n.name_ar);

  const cancelClose = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const open = (id: string) => { cancelClose(); setActive(id); };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setActive(null), 160);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setActive(null); };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); cancelClose(); };
  }, []);

  const activeNode = roots.find((r) => r.id === active) ?? null;
  const subs = activeNode ? childrenOf(activeNode.id) : [];
  const art = activeNode ? arts.find((a) => a.category_id === activeNode.id) ?? null : null;
  // an internal link saved with a language prefix follows the page language
  const artLink = art?.link_url ? art.link_url.replace(/^\/(ar|en)(?=\/|$)/, `/${lang}`) : "";

  return (
    <>
      {/* contain:size: the panel takes the banner's height instead of setting it,
          and the category rows share that height evenly */}
      <aside
        aria-label={t("home.cats.title")}
        className="hidden self-stretch rounded-lg border border-border bg-surface min-[1100px]:flex min-[1100px]:flex-col min-[1100px]:[contain:size]"
        onMouseLeave={scheduleClose}
      >
        <div className="flex items-center gap-2 rounded-t-lg bg-action px-3.5 py-2.5 text-sm font-extrabold text-on-action">
          <GridIcon aria-hidden="true" className="size-4" />
          <span>{t("home.cats.title")}</span>
        </div>
        {roots.length > 0 ? (
          <ul className="flex min-h-0 flex-1 flex-col overflow-y-auto py-1">
            {roots.map((cat) => {
              const hasSubs = childrenOf(cat.id).length > 0;
              const isActive = active === cat.id;
              return (
                <li key={cat.id} className="flex min-h-7 flex-1">
                  <Link
                    to={categoryHref(lang, cat)}
                    onMouseEnter={() => (hasSubs ? open(cat.id) : scheduleClose())}
                    onFocus={() => (hasSubs ? open(cat.id) : setActive(null))}
                    aria-expanded={hasSubs ? isActive : undefined}
                    className={`group flex w-full items-center gap-2.5 px-3.5 text-sm font-semibold transition-colors duration-150 ${
                      isActive ? "bg-surface-tint text-action" : "text-text hover:bg-surface-tint hover:text-action"
                    }`}
                  >
                    <CategoryIcon icon={cat.icon} className={`size-[18px] shrink-0 group-hover:text-action ${isActive ? "text-action" : "text-text-muted"}`} />
                    <span className="min-w-0 flex-1 truncate">{name(cat)}</span>
                    {hasSubs ? <ChevronRightIcon aria-hidden="true" className="size-3.5 shrink-0 opacity-60 rtl:rotate-180" /> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-3.5 py-3 text-xs text-text-muted">{t("home.cats.empty")}</p>
        )}
      </aside>

      {activeNode && subs.length > 0 ? (
        <div
          role="region"
          aria-label={name(activeNode)}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          className="absolute inset-y-0 end-0 start-[258px] z-30 hidden overflow-y-auto rounded-lg border border-border bg-surface p-5 shadow-2 min-[1100px]:block"
        >
          {art?.mode === "background" ? (
            <img aria-hidden="true" src={artSrc(art.image_path)} alt="" decoding="async"
              className="pointer-events-none absolute inset-0 size-full object-cover opacity-[0.14]" />
          ) : null}
          <div className="relative mb-4 flex items-center justify-between gap-3 border-b border-border pb-3">
            <h2 className="flex items-center gap-2 text-base font-extrabold text-text">
              <CategoryIcon icon={activeNode.icon} className="size-5 text-action" />
              {name(activeNode)}
            </h2>
            <Link to={categoryHref(lang, activeNode)} className="inline-flex items-center gap-1 text-sm font-bold text-action hover:underline">
              {t("home.sections.viewAll")}
              <ChevronRightIcon aria-hidden="true" className="size-3.5 rtl:rotate-180" />
            </Link>
          </div>
          <div className="relative flex gap-5">
          <div className={`min-w-0 flex-1 gap-6 ${art?.mode === "corner" ? "columns-2 xl:columns-3" : "columns-3 xl:columns-4"}`}>
            {subs.map((sub) => {
              const leaves = childrenOf(sub.id);
              return (
                <div key={sub.id} className="mb-5 break-inside-avoid">
                  <Link to={categoryHref(lang, sub)} className="block text-sm font-extrabold text-text hover:text-action">
                    {name(sub)}
                  </Link>
                  {leaves.length > 0 ? (
                    <ul className="mt-1.5 space-y-1">
                      {leaves.slice(0, MAX_LEAVES).map((leaf) => (
                        <li key={leaf.id}>
                          <Link to={categoryHref(lang, leaf)} className="text-sm text-text-muted hover:text-action hover:underline">
                            {name(leaf)}
                          </Link>
                        </li>
                      ))}
                      {leaves.length > MAX_LEAVES ? (
                        <li>
                          <Link to={categoryHref(lang, sub)} className="text-xs font-bold text-action hover:underline">
                            {t("home.sections.viewAll")}
                          </Link>
                        </li>
                      ) : null}
                    </ul>
                  ) : null}
                </div>
              );
            })}
          </div>
          {art?.mode === "corner" ? (
            // the empty side of the panel: the admin's picture, optionally a link
            <div className="hidden w-52 shrink-0 self-end xl:block xl:w-60">
              {artLink ? (
                artLink.startsWith("/")
                  ? <Link to={artLink} className="block"><img src={artSrc(art.image_path)} alt={name(activeNode)} className="max-h-64 w-full object-contain" decoding="async" /></Link>
                  : <a href={artLink} className="block"><img src={artSrc(art.image_path)} alt={name(activeNode)} className="max-h-64 w-full object-contain" decoding="async" /></a>
              ) : (
                <img src={artSrc(art.image_path)} alt="" className="max-h-64 w-full object-contain" decoding="async" />
              )}
            </div>
          ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

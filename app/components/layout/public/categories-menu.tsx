/**
 * Categories mega-menu in the main nav (desktop; owner reference): the
 * trigger opens a dropdown panel BELOW the header — level-1 categories in
 * the first column; hovering one with children reveals the SECOND column
 * beside it; hovering a child reveals the third. Clicking any node
 * navigates. Side-by-side columns (no absolute flyouts — they get clipped
 * by the column scroller). Keyboard: rows focusable via hover/focus,
 * Escape closes, outside click closes. Mobile keeps the drawer list.
 *
 * Extracted from app/layouts/public.tsx — pure structural refactor, no
 * behavior change.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { CategoryNode } from "~/features/storefront/api";
import { CategoryIcon } from "~/components/catalog/CategoryIcon";
import { ChevronDownIcon, ChevronRightIcon, GridIcon } from "~/components/ui/icons";
import { categoryHref } from "./shared";

export function CategoriesMenu({ lang, categories }: { lang: string; categories: CategoryNode[] }) {
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
        className={`flex cursor-pointer items-center gap-1.5 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-semibold transition-colors duration-150 ${
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
                    to={categoryHref(lang, rootCat)}
                    onClick={() => setOpen(false)}
                    onMouseEnter={() => { setActiveRoot(rootCat.id); setActiveSub(null); }}
                    onFocus={() => { setActiveRoot(rootCat.id); setActiveSub(null); }}
                    className={`flex min-h-11 items-center justify-between gap-2 rounded-md px-3 text-sm font-bold transition-colors duration-150 ${
                      active ? "bg-surface-tint text-action" : "text-text hover:bg-surface-tint hover:text-action"
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <CategoryIcon icon={rootCat.icon} className={`size-5 shrink-0 ${active ? "text-action" : "text-text-muted"}`} />
                      <span className="truncate">{catName(rootCat)}</span>
                    </span>
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
                      to={categoryHref(lang, sub)}
                      onClick={() => setOpen(false)}
                      onMouseEnter={() => setActiveSub(sub.id)}
                      onFocus={() => setActiveSub(sub.id)}
                      className={`flex min-h-10 items-center justify-between gap-2 rounded-md px-3 text-sm font-semibold transition-colors duration-150 ${
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
                    to={categoryHref(lang, subSub)}
                    onClick={() => setOpen(false)}
                    className="flex min-h-10 items-center rounded-md px-3 text-sm text-text transition-colors duration-150 hover:bg-surface-tint hover:text-action"
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

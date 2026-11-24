import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { ChevronDownIcon, PlusIcon, CompareArrowsIcon, TrashIcon, XIcon } from "~/components/ui/icons";
import { MediaImg } from "~/components/catalog/MediaImg";
import { formatPiastres } from "~/lib/money";
import type { CompareItem } from "~/routes/api/compare-items";
// Layering exception: compare staging helpers are feature-owned logic; this
// bar reads them in place rather than duplicating them in components.
import { COMPARE_MAX, clearCompare, readCompare, toggleCompare } from "~/features/discovery/compare";

/**
 * Floating compare card (S-21 / US-13). Tapping it expands a list upward
 * with the staged products (picture, name, price, remove); with two it
 * links to /compare?ids=a,b. Listens for the card-level toggles.
 */
export function CompareBar() {
  const { t } = useTranslation();
  const params = useParams();
  const navigate = useNavigate();
  const lang = params.lang === "en" ? "en" : "ar";
  const [ids, setIds] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<CompareItem[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sync = () => setIds(readCompare());
    sync();
    window.addEventListener("etsawaa:compare", sync);
    return () => window.removeEventListener("etsawaa:compare", sync);
  }, []);

  // details for the expandable list (localStorage only holds ids)
  const key = ids.join(",");
  useEffect(() => {
    if (!key) { setItems([]); setOpen(false); return; }
    let live = true;
    fetch(`/api/compare-items?ids=${key}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d: { items: CompareItem[] }) => { if (live) setItems(d.items); })
      .catch(() => undefined);
    return () => { live = false; };
  }, [key]);

  // close on Escape / tap outside
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onDown = (e: PointerEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("pointerdown", onDown); };
  }, [open]);

  if (ids.length === 0) return null;

  const ready = ids.length >= 2;
  const notify = () => window.dispatchEvent(new CustomEvent("etsawaa:compare"));
  const nameOf = (p: CompareItem) => (lang === "ar" ? p.name_ar || p.name_en : p.name_en || p.name_ar);
  const slugOf = (p: CompareItem) => (lang === "ar" ? p.slug_ar || p.slug_en : p.slug_en || p.slug_ar);

  return (
    <>
      {/* in-flow spacer: reserves the card's height so the footer's last line
          is never covered. Rendered AFTER the footer and colored like it. */}
      <div aria-hidden="true" className="h-[88px] bg-footer" />
      {/* floating card above the page (and above the phone bottom bar,
          clearing its raised Home button — --bottom-nav-clear) */}
      <div
        ref={rootRef}
        role="region"
        aria-label={t("store.compare.bar")}
        className="fixed inset-x-3 bottom-[calc(var(--bottom-nav-h,0px)+var(--bottom-nav-clear,0px)+var(--buy-bar-h,0px)+12px)] z-40 mx-auto max-w-xl overflow-hidden rounded-xl border border-border bg-surface shadow-[0_8px_28px_rgb(0_0_0/0.16)]"
      >
        {/* expandable list — grows upward because the card is anchored to the bottom */}
        <div
          id="compare-list"
          className={`grid transition-[grid-template-rows] duration-200 ease-out ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
        >
          <div className="min-h-0 overflow-hidden">
            <ul className="max-h-[50dvh] divide-y divide-border overflow-y-auto border-b border-border">
              {items.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-3 py-2.5">
                  <Link to={`/${lang}/product/${encodeURIComponent(slugOf(p))}`} onClick={() => setOpen(false)} className="flex min-w-0 flex-1 items-center gap-3">
                    {p.image ? (
                      <MediaImg path={p.image} alt="" width={56} height={56} className="size-14 shrink-0 rounded-lg border border-border object-cover" />
                    ) : (
                      <span className="grid size-14 shrink-0 place-items-center rounded-lg bg-surface-tint text-2xs text-text-faint">{t("store.noImage")}</span>
                    )}
                    <span className="min-w-0">
                      <span className="line-clamp-2 text-sm font-bold text-text">{nameOf(p)}</span>
                      {p.price != null ? (
                        <span className="num mt-0.5 block text-sm font-black text-action">
                          {formatPiastres(p.sale_price ?? p.price, lang)}
                        </span>
                      ) : null}
                    </span>
                  </Link>
                  <button
                    type="button"
                    onClick={() => { toggleCompare(p.id); notify(); }}
                    aria-label={t("store.compare.remove")}
                    className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-text-muted transition-colors duration-150 hover:bg-danger-soft hover:text-danger"
                  >
                    <TrashIcon className="size-4" />
                  </button>
                </li>
              ))}
              {ids.length < COMPARE_MAX ? (
                <li>
                  <Link
                    to={`/${lang}/products`}
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-3 px-3 py-2.5 text-sm font-bold text-text-muted hover:text-action"
                  >
                    <span aria-hidden="true" className="grid size-14 shrink-0 place-items-center rounded-lg border-2 border-dashed border-border text-text-faint">
                      <PlusIcon />
                    </span>
                    {t("store.compare.pickSecond")}
                  </Link>
                </li>
              ) : null}
            </ul>
          </div>
        </div>

        <div className="flex items-center gap-2 p-2.5 ps-3">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="compare-list"
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg text-start"
          >
            <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-surface-tint text-action">
              <CompareArrowsIcon />
            </span>
            <span className="min-w-0 flex-1">
              <span className="num block truncate text-sm font-extrabold text-text">{t("store.compare.staged", { count: ids.length })}</span>
              <span className="block truncate text-xs text-text-muted">
                {open ? t("store.compare.hideList") : t("store.compare.showList")}
              </span>
            </span>
            <ChevronDownIcon aria-hidden="true" className={`size-5 shrink-0 text-text-muted transition-transform duration-200 ${open ? "" : "rotate-180"}`} />
          </button>
          <button
            type="button"
            onClick={() => { clearCompare(); notify(); }}
            aria-label={t("store.compare.clear")}
            className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-text-muted transition-colors duration-150 hover:bg-surface-tint hover:text-danger"
          >
            <XIcon className="size-4" />
          </button>
          {ready ? (
            <button
              type="button"
              onClick={() => void navigate(`/${lang}/compare?ids=${ids.join(",")}`)}
              className="flex min-h-10 shrink-0 cursor-pointer items-center rounded-lg bg-action px-4 text-sm font-extrabold text-on-action transition-colors duration-150 hover:bg-action-hover"
            >
              {t("store.compare.go")}
            </button>
          ) : null}
        </div>
      </div>
    </>
  );
}

/** Card-level compare toggle already lives in ProductCard; this re-export
 * keeps the staging contract in one place. */
export { toggleCompare };

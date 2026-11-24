import { useEffect, useId, useRef, useState } from "react";
import { Link, useFetcher, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { MediaImg } from "~/components/catalog/MediaImg";
import { SearchIcon } from "~/components/ui/icons";
import type { PanelProductSuggestion } from "~/routes/api/panel-product-suggest";

/**
 * Product search box of the admin / vendor product lists: as the user types (or
 * pastes a title in either language) a dropdown lists matching products with
 * their image, name and store; Enter on a highlighted row opens it. Without a
 * pick, the box still works as the list's normal `q` filter.
 */
export function PanelProductSearch({ name = "q", defaultValue = "", placeholder, hrefFor, lang, className = "" }: {
  name?: string;
  defaultValue?: string;
  placeholder: string;
  hrefFor: (id: string) => string;
  lang: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const en = lang === "en";
  const listId = useId();
  const navigate = useNavigate();
  const fetcher = useFetcher<{ items: PanelProductSuggestion[] }>();
  const [text, setText] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const box = useRef<HTMLDivElement>(null);
  const items = text.trim().length >= 2 ? fetcher.data?.items ?? [] : [];

  // debounced lookup
  useEffect(() => {
    const q = text.trim();
    if (q.length < 2) return;
    const id = window.setTimeout(() => fetcher.load(`/api/panel-product-suggest?q=${encodeURIComponent(q)}`), 250);
    return () => window.clearTimeout(id);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setActive(-1), [fetcher.data]);
  // close on an outside click
  useEffect(() => {
    const onDown = (e: PointerEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);

  const label = (p: PanelProductSuggestion) => (en ? p.name_en || p.name_ar : p.name_ar || p.name_en);
  const store = (p: PanelProductSuggestion) => (en ? p.store_en || p.store_ar : p.store_ar || p.store_en);
  const show = open && text.trim().length >= 2 && (items.length > 0 || fetcher.state === "idle");

  return (
    <div ref={box} className={`relative ${className}`}>
      <label className="relative block">
        <span className="sr-only">{placeholder}</span>
        <SearchIcon aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-text-faint" />
        <input
          type="search"
          name={name}
          value={text}
          autoComplete="off"
          role="combobox"
          aria-expanded={show}
          aria-controls={listId}
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          placeholder={placeholder}
          onChange={(e) => { setText(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (!show || !items.length) return;
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => (i + 1) % items.length); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => (i <= 0 ? items.length - 1 : i - 1)); }
            else if (e.key === "Escape") setOpen(false);
            else if (e.key === "Enter" && active >= 0) { e.preventDefault(); setOpen(false); navigate(hrefFor(items[active]!.id)); }
          }}
          className="h-10 w-full rounded-md border border-border bg-surface ps-9 pe-3 text-base outline-none transition-shadow focus:border-primary focus:shadow-focus sm:text-sm"
        />
      </label>
      {show ? (
        <ul id={listId} role="listbox" className="absolute inset-x-0 top-full z-30 mt-1 max-h-96 overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-3">
          {items.length === 0 ? (
            <li className="px-3 py-3 text-sm text-text-muted">{t("panelSearch.none")}</li>
          ) : items.map((p, i) => (
            <li key={p.id} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
              <Link to={hrefFor(p.id)} onClick={() => setOpen(false)} onMouseEnter={() => setActive(i)}
                className={`flex items-center gap-3 rounded-md px-2 py-1.5 ${i === active ? "bg-surface-tint" : "hover:bg-surface-tint"}`}>
                <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-surface-tint">
                  {p.image ? <MediaImg path={p.image} alt="" width={44} height={44} className="size-full object-cover" /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-1 text-sm font-bold text-text">{label(p) || "—"}</span>
                  <span className="line-clamp-1 text-2xs text-text-muted">
                    {[store(p), t(`vendorStates.status.${p.status}`)].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

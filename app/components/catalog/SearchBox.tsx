import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { SearchIcon, StoreIcon } from "~/components/ui/icons";

interface Suggestions {
  products: Array<{ id: string; slug_ar: string; slug_en: string; name_ar: string; name_en: string; main_image_path: string | null; price_piastres: number | null }>;
  stores: Array<{ slug: string; name_ar: string; name_en: string; logo_path: string | null }>;
  categories: Array<{ slug_ar: string; slug_en: string; name_ar: string; name_en: string; depth: number }>;
}

const EMPTY: Suggestions = { products: [], stores: [], categories: [] };

/**
 * Header search (S-04 / US-04): instant suggestions under the input
 * (products/stores/categories), Enter submits to /search. Arabic
 * normalization happens server-side; the input just debounces.
 */
export function SearchBox({ lang, compact = false }: { lang: string; compact?: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Suggestions>(EMPTY);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const onChange = (value: string) => {
    setQ(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    const trimmed = value.trim();
    if (trimmed.length < 2) {
      setItems(EMPTY);
      setOpen(false);
      return;
    }
    setLoading(true);
    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search-suggest?q=${encodeURIComponent(trimmed)}`);
        const body = (await res.json()) as Suggestions;
        setItems({ products: body.products ?? [], stores: body.stores ?? [], categories: body.categories ?? [] });
        setOpen(true);
      } catch {
        setItems(EMPTY);
      } finally {
        setLoading(false);
      }
    }, 250);
  };

  const submit = () => {
    const trimmed = q.trim();
    if (trimmed.length === 0) return;
    setOpen(false);
    void navigate(`/${lang}/search?q=${encodeURIComponent(trimmed)}`);
  };

  const hasAny = items.products.length > 0 || items.stores.length > 0 || items.categories.length > 0;

  return (
    <div ref={boxRef} className={`relative ${compact ? "w-full" : "min-w-0 flex-1"}`}>
      <div className="flex items-center overflow-hidden rounded-m border-2 border-primary bg-surface focus-within:shadow-focus">
        <SearchIcon aria-hidden="true" className="ms-3 shrink-0 text-text-faint" />
        <input
          type="search"
          value={q}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => q.trim().length >= 2 && hasAny && setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") setOpen(false);
          }}
          placeholder={t("errors.searchPlaceholder")}
          aria-label={t("errors.searchPlaceholder")}
          aria-expanded={open}
          aria-controls="search-suggestions"
          role="combobox"
          aria-autocomplete="list"
          maxLength={80}
          className="min-w-0 flex-1 border-none bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-text-faint"
        />
        <button
          type="button"
          onClick={submit}
          className="flex shrink-0 cursor-pointer items-center gap-1.5 bg-action px-3.5 py-2.5 text-[13px] font-bold text-on-action transition-colors duration-150 hover:bg-action-hover"
        >
          <SearchIcon aria-hidden="true" />
          <span className="hidden lg:inline">{t("common.search")}</span>
        </button>
      </div>

      {open ? (
        <div
          id="search-suggestions"
          role="listbox"
          aria-label={t("store.search.suggestions")}
          className="absolute inset-x-0 top-full z-50 mt-1 max-h-[70vh] overflow-y-auto rounded-m border border-border bg-surface shadow-2"
        >
          {loading ? (
            <p className="px-4 py-3 text-[13px] text-text-muted" role="status">{t("common.loading")}</p>
          ) : !hasAny ? (
            <p className="px-4 py-3 text-[13px] text-text-muted">{t("store.search.noSuggestions")}</p>
          ) : (
            <>
              {items.products.length > 0 ? (
                <SuggestGroup title={t("store.search.products")}>
                  {items.products.map((p) => (
                    <SuggestItem key={p.id} to={`/${lang}/product/${encodeURIComponent(lang === "en" ? p.slug_en || p.slug_ar : p.slug_ar || p.slug_en)}`} onPick={() => setOpen(false)}>
                      <span className="truncate font-bold">{lang === "ar" ? p.name_ar || p.name_en : p.name_en || p.name_ar}</span>
                    </SuggestItem>
                  ))}
                </SuggestGroup>
              ) : null}
              {items.categories.length > 0 ? (
                <SuggestGroup title={t("store.search.categories")}>
                  {items.categories.map((c) => (
                    <SuggestItem key={c.slug_en} to={`/${lang}/category/${encodeURIComponent(lang === "en" ? c.slug_en || c.slug_ar : c.slug_ar || c.slug_en)}`} onPick={() => setOpen(false)}>
                      <span className="truncate font-bold">{lang === "ar" ? c.name_ar : c.name_en}</span>
                      <span className="text-[11px] text-text-faint">{t("store.search.categoryDepth", { depth: c.depth })}</span>
                    </SuggestItem>
                  ))}
                </SuggestGroup>
              ) : null}
              {items.stores.length > 0 ? (
                <SuggestGroup title={t("store.search.stores")}>
                  {items.stores.map((s) => (
                    <SuggestItem key={s.slug} to={`/${lang}/store/${encodeURIComponent(s.slug)}`} onPick={() => setOpen(false)}>
                      <StoreIcon aria-hidden="true" className="shrink-0 text-text-faint" />
                      <span className="truncate font-bold">{lang === "ar" ? s.name_ar || s.name_en : s.name_en || s.name_ar}</span>
                    </SuggestItem>
                  ))}
                </SuggestGroup>
              ) : null}
            </>
          )}
          {q.trim().length >= 2 ? (
            <Link
              to={`/${lang}/search?q=${encodeURIComponent(q.trim())}`}
              onClick={() => setOpen(false)}
              className="block border-t border-border px-4 py-2.5 text-[13px] font-extrabold text-action hover:bg-surface-tint"
            >
              {t("store.search.seeAll")} "{q.trim()}"
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SuggestGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="py-1">
      <p className="px-4 pb-1 pt-2 text-[11px] font-extrabold uppercase tracking-wide text-text-faint">{title}</p>
      {children}
    </div>
  );
}

function SuggestItem({ to, onPick, children }: { to: string; onPick: () => void; children: React.ReactNode }) {
  return (
    <Link
      role="option"
      to={to}
      onClick={onPick}
      className="flex items-center gap-2 px-4 py-2 text-[13px] text-text transition-colors duration-150 hover:bg-surface-tint hover:text-action"
    >
      {children}
    </Link>
  );
}

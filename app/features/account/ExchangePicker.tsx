import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatPiastres } from "~/lib/money";
import { MediaImg } from "~/components/catalog/MediaImg";
import { MinusIcon, PlusIcon, SearchIcon, SpinnerIcon, TrashIcon } from "~/components/ui/icons";
import type { ExchangeProduct, ExchangeVariant } from "~/routes/api/exchange-options";

/** One replacement the customer picked (today's price; the server recomputes). */
export interface PickedReplacement {
  variant_id: string;
  product_id: string;
  name_ar: string;
  name_en: string;
  label_ar: string | null;
  label_en: string | null;
  unit_piastres: number;
  stock: number;
  qty: number;
}

/**
 * Picks the replacement products of an exchange.
 *  - same_product: the returned products' sellable options, shown at once
 *  - other_products: a name search across the store
 * Each pick has a quantity (up to its stock, at most 20).
 */
export function ExchangePicker({ mode, productIds, value, onChange }: {
  mode: "same_product" | "other_products";
  productIds: string[];
  value: PickedReplacement[];
  onChange: (next: PickedReplacement[]) => void;
}) {
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const money = (p: number) => formatPiastres(p, en ? "en" : "ar");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ExchangeProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  const idsKey = productIds.join(",");
  useEffect(() => {
    const q = query.trim();
    const params = new URLSearchParams();
    if (mode === "same_product") {
      if (!idsKey) { setResults([]); return; }
      params.set("products", idsKey);
    } else {
      if (q.length < 2) { setResults([]); return; }
      params.set("q", q);
    }
    const mine = ++seq.current;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/exchange-options?${params.toString()}`);
        const json = (await res.json()) as { products?: ExchangeProduct[] };
        if (mine === seq.current) setResults(json.products ?? []);
      } catch {
        if (mine === seq.current) setResults([]);
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, mode === "same_product" ? 0 : 300);
    return () => clearTimeout(timer);
  }, [mode, idsKey, query]);

  const picked = (id: string) => value.find((v) => v.variant_id === id);
  const toggle = (p: ExchangeProduct, v: ExchangeVariant) => {
    if (picked(v.id)) { onChange(value.filter((x) => x.variant_id !== v.id)); return; }
    if (value.length >= 10) return;
    onChange([...value, {
      variant_id: v.id, product_id: p.id, name_ar: p.name_ar, name_en: p.name_en,
      label_ar: v.label_ar, label_en: v.label_en, unit_piastres: v.unit_piastres, stock: v.stock, qty: 1,
    }]);
  };
  const setQty = (id: string, qty: number) =>
    onChange(value.map((x) => (x.variant_id === id ? { ...x, qty: Math.max(1, Math.min(qty, x.stock, 20)) } : x)));

  return (
    <div className="flex flex-col gap-3">
      {mode === "other_products" ? (
        <label className="relative block">
          <span className="sr-only">{t("exchange.searchLabel")}</span>
          <SearchIcon aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-text-faint" />
          <input
            type="search" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder={t("exchange.searchPlaceholder")}
            className="w-full rounded-md border border-border bg-surface py-2.5 pe-3 ps-9 text-sm text-text outline-none focus:border-primary focus:shadow-focus"
          />
        </label>
      ) : null}

      {loading ? (
        <p className="flex items-center gap-2 text-xs text-text-muted"><SpinnerIcon aria-hidden="true" className="size-4 animate-spin" />{t("exchange.loading")}</p>
      ) : results.length === 0 ? (
        <p className="text-xs text-text-muted">
          {mode === "same_product" ? t("exchange.noOptions") : query.trim().length < 2 ? t("exchange.typeToSearch") : t("exchange.noResults")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {results.map((p) => (
            <li key={p.id} className="rounded-md border border-border bg-surface p-3">
              <div className="flex items-center gap-3">
                <span className="size-12 shrink-0 overflow-hidden rounded-md border border-border bg-surface-alt">
                  {p.main_image_path ? <MediaImg path={p.main_image_path} alt="" width={96} height={96} className="size-full object-contain" /> : null}
                </span>
                <div className="min-w-0">
                  <p className="line-clamp-2 text-sm font-bold text-text">{en ? p.name_en || p.name_ar : p.name_ar || p.name_en}</p>
                  <p className="truncate text-xs text-text-muted">{en ? p.store_name_en : p.store_name_ar}</p>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {p.variants.map((v) => {
                  const on = Boolean(picked(v.id));
                  const label = (en ? v.label_en : v.label_ar) || t("exchange.defaultOption");
                  return (
                    <button
                      key={v.id} type="button" aria-pressed={on} onClick={() => toggle(p, v)}
                      className={`flex min-h-9 items-center gap-1.5 rounded-md border px-2.5 text-xs font-bold transition-colors duration-150 ${
                        on ? "border-action bg-action text-on-action" : "border-border bg-surface text-text hover:border-action"
                      }`}
                    >
                      <span>{label}</span>
                      <span className="num opacity-80" dir="ltr">{money(v.unit_piastres)}</span>
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      )}

      {value.length > 0 ? (
        <div className="rounded-md border border-action/40 bg-surface-tint p-3">
          <p className="text-xs font-extrabold text-text">{t("exchange.picked", { count: value.length })}</p>
          <ul className="mt-2 flex flex-col gap-2">
            {value.map((x) => (
              <li key={x.variant_id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold text-text">{en ? x.name_en || x.name_ar : x.name_ar || x.name_en}</span>
                  <span className="block text-xs text-text-muted">
                    {(en ? x.label_en : x.label_ar) || t("exchange.defaultOption")} · <span className="num" dir="ltr">{money(x.unit_piastres)}</span>
                  </span>
                </span>
                <span className="flex items-center gap-1">
                  <button type="button" aria-label={t("exchange.less")} onClick={() => setQty(x.variant_id, x.qty - 1)}
                    className="grid size-8 place-items-center rounded-md border border-border bg-surface text-text hover:border-action">
                    <MinusIcon aria-hidden="true" className="size-3.5" />
                  </button>
                  <span className="num w-7 text-center font-bold" aria-live="polite">{x.qty}</span>
                  <button type="button" aria-label={t("exchange.more")} onClick={() => setQty(x.variant_id, x.qty + 1)}
                    className="grid size-8 place-items-center rounded-md border border-border bg-surface text-text hover:border-action">
                    <PlusIcon aria-hidden="true" className="size-3.5" />
                  </button>
                  <button type="button" aria-label={t("exchange.remove")} onClick={() => onChange(value.filter((y) => y.variant_id !== x.variant_id))}
                    className="grid size-8 place-items-center rounded-md text-danger hover:bg-danger/10">
                    <TrashIcon aria-hidden="true" className="size-4" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

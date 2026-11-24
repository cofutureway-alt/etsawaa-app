import { useState } from "react";
import { useTranslation } from "react-i18next";
import { formatPiastres } from "~/lib/money";
import type { SearchFacets } from "~/features/storefront/api";
import { ChevronDownIcon, XIcon } from "~/components/ui/icons";
import { SelectMenu, type SelectMenuOption } from "~/components/ui/SelectMenu";
import { MediaImg } from "./MediaImg";

/**
 * Facet sidebar (S-03 / US-03): category, brand, attributes (of the current
 * category only), rating, in-stock, price — counts per option, chips row
 * with remove buttons, clear-all. URL state lives in the route; this panel
 * is a controlled view.
 */

export interface FilterState {
  category: string | null;
  brand: string | null;
  attrs: Array<{ attribute_id: string; option_ids: string[] }>;
  priceMin: number | null;
  priceMax: number | null;
  rating: number | null;
  inStock: boolean;
  sort: string;
  page: number;
  q: string;
  /** random-order seed for the "recommended" sort (stable across pages) */
  seed?: string;
}

export interface FacetDef {
  attribute_id: string;
  code: string;
  label_ar: string;
  label_en: string;
  type: string;
  unit: string;
}

interface Props {
  facets: SearchFacets;
  defs: FacetDef[];
  state: FilterState;
  lang: "ar" | "en";
  /** hide the category facet (fixed inside a category page) */
  hideCategory?: boolean;
  onChange: (patch: Partial<FilterState>) => void;
  onClearAll: () => void;
}

export function FacetPanel({ facets, defs, state, lang, hideCategory = false, onChange, onClearAll }: Props) {
  const { t } = useTranslation();
  const [priceDraft, setPriceDraft] = useState({
    min: state.priceMin != null ? String(state.priceMin / 100) : "",
    max: state.priceMax != null ? String(state.priceMax / 100) : "",
  });

  // group attribute facet rows by attribute
  const groups = new Map<string, { def: FacetDef; options: Array<{ option_id: string; label: string; color_hex: string | null; count: number }> }>();
  for (const def of defs) groups.set(def.attribute_id, { def, options: [] });
  for (const row of facets.attributes) {
    const group = groups.get(row.attribute_id);
    if (!group) continue;
    group.options.push({
      option_id: row.option_id,
      label: lang === "ar" ? row.option_label_ar || row.option_label_en : row.option_label_en || row.option_label_ar,
      color_hex: row.color_hex,
      count: row.count,
    });
  }
  const visibleGroups = [...groups.entries()].filter(([, g]) => g.options.length > 0);

  const selectedCount = (attributeId: string): string[] =>
    state.attrs.find((a) => a.attribute_id === attributeId)?.option_ids ?? [];

  const toggleOption = (attributeId: string, optionId: string) => {
    const current = state.attrs.find((a) => a.attribute_id === attributeId)?.option_ids ?? [];
    const next = current.includes(optionId) ? current.filter((id) => id !== optionId) : [...current, optionId];
    const attrs = next.length > 0
      ? [...state.attrs.filter((a) => a.attribute_id !== attributeId), { attribute_id: attributeId, option_ids: next }]
      : state.attrs.filter((a) => a.attribute_id !== attributeId);
    onChange({ attrs, page: 1 });
  };

  const applyPrice = () => {
    const min = Math.round(Number(priceDraft.min) * 100);
    const max = Math.round(Number(priceDraft.max) * 100);
    onChange({
      priceMin: priceDraft.min && Number.isFinite(min) && min > 0 ? min : null,
      priceMax: priceDraft.max && Number.isFinite(max) && max > 0 ? max : null,
      page: 1,
    });
  };

  const brandLabel = (id: string | null): string => {
    const brand = facets.brands.find((b) => b.id === id);
    if (!brand) return id ?? "";
    return (lang === "ar" ? brand.name_ar || brand.name_en : brand.name_en || brand.name_ar) ?? "";
  };

  // one searchable dropdown instead of a 12-row checkbox list: the catalogue
  // carries hundreds of brands, and both names must match the typed query
  const brandOptions: SelectMenuOption[] = [
    { value: "", label: t("store.filters.allBrands"), keywords: "all brands كل الماركات" },
    ...facets.brands.flatMap((b) => {
      if (!b.id) return [];
      return [{
        value: b.id,
        label: `${(lang === "ar" ? b.name_ar || b.name_en : b.name_en || b.name_ar) ?? ""} (${b.count})`,
        keywords: `${b.name_ar ?? ""} ${b.name_en ?? ""}`,
        icon: b.thumb_path
          ? <MediaImg path={b.thumb_path} alt="" width={24} height={24} className="size-6 object-contain" />
          : undefined,
      }];
    }),
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* chips */}
      {(() => {
        const chips: Array<{ key: string; label: string; clear: Partial<FilterState> }> = [];
        if (state.q) chips.push({ key: "q", label: `"${state.q}"`, clear: { q: "", page: 1 } });
        if (state.brand) chips.push({ key: "brand", label: brandLabel(state.brand), clear: { brand: null, page: 1 } });
        for (const group of visibleGroups) {
          for (const optionId of selectedCount(group[0])) {
            const option = group[1].options.find((o) => o.option_id === optionId);
            if (!option) continue;
            chips.push({
              key: `${group[0]}-${optionId}`,
              label: `${lang === "ar" ? group[1].def.label_ar : group[1].def.label_en}: ${option.label}`,
              clear: {
                attrs: state.attrs
                  .map((a) =>
                    a.attribute_id === group[0]
                      ? { ...a, option_ids: a.option_ids.filter((x) => x !== optionId) }
                      : a,
                  )
                  .filter((a) => a.option_ids.length > 0),
                page: 1,
              },
            });
          }
        }
        if (state.rating != null) chips.push({ key: "rating", label: t("store.filters.ratingMin", { count: state.rating }), clear: { rating: null, page: 1 } });
        if (state.inStock) chips.push({ key: "stock", label: t("store.filters.inStock"), clear: { inStock: false, page: 1 } });
        if (state.priceMin != null) chips.push({ key: "pmin", label: `${t("store.filters.priceFrom")} ${formatPiastres(state.priceMin, lang)}`, clear: { priceMin: null, page: 1 } });
        if (state.priceMax != null) chips.push({ key: "pmax", label: `${t("store.filters.priceTo")} ${formatPiastres(state.priceMax, lang)}`, clear: { priceMax: null, page: 1 } });

        if (chips.length === 0) return null;
        return (
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t("store.filters.active")}>
            {chips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                onClick={() => onChange(chip.clear)}
                className="flex cursor-pointer items-center gap-1 rounded-full border border-border bg-surface-tint px-2.5 py-1 text-xs font-bold text-text transition-colors duration-150 hover:border-action hover:text-action"
              >
                {chip.label}
                <XIcon aria-hidden="true" className="size-3" />
              </button>
            ))}
            <button
              type="button"
              onClick={onClearAll}
              className="cursor-pointer px-2 py-1 text-xs font-extrabold text-action hover:underline"
            >
              {t("store.filters.clearAll")}
            </button>
          </div>
        );
      })()}

      {/* categories */}
      {!hideCategory && facets.categories.length > 0 ? (
        <FacetSection title={t("store.filters.categories")}>
          <ul className="flex flex-col gap-1">
            {facets.categories.filter((c) => c.count > 0).map((c) => {
              const label = lang === "ar" ? c.name_ar : c.name_en;
              const selected = state.category === c.id;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onChange({ category: selected ? null : c.id, page: 1 })}
                    aria-pressed={selected}
                    className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm transition-colors duration-150 ${
                      selected ? "bg-surface-tint font-extrabold text-action" : "text-text hover:bg-surface-tint"
                    }`}
                  >
                    <span className="truncate">{label}</span>
                    <span className="num text-2xs text-text-muted">{c.count}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </FacetSection>
      ) : null}

      {/* brands */}
      {facets.brands.length > 0 ? (
        <FacetSection title={t("store.filters.brands")}>
          <SelectMenu
            label={<span className="sr-only">{t("store.filters.brands")}</span>}
            options={brandOptions}
            value={state.brand ?? ""}
            placeholder={t("store.filters.allBrands")}
            onChange={(value) => onChange({ brand: value || null, page: 1 })}
            searchable
          />
        </FacetSection>
      ) : null}

      {/* attribute facets (current category only — US-03): colours as swatches,
          short values (sizes…) as chips, long values as a compact list */}
      {visibleGroups.map(([attributeId, group]) => {
        const chosen = selectedCount(attributeId);
        // an option nobody can match is noise — keep it only while it is selected
        const options = group.options.filter((o) => o.count > 0 || chosen.includes(o.option_id));
        if (options.length === 0) return null;
        const title = lang === "ar" ? group.def.label_ar : group.def.label_en;
        return (
          <FacetSection key={attributeId} title={title} badge={chosen.length || undefined}>
            {group.def.type === "color" ? (
              <ul className="flex flex-wrap gap-2 px-1">
                {options.map((option) => {
                  const selected = chosen.includes(option.option_id);
                  return (
                    <li key={option.option_id}>
                      <button
                        type="button"
                        onClick={() => toggleOption(attributeId, option.option_id)}
                        aria-pressed={selected}
                        aria-label={`${option.label} (${option.count})`}
                        title={`${option.label} (${option.count})`}
                        className={`flex size-8 cursor-pointer items-center justify-center rounded-full transition-shadow duration-150 ${
                          selected ? "shadow-[0_0_0_2px_var(--color-surface),0_0_0_4px_var(--color-action)]" : "hover:shadow-[0_0_0_2px_var(--color-surface),0_0_0_4px_var(--color-border-strong)]"
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className="size-7 rounded-full border border-black/10"
                          style={option.color_hex ? { backgroundColor: option.color_hex } : { background: "conic-gradient(#e53935,#fdd835,#43a047,#1e88e5,#8e24aa,#e53935)" }}
                        />
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : options.every((o) => o.label.length <= 10) ? (
              <ul className="flex flex-wrap gap-1.5 px-1">
                {options.map((option) => {
                  const selected = chosen.includes(option.option_id);
                  return (
                    <li key={option.option_id}>
                      <button
                        type="button"
                        onClick={() => toggleOption(attributeId, option.option_id)}
                        aria-pressed={selected}
                        title={`${option.label} (${option.count})`}
                        className={`min-w-10 cursor-pointer rounded-md border px-2.5 py-1.5 text-xs font-bold transition-colors duration-150 ${
                          selected ? "border-action bg-action text-on-action" : "border-border bg-surface text-text hover:border-action hover:text-action"
                        }`}
                      >
                        {option.label}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <OptionList
                options={options}
                isSelected={(id) => chosen.includes(id)}
                onToggle={(id) => toggleOption(attributeId, id)}
              />
            )}
          </FacetSection>
        );
      })}

      {/* rating */}
      <FacetSection title={t("store.filters.rating")}>
        <ul className="flex flex-col gap-1">
          {[4, 3, 2].map((min) => {
            const selected = state.rating === min;
            return (
              <li key={min}>
                <label className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors duration-150 ${selected ? "font-extrabold text-action" : "text-text hover:bg-surface-tint"}`}>
                  <input
                    type="radio"
                    name="facet-rating"
                    checked={selected}
                    onChange={() => onChange({ rating: selected ? null : min, page: 1 })}
                    className="accent-[var(--color-action)]"
                  />
                  {t("store.filters.ratingMin", { count: min })}
                </label>
              </li>
            );
          })}
        </ul>
      </FacetSection>

      {/* price */}
      <FacetSection title={t("store.filters.price")}>
        <div className="flex items-center gap-2 px-1">
          <label className="min-w-0 flex-1">
            <span className="sr-only">{t("store.filters.priceFrom")}</span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              value={priceDraft.min}
              onChange={(e) => setPriceDraft((d) => ({ ...d, min: e.target.value }))}
              placeholder={t("store.filters.priceFrom")}
              className="w-full rounded-md border border-border bg-surface px-2 py-2 text-sm outline-none focus:border-action"
            />
          </label>
          <span aria-hidden="true" className="text-text-faint">–</span>
          <label className="min-w-0 flex-1">
            <span className="sr-only">{t("store.filters.priceTo")}</span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              value={priceDraft.max}
              onChange={(e) => setPriceDraft((d) => ({ ...d, max: e.target.value }))}
              placeholder={t("store.filters.priceTo")}
              className="w-full rounded-md border border-border bg-surface px-2 py-2 text-sm outline-none focus:border-action"
            />
          </label>
        </div>
        <button
          type="button"
          onClick={applyPrice}
          className="mx-1 mt-2 w-[calc(100%-8px)] cursor-pointer rounded-md border border-border bg-surface px-3 py-2 text-sm font-bold text-text transition-colors duration-150 hover:bg-surface-tint hover:text-action"
        >
          {t("store.filters.applyPrice")}
        </button>
      </FacetSection>

      {/* in stock */}
      <label className="flex cursor-pointer items-center gap-2 px-2 text-sm font-bold text-text">
        <input
          type="checkbox"
          checked={state.inStock}
          onChange={() => onChange({ inStock: !state.inStock, page: 1 })}
          className="accent-[var(--color-action)]"
        />
        {t("store.filters.inStock")}
      </label>
    </div>
  );
}

function FacetSection({ title, badge, children }: { title: string; badge?: number; children: React.ReactNode }) {
  return (
    <details open className="group border-b border-border pb-4 last:border-b-0">
      <summary className="mb-2.5 flex cursor-pointer list-none items-center justify-between gap-2 px-1 text-sm font-extrabold text-text [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-1.5">
          {title}
          {badge ? <span className="num rounded-full bg-action px-1.5 text-2xs text-on-action">{badge}</span> : null}
        </span>
        <ChevronDownIcon aria-hidden="true" className="size-4 text-text-muted transition-transform duration-150 group-open:rotate-180" />
      </summary>
      {children}
    </details>
  );
}

/** Long option labels: a checkbox list, first 6 shown, the rest behind "show more". */
function OptionList({ options, isSelected, onToggle }: {
  options: Array<{ option_id: string; label: string; count: number }>;
  isSelected: (id: string) => boolean;
  onToggle: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [all, setAll] = useState(false);
  const shown = all ? options : options.slice(0, 6);
  return (
    <>
      <ul className="flex flex-col gap-0.5">
        {shown.map((option) => {
          const selected = isSelected(option.option_id);
          return (
            <li key={option.option_id}>
              <label className={`flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm transition-colors duration-150 ${selected ? "font-extrabold text-action" : "text-text hover:bg-surface-tint"}`}>
                <span className="flex min-w-0 items-center gap-2">
                  <input type="checkbox" checked={selected} onChange={() => onToggle(option.option_id)} className="size-4 accent-[var(--color-action)]" />
                  <span className="truncate">{option.label}</span>
                </span>
                <span className="num text-2xs text-text-muted">{option.count}</span>
              </label>
            </li>
          );
        })}
      </ul>
      {options.length > 6 ? (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-1 cursor-pointer px-2 text-xs font-bold text-action hover:underline">
          {all ? t("store.filters.showLess") : t("store.filters.showMore", { count: options.length - 6 })}
        </button>
      ) : null}
    </>
  );
}

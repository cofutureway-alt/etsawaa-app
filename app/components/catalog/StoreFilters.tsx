import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/Button";
import { Drawer } from "~/components/ui/Overlay";
import { FilterIcon, XIcon } from "~/components/ui/icons";
// Layering exception: store filter state/query helpers are feature-owned
// logic; this rail consumes them in place rather than duplicating them in
// components.
import {
  buildStoreQuery,
  storeFilterCount,
  STORE_SORTS,
  type StoreFilterState,
  type StoreSort,
} from "~/features/storefront/store-filters";

export interface StoreCategoryOption {
  id: string;
  name_ar: string | null;
  name_en: string | null;
  count: number;
}

/**
 * Store-page filter rail.
 *
 * Same shape as the catalog listing (sidebar on desktop, drawer on phones, URL
 * carries the state so Back restores it), but scoped to one vendor: the
 * categories offered are the ones this store actually sells in, and "on
 * offer" is a real comparison rather than a flag guess.
 */
export function StoreFilters({
  basePath,
  state,
  categories,
  lang,
  priceBounds,
  resultCount,
}: {
  basePath: string;
  state: StoreFilterState;
  categories: StoreCategoryOption[];
  lang: string;
  priceBounds: { min: number; max: number };
  resultCount: number;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const active = storeFilterCount(state);

  const go = (patch: Partial<StoreFilterState>) => {
    // any change resets to page 1 — a filter that lands on an empty page 4
    // reads as "no results" when there are plenty
    navigate(`${basePath}${buildStoreQuery({ ...state, ...patch, page: 1 })}`);
  };

  const clearAll = () => navigate(basePath);

  const panel = (
    <StoreFilterPanel
      state={state}
      categories={categories}
      lang={lang}
      priceBounds={priceBounds}
      onChange={go}
      onClearAll={clearAll}
      active={active}
    />
  );

  return (
    <>
      {/* return the number of results to the caller without lifting state */}
      <span className="sr-only" aria-live="polite">
        {t("store.listing.count", { count: resultCount })}
      </span>

      <aside
        aria-label={t("store.filters.title")}
        className="hidden self-start rounded-lg border border-border bg-surface p-3 lg:block"
      >
        {panel}
      </aside>

      <div className="flex items-center justify-between gap-2 lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          className="flex min-h-10 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm font-bold text-text transition-colors duration-150 hover:bg-surface-tint"
        >
          <FilterIcon aria-hidden="true" className="size-4" />
          {t("store.filters.title")}
          {active > 0 ? (
            <span className="num rounded-full bg-action px-1.5 text-2xs font-black text-on-action">{active}</span>
          ) : null}
        </button>
        {active > 0 ? (
          <button
            type="button"
            onClick={clearAll}
            className="cursor-pointer text-xs font-extrabold text-action hover:underline"
          >
            {t("store.filters.clearAll")}
          </button>
        ) : null}
      </div>

      <Drawer open={open} onClose={() => setOpen(false)} title={t("store.filters.title")}>
        {panel}
        <Button type="button" block className="mt-4" onClick={() => setOpen(false)}>
          {t("store.filters.showResults")}
        </Button>
      </Drawer>
    </>
  );
}

function StoreFilterPanel({
  state,
  categories,
  lang,
  priceBounds,
  onChange,
  onClearAll,
  active,
}: {
  state: StoreFilterState;
  categories: StoreCategoryOption[];
  lang: string;
  priceBounds: { min: number; max: number };
  onChange: (patch: Partial<StoreFilterState>) => void;
  onClearAll: () => void;
  active: number;
}) {
  const { t } = useTranslation();
  // Local draft so typing a price does not fire a navigation per keystroke.
  const [min, setMin] = useState(state.priceMin != null ? String(state.priceMin / 100) : "");
  const [max, setMax] = useState(state.priceMax != null ? String(state.priceMax / 100) : "");

  const toPiastres = (raw: string) => {
    const n = Math.round(Number(raw) * 100);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 px-1 text-sm font-extrabold text-text">
          <FilterIcon aria-hidden="true" className="size-4" />
          {t("store.filters.title")}
        </h2>
        {active > 0 ? (
          <button
            type="button"
            onClick={() => {
              setMin("");
              setMax("");
              onClearAll();
            }}
            className="flex cursor-pointer items-center gap-1 text-2xs font-extrabold text-action hover:underline"
          >
            <XIcon className="size-3" />
            {t("store.filters.clearAll")}
          </button>
        ) : null}
      </div>

      {/* Category — only what this store actually sells */}
      {categories.length > 1 ? (
        <Group title={t("store.filters.category")}>
          <ul className="flex flex-col">
            <li>
              <Row
                active={state.category === null}
                onClick={() => onChange({ category: null })}
                label={t("store.vendor.filterAll")}
              />
            </li>
            {categories.map((cat) => (
              <li key={cat.id}>
                <Row
                  active={state.category === cat.id}
                  onClick={() => onChange({ category: state.category === cat.id ? null : cat.id })}
                  label={(lang === "ar" ? cat.name_ar : cat.name_en) ?? ""}
                  count={cat.count}
                />
              </li>
            ))}
          </ul>
        </Group>
      ) : null}

      {/* Price */}
      <Group title={t("store.filters.price")}>
        <div className="flex items-center gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-2xs font-bold text-text-muted">{t("store.filters.priceFrom")}</span>
            <input
              type="number"
              min={0}
              inputMode="numeric"
              value={min}
              onChange={(e) => setMin(e.target.value)}
              placeholder={String(Math.floor(priceBounds.min / 100))}
              className="num w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-text outline-none focus:border-primary focus:shadow-focus"
            />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-2xs font-bold text-text-muted">{t("store.filters.priceTo")}</span>
            <input
              type="number"
              min={0}
              inputMode="numeric"
              value={max}
              onChange={(e) => setMax(e.target.value)}
              placeholder={String(Math.ceil(priceBounds.max / 100))}
              className="num w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-text outline-none focus:border-primary focus:shadow-focus"
            />
          </label>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          block
          className="mt-2"
          onClick={() =>
            onChange({
              priceMin: toPiastres(min),
              priceMax: toPiastres(max) && toPiastres(min) && toPiastres(max)! < toPiastres(min)! ? null : toPiastres(max),
            })
          }
        >
          {t("store.filters.applyPrice")}
        </Button>
      </Group>

      {/* Toggles */}
      <Group title={t("store.filters.quick")}>
        <Check
          checked={state.onOffer}
          onChange={() => onChange({ onOffer: !state.onOffer })}
          label={t("store.filters.onOffer")}
        />
        <Check
          checked={state.inStock}
          onChange={() => onChange({ inStock: !state.inStock })}
          label={t("store.filters.inStock")}
        />
        <Check
          checked={state.rating === 4}
          onChange={() => onChange({ rating: state.rating === 4 ? 0 : 4 })}
          label={t("store.filters.rating4")}
        />
        <Check
          checked={state.rating === 3}
          onChange={() => onChange({ rating: state.rating === 3 ? 0 : 3 })}
          label={t("store.filters.rating3")}
        />
      </Group>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-1.5 border-t border-border pt-3">
      <legend className="pb-1 text-2xs font-extrabold uppercase tracking-wide text-text-faint">{title}</legend>
      {children}
    </fieldset>
  );
}

function Row({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-start text-sm transition-colors duration-150 ${
        active ? "bg-primary-soft font-extrabold text-action" : "font-semibold text-text hover:bg-surface-tint"
      }`}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined ? <span className="num shrink-0 text-2xs text-text-faint">{count}</span> : null}
    </button>
  );
}

function Check({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <label className="flex min-h-9 cursor-pointer items-center gap-2 text-sm font-semibold text-text">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="size-4 shrink-0 cursor-pointer accent-[var(--color-action)]"
      />
      <span className="min-w-0">{label}</span>
    </label>
  );
}

/** Sort select for the results bar; keeps the rest of the filter state. */
export function StoreSortSelect({
  basePath,
  state,
}: {
  basePath: string;
  state: StoreFilterState;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="hidden font-bold text-text-muted sm:inline">{t("store.listing.sort")}</span>
      <select
        value={state.sort}
        onChange={(e) =>
          navigate(`${basePath}${buildStoreQuery({ ...state, sort: e.target.value as StoreSort, page: 1 })}`)
        }
        aria-label={t("store.listing.sort")}
        className="min-h-10 cursor-pointer rounded-md border border-border bg-surface px-2.5 text-sm font-bold text-text outline-none focus:border-primary"
      >
        {STORE_SORTS.map((option) => (
          <option key={option} value={option}>
            {t(`store.storeSort.${option}`)}
          </option>
        ))}
      </select>
    </label>
  );
}

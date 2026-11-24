import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { foldSearch, foldTokens } from "~/lib/search-fold";
import { CheckIcon, ChevronDownIcon, SearchIcon, XIcon } from "./icons";

/** Past this many matches the list is truncated; the selected option stays visible. */
const MATCH_LIMIT = 80;

/**
 * Dropdown for controlled values: single or multi select, optional search
 * (on automatically past 8 options), optional colour swatch per option and
 * option groups (e.g. sizes grouped by size type). Keyboard: Enter/Space
 * opens, arrows move, Enter picks, Escape closes.
 */
export interface SelectMenuOption {
  value: string;
  label: string;
  /** #RRGGBB → rendered as a round swatch */
  swatch?: string | null;
  /** extra searchable text (e.g. the other-language name) */
  keywords?: string;
  /** small leading visual (brand logo) */
  icon?: ReactNode;
  group?: string;
  disabled?: boolean;
}

interface BaseProps {
  label: ReactNode;
  options: SelectMenuOption[];
  placeholder?: string;
  required?: boolean;
  error?: string | null;
  hint?: ReactNode;
  disabled?: boolean;
  searchable?: boolean;
  id?: string;
}
type SingleProps = BaseProps & { multiple?: false; value: string | null; onChange: (value: string | null) => void };
type MultiProps = BaseProps & { multiple: true; value: string[]; onChange: (value: string[]) => void };

export function SelectMenu(props: SingleProps | MultiProps) {
  const { label, options, placeholder, required, error, hint, disabled, id: idOverride } = props;
  const { t } = useTranslation();
  const autoId = useId();
  const id = idOverride ?? autoId;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const searchable = props.searchable ?? options.length > 8;
  const selected = props.multiple ? props.value : props.value ? [props.value] : [];

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // folded haystacks are computed once per option list (1,000+ brands), not per keystroke
  const haystacks = useMemo(
    () => options.map((o) => foldSearch(`${o.label} ${o.keywords ?? ""}`)),
    [options],
  );
  const filtered = useMemo(() => {
    const tokens = foldTokens(query);
    if (tokens.length === 0) return options;
    return options.filter((_, i) => tokens.every((token) => haystacks[i]!.includes(token)));
  }, [options, haystacks, query]);
  // the chosen option must remain reachable even when it sits past the cut
  const visible = filtered.length <= MATCH_LIMIT
    ? filtered
    : [...filtered.slice(0, MATCH_LIMIT), ...filtered.slice(MATCH_LIMIT).filter((o) => selected.includes(o.value))];
  const truncated = filtered.length > MATCH_LIMIT;

  const pick = (option: SelectMenuOption) => {
    if (option.disabled) return;
    if (props.multiple) {
      const next = props.value.includes(option.value) ? props.value.filter((v) => v !== option.value) : [...props.value, option.value];
      props.onChange(next);
    } else {
      props.onChange(option.value);
      setOpen(false);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open && (e.key === "Enter" || e.key === " " || e.key === "ArrowDown")) { e.preventDefault(); setOpen(true); return; }
    if (!open) return;
    if (e.key === "Escape") { setOpen(false); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, visible.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    if (e.key === "Enter") { e.preventDefault(); const o = visible[active]; if (o) pick(o); }
  };

  const byValue = new Map(options.map((o) => [o.value, o]));
  const chosen = selected.map((v) => byValue.get(v)).filter((o): o is SelectMenuOption => Boolean(o));
  const swatch = (hex: string | null | undefined, size = "size-4") =>
    hex !== undefined ? (
      <span aria-hidden="true" className={`${size} shrink-0 rounded-full border border-black/10`}
        style={hex ? { backgroundColor: hex } : { background: "conic-gradient(#e53935,#fdd835,#43a047,#1e88e5,#8e24aa,#e53935)" }} />
    ) : null;
  // fixed box so every row with a logo aligns, with or without a swatch
  const iconBox = (icon: ReactNode) =>
    icon ? (
      <span className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded bg-white">{icon}</span>
    ) : null;

  let lastGroup: string | undefined;

  return (
    <div ref={root} className="relative flex flex-col gap-1.5" onKeyDown={onKey}>
      <label htmlFor={id} className="text-sm font-bold text-text">
        {label}{required ? <span aria-hidden="true" className="ms-0.5 text-danger">*</span> : null}
      </label>
      <button
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => { setOpen((o) => !o); setQuery(""); setActive(0); }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-invalid={Boolean(error)}
        className={`flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-md border bg-surface px-3 py-1.5 text-start text-sm text-text transition-colors focus:outline-none focus-visible:shadow-focus disabled:cursor-not-allowed disabled:opacity-60 ${
          error ? "border-danger" : open ? "border-action" : "border-border hover:border-border-strong"
        }`}
      >
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {chosen.length === 0 ? (
            <span className="text-text-faint">{placeholder ?? t("common.choose")}</span>
          ) : props.multiple ? (
            chosen.map((o) => (
              <span key={o.value} className="inline-flex items-center gap-1 rounded-full bg-surface-tint px-2 py-0.5 text-xs font-bold text-text">
                {swatch(o.swatch, "size-3")}{o.label}
                <span role="button" tabIndex={-1} aria-label={t("common.remove")}
                  onClick={(e) => { e.stopPropagation(); pick(o); }} className="text-text-muted hover:text-danger">
                  <XIcon className="size-3" />
                </span>
              </span>
            ))
          ) : (
            <span className="flex items-center gap-2 truncate">{swatch(chosen[0]!.swatch)}{iconBox(chosen[0]!.icon)}{chosen[0]!.label}</span>
          )}
        </span>
        <ChevronDownIcon aria-hidden="true" className={`size-4 shrink-0 text-text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div className="absolute inset-x-0 top-full z-40 mt-1 flex max-h-72 flex-col overflow-hidden rounded-md border border-border bg-surface shadow-2">
          {searchable ? (
            <div className="relative border-b border-border p-2">
              <SearchIcon aria-hidden="true" className="pointer-events-none absolute start-4 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
              <input autoFocus value={query} onChange={(e) => { setQuery(e.target.value); setActive(0); }}
                placeholder={t("common.search")} aria-label={t("common.search")}
                className="w-full rounded-md border border-border bg-surface py-1.5 ps-8 pe-2 text-sm focus:border-action focus:outline-none" />
            </div>
          ) : null}
          <ul role="listbox" aria-multiselectable={props.multiple || undefined} className="overflow-y-auto py-1">
            {visible.length === 0 ? <li className="px-3 py-3 text-center text-xs text-text-muted">{t("common.noResults")}</li> : null}
            {visible.map((o, i) => {
              const isSel = selected.includes(o.value);
              const header = o.group && o.group !== lastGroup ? o.group : null;
              lastGroup = o.group;
              return (
                <li key={o.value} role="presentation">
                  {header ? <p className="px-3 pt-2 pb-1 text-2xs font-extrabold uppercase tracking-wide text-text-muted">{header}</p> : null}
                  <button type="button" role="option" aria-selected={isSel} disabled={o.disabled}
                    onMouseEnter={() => setActive(i)} onClick={() => pick(o)}
                    className={`flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-start text-sm disabled:cursor-not-allowed disabled:opacity-40 ${
                      i === active ? "bg-surface-tint" : ""} ${isSel ? "font-bold text-action" : "text-text"}`}>
                    {props.multiple ? (
                      <span className={`flex size-4 shrink-0 items-center justify-center rounded border ${isSel ? "border-action bg-action text-on-action" : "border-border-strong"}`}>
                        {isSel ? <CheckIcon className="size-3" /> : null}
                      </span>
                    ) : null}
                    {swatch(o.swatch)}
                    {iconBox(o.icon)}
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {!props.multiple && isSel ? <CheckIcon className="size-4 shrink-0" /> : null}
                  </button>
                </li>
              );
            })}
            {truncated ? (
              <li className="px-3 py-2 text-center text-2xs text-text-muted">{t("common.typeToNarrow")}</li>
            ) : null}
          </ul>
        </div>
      ) : null}
      {error ? <p role="alert" className="text-xs font-bold text-danger">{error}</p> : hint ? <p className="text-xs text-text-muted">{hint}</p> : null}
    </div>
  );
}

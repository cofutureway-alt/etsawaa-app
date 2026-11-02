import { useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CheckIcon, ChevronDownIcon } from "./icons";

export interface ComboboxOption {
  value: string;
  label: string;
}

export interface ComboboxProps {
  label: ReactNode;
  options: ComboboxOption[];
  placeholder?: string;
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
}

/**
 * Combobox with keyboard support (ArrowUp/Down, Enter, Escape), ARIA 1.2
 * combobox pattern and filtered options.
 */
export function Combobox({ label, options, placeholder, value, onChange, disabled }: ComboboxProps) {
  const { t } = useTranslation();
  const id = useId();
  const listId = `${id}-listbox`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((option) => option.value === value) ?? null;
  const filtered = options.filter((option) =>
    option.label.toLowerCase().includes(query.trim().toLowerCase()),
  );

  function openList() {
    setOpen(true);
    setActiveIndex(Math.max(0, filtered.findIndex((o) => o.value === value)));
  }

  function commit(option: ComboboxOption | null) {
    onChange(option?.value ?? null);
    setOpen(false);
    setQuery("");
    inputRef.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (disabled) return;
    if (event.key === "Escape") {
      if (open) {
        event.stopPropagation();
        setOpen(false);
      }
      return;
    }
    if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      openList();
      return;
    }
    if (!open) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = filtered[activeIndex];
      if (option) commit(option);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-bold text-text">
        {label}
      </label>
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          role="combobox"
          disabled={disabled}
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open && filtered[activeIndex] ? `${id}-opt-${activeIndex}` : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          value={open ? query : (selected?.label ?? "")}
          placeholder={placeholder ?? t("ui.combobox.placeholder")}
          onFocus={openList}
          onChange={(event) => {
            setQuery(event.target.value);
            if (!open) setOpen(true);
            setActiveIndex(0);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => setOpen(false)}
          className="w-full cursor-pointer rounded-md border border-border bg-surface px-3.5 py-2.5 pe-9 text-sm text-text outline-none transition-colors duration-150 placeholder:text-text-faint focus:border-primary focus:shadow-focus"
        />
        <ChevronDownIcon
          aria-hidden="true"
          className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-text-muted"
        />
        {open && filtered.length > 0 ? (
          <ul
            id={listId}
            role="listbox"
            className="absolute inset-x-0 top-full z-30 mt-1 max-h-60 overflow-auto rounded-md border border-border bg-surface py-1 shadow-2"
          >
            {filtered.map((option, index) => (
              <li key={option.value} role="none">
                <button
                  type="button"
                  role="option"
                  id={`${id}-opt-${index}`}
                  aria-selected={option.value === value}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => commit(option)}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={`flex w-full cursor-pointer items-center justify-between px-3.5 py-2 text-start text-sm transition-colors duration-150 ${
                    index === activeIndex ? "bg-surface-tint text-action" : "text-text"
                  }`}
                >
                  <span>{option.label}</span>
                  {option.value === value ? <CheckIcon aria-hidden="true" /> : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

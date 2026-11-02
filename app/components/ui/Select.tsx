import { useId, type SelectHTMLAttributes, type ReactNode } from "react";
import { ChevronDownIcon } from "./icons";

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "id"> {
  label: ReactNode;
  options: Array<{ value: string; label: string }>;
  error?: ReactNode;
  /** Stable id override (error-summary focus targets). */
  id?: string;
}

/** Native select styled from tokens — keyboard and screen-reader friendly. */
export function Select({ label, options, error, className = "", id: idOverride, ...rest }: SelectProps) {
  const id = idOverride ?? useId();
  const errorId = `${id}-error`;
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="relative block text-[13px] font-bold text-text">
        {label}
      </label>
      <div className="relative">
        <select
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={`w-full cursor-pointer appearance-none rounded-md border bg-surface px-3.5 py-2.5 pe-9 text-sm text-text outline-none transition-colors duration-150 focus:shadow-focus ${
            error ? "border-danger" : "border-border focus:border-primary"
          }`}
          {...rest}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDownIcon
          aria-hidden="true"
          className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-text-muted"
        />
      </div>
      {error ? (
        <p id={errorId} role="alert" className="text-xs font-bold text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

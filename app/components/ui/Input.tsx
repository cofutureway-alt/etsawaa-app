import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import { AlertIcon, EyeIcon, EyeOffIcon } from "./icons";
import { useTranslation } from "react-i18next";
import { useState } from "react";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  showPasswordToggle?: boolean;
  /** Extra classes for the <input> itself (wrapper keeps layout classes). */
  inputClassName?: string;
  /** Render as password visibility toggle target */
  type?: InputHTMLAttributes<HTMLInputElement>["type"];
  /** Stable id override (error-summary focus targets). */
  id?: string;
}

/**
 * Input with associated label, hint and inline error wired through
 * aria-describedby / aria-invalid (ui-ux-pro-max: inline validation, error
 * placement). Optional password visibility toggle with accessible name.
 */
export function Input({
  label,
  hint,
  error,
  showPasswordToggle = false,
  inputClassName = "",
  type = "text",
  className = "",
  id: idOverride,
  ...rest
}: InputProps) {
  const { t } = useTranslation();
  const id = idOverride ?? useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const [visible, setVisible] = useState(false);
  const actualType = showPasswordToggle ? (visible ? "text" : "password") : type;

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-[13px] font-bold text-text">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={actualType}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : hint ? hintId : undefined}
          className={`w-full rounded-md border bg-surface px-3.5 py-2.5 text-sm text-text transition-colors duration-150 outline-none placeholder:text-text-faint focus:shadow-focus ${
            error ? "border-danger" : "border-border focus:border-primary"
          } ${showPasswordToggle ? "pe-10" : ""} ${inputClassName}`}
          {...rest}
        />
        {showPasswordToggle ? (
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? t("common.hidePassword") : t("common.showPassword")}
            className="absolute end-2 top-1/2 flex size-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-text-muted transition-colors duration-150 hover:bg-surface-tint hover:text-text"
          >
            {visible ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        ) : null}
      </div>
      {hint && !error ? (
        <p id={hintId} className="text-xs text-text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="flex items-center gap-1.5 text-xs font-bold text-danger">
          <AlertIcon aria-hidden="true" />
          {error}
        </p>
      ) : null}
    </div>
  );
}

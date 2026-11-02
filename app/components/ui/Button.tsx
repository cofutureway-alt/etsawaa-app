import type { ButtonHTMLAttributes, ReactNode } from "react";
import { SpinnerIcon } from "./icons";

type Variant = "primary" | "outline" | "ghost" | "dark";
type Size = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  block?: boolean;
  children: ReactNode;
}

const variantClasses: Record<Variant, string> = {
  primary: "bg-action text-on-action hover:bg-action-hover active:bg-action-hover",
  outline: "border border-action text-action bg-surface hover:bg-surface-tint",
  ghost: "text-text hover:bg-surface-tint",
  dark: "bg-ink text-white hover:bg-action-hover",
};

const sizeClasses: Record<Size, string> = {
  sm: "px-3 py-1.5 text-[13px]",
  md: "px-5 py-2.5 text-sm",
  lg: "px-7 py-3.5 text-[15px]",
};

/**
 * Button — flat, token-driven, with loading and disabled states.
 * Loading keeps the button width stable (spinner replaces nothing; label stays).
 */
export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  block = false,
  disabled,
  className = "",
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <button
      type={type}
      aria-busy={loading || undefined}
      disabled={isDisabled}
      className={`inline-flex cursor-pointer items-center justify-center gap-2 rounded-m font-bold leading-tight transition-colors duration-200 ease-out disabled:cursor-not-allowed disabled:opacity-50 ${variantClasses[variant]} ${sizeClasses[size]} ${block ? "w-full" : ""} ${className}`}
      {...rest}
    >
      {loading ? <SpinnerIcon aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

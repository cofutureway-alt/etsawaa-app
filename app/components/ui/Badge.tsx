import type { ReactNode } from "react";

export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info" | "featured";

const toneClasses: Record<BadgeTone, string> = {
  neutral: "bg-surface-alt text-text-muted border-border",
  success: "bg-success-soft text-success-strong border-success/30",
  warning: "bg-warning-soft text-warning-strong border-warning/40",
  danger: "bg-danger-soft text-danger border-danger/30",
  info: "bg-info-soft text-info border-info/30",
  featured: "bg-surface text-ink border-featured",
};

/** Flat status badge — colored soft background + dark text, never color-only meaning. */
export function Badge({
  tone = "neutral",
  dot = false,
  className = "",
  children,
}: {
  tone?: BadgeTone;
  dot?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const dotClasses: Record<BadgeTone, string> = {
    neutral: "bg-text-muted",
    success: "bg-success-strong",
    warning: "bg-warning-strong",
    danger: "bg-danger",
    info: "bg-info",
    featured: "bg-featured",
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-bold leading-5 transition-colors ${toneClasses[tone]} ${className}`}
    >
      {dot ? (
        <span
          className={`size-1.5 rounded-full shrink-0 ${dotClasses[tone]}`}
          aria-hidden="true"
        />
      ) : null}
      {children}
    </span>
  );
}

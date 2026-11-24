import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

/**
 * step-shell.tsx — chrome shared across every onboarding screen: the
 * full-screen shell that wraps all wizard steps plus the focusable error
 * summary rendered above the step card. Kept together so step files only
 * contain their own fields and the route stays a thin orchestrator.
 */

/** Full-screen shell with noindex (US-01: no other page reachable). */
export function WizardShell({ lang, children }: { lang: string; children: ReactNode }) {
  void lang;
  return (
    <div className="min-h-dvh bg-surface-alt py-6">
      <meta name="robots" content="noindex, nofollow" />
      <div className="mx-auto w-full max-w-[860px] px-4">{children}</div>
    </div>
  );
}

/** Focusable list of validation errors; each entry scrolls to its field. */
export function ErrorSummary({ items }: { items: Array<{ field: string; label: string }> }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, [items.length]);
  if (items.length === 0) return null;
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="alert"
      aria-labelledby="wizard-error-title"
      className="rounded-md border border-danger/40 bg-danger-soft p-3"
    >
      <p id="wizard-error-title" className="text-sm font-extrabold text-danger">
        {t("common.errorSummary", { count: items.length })}
      </p>
      <ul className="mt-1.5 flex flex-col gap-1">
        {items.map((item) => (
          <li key={item.field}>
            <button
              type="button"
              className="cursor-pointer text-start text-sm font-bold text-danger underline underline-offset-2"
              onClick={() => {
                const el = document.getElementById(item.field);
                el?.scrollIntoView({ block: "center" });
                (el as HTMLElement | null)?.focus?.();
              }}
            >
              {item.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

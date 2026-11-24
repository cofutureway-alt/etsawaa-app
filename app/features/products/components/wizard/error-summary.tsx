import type { RefObject } from "react";
import { useTranslation } from "react-i18next";

/**
 * ARIA alert listing the step-gate validation errors. The orchestrator
 * attaches `summaryRef` and scrolls it into view when navigation is blocked.
 */

export interface ErrorSummaryProps {
  errors: string[];
  /** Attached to the alert box so the orchestrator can scroll to it. */
  summaryRef: RefObject<HTMLDivElement | null>;
}

export function ErrorSummary({ errors, summaryRef }: ErrorSummaryProps) {
  const { t } = useTranslation();
  if (errors.length === 0) return null;
  return (
    <div ref={summaryRef} tabIndex={-1} role="alert" className="rounded-md border border-danger/40 bg-danger-soft p-3">
      <p className="text-sm font-extrabold text-danger">{t("common.errorSummary", { count: errors.length })}</p>
      <ul className="mt-1.5 list-inside list-disc">
        {errors.map((error) => (
          <li key={error} className="text-sm font-bold text-danger">{error}</li>
        ))}
      </ul>
    </div>
  );
}

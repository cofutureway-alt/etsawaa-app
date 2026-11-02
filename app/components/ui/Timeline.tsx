import type { ReactNode } from "react";
import { CheckIcon } from "./icons";

export interface TimelineStep {
  label: ReactNode;
  /** ISO timestamp or a short human note */
  meta?: ReactNode;
  state: "done" | "current" | "pending";
}

/** Vertical order timeline (order tracking pattern, JOURNEYS §9). */
export function Timeline({ steps, label }: { steps: TimelineStep[]; label: string }) {
  return (
    <ol className="flex flex-col gap-0" aria-label={label}>
      {steps.map((step, index) => (
        <li key={index} className="relative flex gap-3 pb-6 last:pb-0">
          {/* connector */}
          {index < steps.length - 1 ? (
            <span
              aria-hidden="true"
              className={`absolute top-6 start-[11px] h-[calc(100%-16px)] w-0.5 ${
                step.state === "pending" ? "bg-border" : "bg-action"
              }`}
            />
          ) : null}
          <span
            aria-hidden="true"
            className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border-2 ${
              step.state === "done"
                ? "border-action bg-action text-on-action"
                : step.state === "current"
                  ? "border-action bg-surface text-action"
                  : "border-border bg-surface text-text-faint"
            }`}
          >
            {step.state === "done" ? <CheckIcon width={12} height={12} /> : <span className={`size-1.5 rounded-full ${step.state === "current" ? "bg-action" : "bg-border-strong"}`} />}
          </span>
          <div className="flex flex-col gap-0.5">
            <span className={`text-sm ${step.state === "pending" ? "text-text-muted" : "font-bold text-text"}`}>
              {step.label}
            </span>
            {step.meta ? <span className="num text-xs text-text-muted">{step.meta}</span> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

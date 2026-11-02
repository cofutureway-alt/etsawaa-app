import { CheckIcon } from "./icons";

export interface StepperProps {
  steps: string[];
  /** Zero-based index of the current step */
  current: number;
  label: string;
}

/** Horizontal stepper with numbered circles; current step marked via aria-current. */
export function Stepper({ steps, current, label }: StepperProps) {
  return (
    <ol className="flex flex-wrap items-center gap-2" aria-label={label}>
      {steps.map((step, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li key={step} className="flex items-center gap-2" aria-current={active ? "step" : undefined}>
            <span
              className={`flex size-7 items-center justify-center rounded-full border-2 text-xs font-extrabold ${
                done
                  ? "border-action bg-action text-on-action"
                  : active
                    ? "border-action bg-surface text-action"
                    : "border-border bg-surface text-text-faint"
              }`}
            >
              {done ? <CheckIcon width={12} height={12} /> : index + 1}
            </span>
            <span className={`text-sm ${active ? "font-bold text-text" : done ? "text-text" : "text-text-muted"}`}>
              {step}
            </span>
            {index < steps.length - 1 ? (
              <span aria-hidden="true" className={`mx-1 h-0.5 w-6 ${done ? "bg-action" : "bg-border"}`} />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

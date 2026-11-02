import { useId, useState, type ReactNode } from "react";

/**
 * Single-open accordion step (AGENT §23 lists Accordion as a primitive).
 * Controlled by the parent: `open` + `onToggle`, so checkout can drive the
 * step it wants expanded. The header is a real button with aria-expanded and
 * aria-controls; the panel is labelled by it.
 */
export interface AccordionStepProps {
  title: ReactNode;
  summary?: ReactNode;
  open: boolean;
  onToggle: () => void;
  /** Disable toggling (e.g. a later step gated on an earlier one). */
  disabled?: boolean;
  children: ReactNode;
}

export function AccordionStep({ title, summary, open, onToggle, disabled, children }: AccordionStepProps) {
  const id = useId();
  return (
    <div className="rounded-l border border-border bg-surface">
      <h3>
        <button
          type="button"
          id={`${id}-head`}
          aria-expanded={open}
          aria-controls={`${id}-panel`}
          aria-disabled={disabled || undefined}
          onClick={() => !disabled && onToggle()}
          className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-start ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
        >
          <span className="text-sm font-extrabold text-text">{title}</span>
          <span className="flex items-center gap-2 text-[12px] text-text-muted">
            {summary}
            <span aria-hidden="true" className={`mirr transition-transform duration-200 ${open ? "rotate-90" : ""}`}>
              ›
            </span>
          </span>
        </button>
      </h3>
      <div id={`${id}-panel`} role="region" aria-labelledby={`${id}-head`} hidden={!open} className="border-t border-border px-4 py-4">
        {children}
      </div>
    </div>
  );
}

/** Convenience wrapper for a whole accordion with one open section. */
export function useAccordion(initial = 0) {
  const [openIndex, setOpenIndex] = useState(initial);
  return {
    openIndex,
    isOpen: (i: number) => openIndex === i,
    toggle: (i: number) => setOpenIndex((cur) => (cur === i ? -1 : i)),
    close: () => setOpenIndex(-1),
  };
}

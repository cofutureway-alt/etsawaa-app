import { useTranslation } from "react-i18next";

/**
 * One checkout accordion header row (JOURNEYS §6): the numbered state bubble,
 * the step label with a screen-reader "step N of M", and the collapsed value
 * preview. Clicking it opens that step. Extracted verbatim from the route's
 * inline `stepHeader` helper.
 */

/** Rendered state of one accordion step (label + collapsed summary value). */
export interface StepViewState {
  done: boolean;
  label: string;
  value: string;
}

export function StepHeader({
  index, total, state, open, onOpen,
}: {
  index: number;
  total: number;
  state: StepViewState;
  open: boolean;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-expanded={open}
      className={`flex w-full items-center justify-between gap-3 px-4 py-3.5 text-start transition-colors duration-150 ${open ? "bg-surface-tint" : "hover:bg-surface-tint"}`}
    >
      <span className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className={`flex size-7 shrink-0 items-center justify-center rounded-full border text-sm font-extrabold ${
            open ? "border-action bg-action text-on-action" : state.done ? "border-action text-action" : "border-border text-text-faint"
          }`}
        >
          {index + 1}
        </span>
        <span>
          <span className="block text-sm font-bold text-text">
            {state.label}
            <span className="sr-only"> — {t("checkout.stepOf", { current: index + 1, total })}</span>
          </span>
          {!open && state.value ? (
            <span className="block truncate text-xs text-text-faint">{state.value}</span>
          ) : null}
        </span>
      </span>
      <span className="text-xs font-bold text-text-faint">{t("checkout.stepOf", { current: index + 1, total })}</span>
    </button>
  );
}

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { XIcon } from "./icons";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface OverlayProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  labelledBy?: string;
}

/** Shared focus-trap + Escape + scroll-lock + return-focus behavior. */
export function useOverlay(open: boolean, onClose: () => void) {
  const containerRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const container = containerRef.current;
    const focusables = container?.querySelectorAll<HTMLElement>(FOCUSABLE);
    (focusables && focusables.length > 0 ? focusables[0] : container)?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !containerRef.current) return;
      const items = Array.from(
        containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = "";
      previouslyFocused.current?.focus();
    };
  }, [open, onClose]);

  return containerRef;
}

/** Modal dialog: centered card + scrim, focus-trapped, Escape closes (US-10: full-screen sheet on mobile). */
export function Dialog({ open, onClose, title, children }: OverlayProps) {
  const { t } = useTranslation();
  const containerRef = useOverlay(open, onClose);
  if (!open || typeof document === "undefined") return null;
  const titleId = "dialog-title";
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="presentation">
      <div className="absolute inset-0 bg-ink/60" onClick={onClose} aria-hidden="true" />
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative w-full max-w-md rounded-t-l border border-border bg-surface p-5 shadow-2 outline-none sm:rounded-m"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 id={titleId} className="text-base font-extrabold text-text">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="flex size-8 cursor-pointer items-center justify-center rounded-m text-text-muted transition-colors duration-150 hover:bg-surface-tint hover:text-text"
          >
            <XIcon />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** Drawer: slides from the inline-end edge, full-height, focus-trapped. */
export function Drawer({
  open,
  onClose,
  title,
  header,
  children,
}: OverlayProps & { header?: ReactNode }) {
  const { t } = useTranslation();
  const containerRef = useOverlay(open, onClose);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-50" role="presentation">
      <div className="absolute inset-0 bg-ink/60" onClick={onClose} aria-hidden="true" />
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="absolute inset-y-0 end-0 flex w-full max-w-sm flex-col border-s border-border bg-surface shadow-2 outline-none"
      >
        {header ?? (
          <div className="flex items-start justify-between gap-3 border-b border-border p-4">
            <h2 className="text-base font-extrabold text-text">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("common.close")}
              className="flex size-8 cursor-pointer items-center justify-center rounded-m text-text-muted transition-colors duration-150 hover:bg-surface-tint hover:text-text"
            >
              <XIcon />
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { XIcon } from "./icons";

/**
 * True once mounted in the browser. A portal can't be rendered on the server,
 * so an overlay that is open on the first render must wait for the mount —
 * rendering it during hydration made the client HTML differ from the server's.
 */
function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

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
  // latest onClose without re-running the effect: callers pass a new arrow
  // every render, and re-running moved focus to the first button (the ×)
  // after every keystroke typed inside the dialog.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const container = containerRef.current;
    const focusables = container?.querySelectorAll<HTMLElement>(FOCUSABLE);
    (focusables && focusables.length > 0 ? focusables[0] : container)?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCloseRef.current();
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
  }, [open]);

  return containerRef;
}

/**
 * Modal dialog: centered card + scrim, focus-trapped, Escape closes (US-10:
 * full-screen sheet on mobile).
 *
 * `size` picks the width. The default `md` is for a short confirmation; a
 * dialog hosting a whole library (the media picker) needs `xl` or the two
 * columns inside collapse into a single 96px scroll strip.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  size = "md",
}: OverlayProps & { size?: "md" | "lg" | "xl" | "picker" }) {
  const { t } = useTranslation();
  const mounted = useMounted();
  // focus trap starts once the overlay is actually in the page
  const containerRef = useOverlay(open && mounted, onClose);
  if (!open || !mounted) return null;
  const titleId = "dialog-title";
  const widthClass = {
    md: "max-w-md",
    lg: "max-w-2xl",
    xl: "max-w-5xl",
    // the media picker: on phones a near full-height sheet so the grid has room
    picker: "max-w-5xl max-sm:h-[92dvh]",
  }[size];
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="presentation">
      <div className="absolute inset-0 bg-ink/60" onClick={onClose} aria-hidden="true" />
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-lg border border-border bg-surface shadow-2 outline-none sm:rounded-lg ${widthClass}`}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3">
          <h2 id={titleId} className="text-base font-extrabold text-text">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="flex size-8 cursor-pointer items-center justify-center rounded-md text-text-muted transition-colors duration-150 hover:bg-surface-tint hover:text-text"
          >
            <XIcon />
          </button>
        </div>
        {/* The body scrolls, not the page: a dialog taller than the viewport
            would otherwise push its own actions off-screen. */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
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
  const mounted = useMounted();
  // focus trap starts once the overlay is actually in the page
  const containerRef = useOverlay(open && mounted, onClose);
  if (!open || !mounted) return null;
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
              className="flex size-8 cursor-pointer items-center justify-center rounded-md text-text-muted transition-colors duration-150 hover:bg-surface-tint hover:text-text"
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

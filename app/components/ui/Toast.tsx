import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AlertIcon, CheckIcon, InfoIcon, XIcon } from "./icons";

export type ToastTone = "success" | "error" | "info";

interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastApi {
  showToast: (tone: ToastTone, message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const toneStyles: Record<ToastTone, string> = {
  success: "border-success/40 bg-surface text-success-strong",
  error: "border-danger/40 bg-surface text-danger",
  info: "border-info/40 bg-surface text-info",
};

const toneIcons: Record<ToastTone, ReactNode> = {
  success: <CheckIcon aria-hidden="true" />,
  error: <AlertIcon aria-hidden="true" />,
  info: <InfoIcon aria-hidden="true" />,
};

const AUTO_DISMISS_MS = 5000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const showToast = useCallback((tone: ToastTone, message: string) => {
    const id = nextId.current++;
    setToasts((current) => [...current, { id, tone, message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, AUTO_DISMISS_MS);
  }, []);

  const api = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* In-place viewport (position:fixed needs no portal). A client-only
          portal here broke hydration — React #418 regenerated the whole tree
          on the client and delayed the LCP paint by ~0.7 s. */}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed bottom-4 inset-x-4 z-[60] flex flex-col items-center gap-2 sm:inset-x-auto sm:end-4 sm:items-end"
      >
        {toasts.map((toast) => (
          <Toast key={toast.id} toast={toast} onDismiss={() => setToasts((c) => c.filter((x) => x.id !== toast.id))} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function Toast({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      role={toast.tone === "error" ? "alert" : "status"}
      className={`pointer-events-auto flex w-full max-w-sm items-center gap-2.5 rounded-m border px-4 py-3 text-sm font-bold shadow-2 ${toneStyles[toast.tone]}`}
    >
      {toneIcons[toast.tone]}
      <span className="flex-1">{toast.message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t("a11y.dismissToast")}
        className="flex size-6 cursor-pointer items-center justify-center rounded-m text-text-muted transition-colors duration-150 hover:bg-surface-tint hover:text-text"
      >
        <XIcon />
      </button>
    </div>
  );
}

/** Access the toast API. Throws if used outside ToastProvider. */
export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside <ToastProvider>");
  return context;
}

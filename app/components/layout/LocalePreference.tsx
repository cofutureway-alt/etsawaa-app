import { useEffect } from "react";
import { useLocation } from "react-router";
import type { Locale } from "~/lib/i18n/config";

// Serialize visits within this tab so an older request cannot overwrite a newer language.
let pending = Promise.resolve();
export function LocalePreference({ locale }: { locale: Locale }) {
  const { pathname } = useLocation();
  useEffect(() => {
    let disposed = false;
    const save = () => {
      if (document.visibilityState !== "visible") return;
      pending = pending.catch(() => undefined).then(async () => {
        if (disposed) return;
        try {
          const response = await fetch("/api/preferences/locale", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locale }), keepalive: true });
          if (!response.ok && !disposed) window.setTimeout(() => { if (!disposed) save(); }, 5000);
        } catch { /* A later navigation or focus retries after a connection failure. */ }
      });
    };
    save();
    document.addEventListener("visibilitychange", save);
    return () => { disposed = true; document.removeEventListener("visibilitychange", save); };
  }, [locale, pathname]);
  return null;
}

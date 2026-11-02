import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "~/components/ui/Toast";

/**
 * Surfaces the result of a fetcher action.
 *
 * Seven admin pages (banners, customers, events, shipping, withdrawals,
 * reviews, penalties) returned `{ok:false, reason}` from their actions and
 * rendered nothing — the operator clicked and the screen did not change, so a
 * failed write looked like a dead button. Those actions already carry a
 * machine-readable reason; this turns it into a toast once per result.
 *
 * Usage: `useActionToast(fetcher, { created: "…", saved: "…" })`.
 */
export function useActionToast(
  fetcher: { state: string; data?: unknown },
  messages: { success?: string; fallback?: string } = {},
) {
  const toast = useToast();
  const { t } = useTranslation();

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    const d = fetcher.data as { ok?: boolean; reason?: string };
    if (d.ok === true) {
      toast.showToast("success", messages.success ?? t("common.saved"));
      return;
    }
    // Prefer a translated reason (admin.*), then the raw one, then the generic.
    const reason = d.reason ?? "failed";
    const key = `admin.err_${reason}`;
    const translated = t(key);
    toast.showToast(
      "error",
      translated === key ? (messages.fallback ?? t("common.actionFailed")) : translated,
    );
  }, [fetcher.state, fetcher.data, toast, t, messages.success, messages.fallback]);
}

import { useEffect } from "react";

/** Send an ad impression / click (best effort, never blocks the page). */
export function sendAdEvent(id: string, kind: "view" | "click") {
  try {
    const body = JSON.stringify({ id, kind });
    if (kind === "click" && typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon("/api/ad-event", new Blob([body], { type: "application/json" }));
      return;
    }
    void fetch("/api/ad-event", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => undefined);
  } catch { /* ignore */ }
}

/** One impression per campaign per browser session. */
export function useAdImpressions(campaignIds: string[]) {
  const key = campaignIds.join(",");
  useEffect(() => {
    for (const id of campaignIds) {
      try {
        const k = `ad-seen:${id}`;
        if (sessionStorage.getItem(k)) continue;
        sessionStorage.setItem(k, "1");
      } catch { /* private mode: count anyway */ }
      sendAdEvent(id, "view");
    }
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
}

import { createBrowserClient } from "@supabase/ssr";
import { useEffect, useState, useTransition } from "react";
import { useTranslation } from "react-i18next";
import { BellIcon } from "~/components/ui/icons";
import type { NotificationRow } from "./api";
import { formatNotification } from "./format";

/**
 * NotificationBell (F-17). A hand-rolled 20 s interval refetches the list
 * through the notifications API route to keep the unread badge fresh; when a
 * browser Supabase client exists we additionally subscribe to the Realtime
 * channel for the user's rows (any change triggers another refetch).
 * Without a DB the bell renders but the dropdown explains the state.
 */
export function NotificationBell({
  lang,
  userId,
  initialCount,
}: {
  lang: string;
  userId: string;
  initialCount: number;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationRow[] | null>(null);
  const [serverUnread, setServerUnread] = useState<number | null>(null);
  const [, startTransition] = useTransition();

  async function fetchList(): Promise<NotificationRow[] | null> {
    try {
      const response = await fetch(`/${lang}/api/notifications`, { headers: { Accept: "application/json" } });
      if (!response.ok) return null;
      const body = (await response.json()) as { notifications: NotificationRow[] | null; unread?: number };
      if (typeof body.unread === "number") setServerUnread(body.unread);
      return body.notifications;
    } catch {
      return null;
    }
  }

  useEffect(() => {
    let active = true;
    let interval: number | undefined;
    let channel: ReturnType<NonNullable<ReturnType<typeof createBrowserClient>>["channel"]> | undefined;

    const refresh = () => void fetchList().then((list) => active && startTransition(() => setItems(list)));
    void refresh();
    // poll once a minute and only while the tab is visible (was every 20 s in
    // every open tab, 3 DB round-trips each); catch up when the tab returns
    interval = window.setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 60000);
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisible);

    // Realtime subscription (works once the database is connected)
    const browser = createBrowserClientSafe();
    if (browser) {
      channel = browser
        .channel(`notifications:${userId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
          () => void refresh(),
        )
        .subscribe();
    }

    return () => {
      active = false;
      if (interval) window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      if (channel && browser) void browser.removeChannel(channel);
    };
  }, [lang, userId]);

  const list = items;
  const unread = serverUnread ?? (list ? list.filter((n) => n.read_at === null).length : initialCount);

  // optimistic: the row (and the badge) update on the click; a failed request puts them back
  async function markRead(id: string) {
    const before = items;
    const wasUnread = Boolean(items?.find((n) => n.id === id && n.read_at === null));
    setItems((current) => current ? current.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)) : current);
    if (wasUnread) setServerUnread((u) => (u === null ? u : Math.max(0, u - 1)));
    const ok = await fetch(`/${lang}/api/notifications`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "read", id }),
    }).then((r) => r.ok).catch(() => false);
    if (!ok) { setItems(before); if (wasUnread) setServerUnread((u) => (u === null ? u : u + 1)); }
  }

  async function markAllRead() {
    const before = items;
    const beforeUnread = serverUnread;
    setItems((current) => current ? current.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })) : current);
    setServerUnread(0);
    const ok = await fetch(`/${lang}/api/notifications`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "read-all" }),
    }).then((r) => r.ok).catch(() => false);
    if (!ok) { setItems(before); setServerUnread(beforeUnread); }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={t("a11y.notifications")}
        className="relative flex size-10 cursor-pointer items-center justify-center rounded-md text-text transition-colors duration-150 hover:bg-surface-tint hover:text-action"
      >
        <BellIcon />
        {unread > 0 ? (
          <span className="num absolute -top-0.5 -end-0.5 flex min-w-4.5 justify-center rounded-full bg-action px-1 text-2xs font-extrabold leading-4.5 text-on-action">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute end-0 top-full z-50 mt-1 w-80 rounded-md border border-border bg-surface shadow-2">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-sm font-extrabold text-text">{t("notifications.title")}</span>
            {list && list.length > 0 ? (
              <button type="button" onClick={markAllRead} className="cursor-pointer text-xs font-bold text-action hover:underline">
                {t("notifications.markAllRead")}
              </button>
            ) : null}
          </div>
          <div className="max-h-72 overflow-y-auto">
            {list === null || list.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-text-muted">{t("notifications.empty")}</p>
            ) : (
              <ul>
                {list.map((row) => {
                  const text = formatNotification(row, lang === "en" ? "en" : "ar", t);
                  return (
                    <li key={row.id} className={`border-b border-border px-3 py-2.5 last:border-b-0 ${row.read_at ? "" : "bg-surface-tint"}`}>
                      <p className="text-sm font-bold text-text">{text.title}</p>
                      {text.body ? <p className="text-xs text-text-muted">{text.body}</p> : null}
                      {text.link ? <a href={text.link} className="me-3 text-xs font-bold text-action hover:underline">{t("notifications.open")}</a> : null}
                      {row.read_at ? null : (
                        <button type="button" onClick={() => void markRead(row.id)} className="mt-1 cursor-pointer text-xs font-bold text-action hover:underline">
                          {t("notifications.markRead")}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function createBrowserClientSafe() {
  try {
    const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
    if (!url || !key) return null;
    return createBrowserClient(url, key);
  } catch {
    return null;
  }
}

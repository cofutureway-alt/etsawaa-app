import { createBrowserClient } from "@supabase/ssr";
import { useEffect, useState, useTransition } from "react";
import { useTranslation } from "react-i18next";
import { BellIcon } from "~/components/ui/icons";
import type { NotificationRow } from "./api";
import { notificationText } from "./api";

/**
 * NotificationBell (F-17). TanStack Query polling keeps the unread badge
 * fresh; when a browser Supabase client exists we additionally subscribe to
 * the Realtime channel for the user's rows (inserts flip read_at state).
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
  const [, startTransition] = useTransition();

  async function fetchList(): Promise<NotificationRow[] | null> {
    try {
      const response = await fetch(`/${lang}/api/notifications`, { headers: { Accept: "application/json" } });
      if (!response.ok) return null;
      const body = (await response.json()) as { notifications: NotificationRow[] | null };
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
    interval = window.setInterval(refresh, 20000);

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
      if (channel && browser) void browser.removeChannel(channel);
    };
  }, [lang, userId]);

  const list = items;
  const unread = list ? list.filter((n) => n.read_at === null).length : initialCount;

  async function markRead(id: string) {
    await fetch(`/${lang}/api/notifications`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "read", id }),
    });
    setItems((current) => current ? current.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)) : current);
  }

  async function markAllRead() {
    await fetch(`/${lang}/api/notifications`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "read-all" }),
    });
    setItems((current) => current ? current.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })) : current);
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
          <span className="num absolute -top-0.5 -end-0.5 flex min-w-4.5 justify-center rounded-full bg-action px-1 text-[10px] font-extrabold leading-4.5 text-on-action">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute end-0 top-full z-50 mt-1 w-80 rounded-md border border-border bg-surface shadow-2">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-[13px] font-extrabold text-text">{t("notifications.title")}</span>
            {list && list.length > 0 ? (
              <button type="button" onClick={markAllRead} className="cursor-pointer text-xs font-bold text-action hover:underline">
                {t("notifications.markAllRead")}
              </button>
            ) : null}
          </div>
          <div className="max-h-72 overflow-y-auto">
            {list === null || list.length === 0 ? (
              <p className="px-3 py-6 text-center text-[13px] text-text-muted">{t("notifications.empty")}</p>
            ) : (
              <ul>
                {list.map((row) => {
                  const text = notificationText(row, lang === "en" ? "en" : "ar");
                  return (
                    <li key={row.id} className={`border-b border-border px-3 py-2.5 last:border-b-0 ${row.read_at ? "" : "bg-surface-tint"}`}>
                      <p className="text-[13px] font-bold text-text">{text.title}</p>
                      {text.body ? <p className="text-xs text-text-muted">{text.body}</p> : null}
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

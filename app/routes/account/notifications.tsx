import { Link, data, useFetcher } from "react-router";
import type { Route } from "./+types/notifications";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { listNotifications, notificationText } from "~/features/notifications/api";
import { Button } from "~/components/ui/Button";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonPage } from "~/components/ui/Skeleton";


/**
 * Notification center (O-23): list + filters (all/unread), mark read / mark
 * all, and deep links into the referenced order/refund when the payload
 * carries one.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  const viewer = await requirePanelAccess(client, lang, "account", request);
  const rows = await listNotifications(client, viewer.user.id, 50);
  const filter = new URL(request.url).searchParams.get("filter") === "unread" ? "unread" : "all";
  return {
    lang,
    filter,
    rows: JSON.parse(JSON.stringify(rows)),
    unread: rows.filter((r) => r.read_at === null).length,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "account", request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  if (intent === "read") {
    await client
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", String(form.get("id") ?? ""))
      .is("read_at", null);
    return { ok: true as const };
  }
  if (intent === "read_all") {
    await client.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
    return { ok: true as const };
  }
  return data({ ok: false, reason: "bad_intent" }, { status: 400 });
}

export default function AccountNotifications({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const fetcher = useFetcher<typeof action>();
  const rows = (loaderData.rows as Array<{
    id: string; type: string; read_at: string | null; created_at: string;
    payload: { ar?: { title: string; body: string }; en?: { title: string; body: string }; link?: string };
  }>).filter((r) => (loaderData.filter === "unread" ? r.read_at === null : true));

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <Link
            to={`/${loaderData.lang}/account/notifications`}
            className={`rounded-md border px-3 py-1.5 text-sm font-bold ${loaderData.filter === "all" ? "border-action text-action" : "border-border text-text-muted hover:text-text"}`}
          >
            {t("notifications.filterAll")}
          </Link>
          <Link
            to={`/${loaderData.lang}/account/notifications?filter=unread`}
            className={`rounded-md border px-3 py-1.5 text-sm font-bold ${loaderData.filter === "unread" ? "border-action text-action" : "border-border text-text-muted hover:text-text"}`}
          >
            {t("notifications.filterUnread")} {loaderData.unread > 0 ? `(${loaderData.unread})` : ""}
          </Link>
        </div>
        {loaderData.unread > 0 ? (
          <fetcher.Form method="post" preventScrollReset>
            <input type="hidden" name="intent" value="read_all" />
            <Button type="submit" variant="outline" size="sm">{t("notifications.markAll")}</Button>
          </fetcher.Form>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-text-muted">{t("notifications.empty")}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {rows.map((r) => {
            const text = notificationText(
              { id: r.id, type: r.type, payload: r.payload, read_at: r.read_at, created_at: r.created_at },
              en ? "en" : "ar",
            );
            return (
              <li key={r.id} className={`rounded-md border p-3.5 ${r.read_at === null ? "border-action bg-surface-tint" : "border-border bg-surface"}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-bold text-text">{text.title}</p>
                  <span className="text-xs text-text-faint" dir="ltr">
                    {new Date(r.created_at).toLocaleString(en ? "en-EG" : "ar-EG")}
                  </span>
                </div>
                {text.body ? <p className="mt-0.5 text-sm text-text-muted">{text.body}</p> : null}
                <div className="mt-1.5 flex items-center gap-3">
                  {r.payload.link ? (
                    <Link to={r.payload.link} className="text-sm font-bold text-action hover:underline">
                      {t("notifications.open")}
                    </Link>
                  ) : null}
                  {r.read_at === null ? (
                    <fetcher.Form method="post" preventScrollReset>
                      <input type="hidden" name="intent" value="read" />
                      <input type="hidden" name="id" value={r.id} />
                      <button type="submit" className="cursor-pointer text-xs font-bold text-text-muted hover:text-text">
                        {t("notifications.markRead")}
                      </button>
                    </fetcher.Form>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}


/** H-06: friendly route error page (500s log a CORERR id; 403/404 keep their message) */
export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonPage />;
}

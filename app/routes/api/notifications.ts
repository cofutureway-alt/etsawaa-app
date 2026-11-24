import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { getViewer, getViewerContext } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "~/features/notifications/api";

/** GET /:lang/api/notifications — the signed-in user's rows (RLS-scoped). */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const lang = requireLang(params);
  // headers: a session refreshed here reaches the browser (this 60 s poll
  // runs in idle tabs, so it must not refresh the same token every minute)
  const { client, headers } = createSupabaseServerClient(request);
  if (!client) return data({ notifications: null, reason: "db_not_connected" });
  const { ctx } = await getViewerContext(client);
  if (!ctx) return data({ notifications: null, reason: "unauthenticated" }, { headers });
  try {
    const notifications = await listNotifications(client, ctx.user.id);
    // the real unread total (the list itself is only the latest 20)
    return data({ notifications, unread: ctx.unread, lang }, { headers });
  } catch {
    return data({ notifications: null, reason: "query_failed" }, { headers });
  }
}

/** POST — mark one/all read. RLS guarantees ownership server-side. */
export async function action({ request, params }: ActionFunctionArgs) {
  requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db_not_connected" }, { status: 503 });
  const { viewer } = (await getViewer(client)) ?? { viewer: null };
  if (!viewer) return data({ ok: false, reason: "unauthenticated" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { action?: string; id?: string } | null;
  if (body?.action === "read" && body.id) {
    const ok = await markNotificationRead(client, body.id);
    return data({ ok });
  }
  if (body?.action === "read-all") {
    const ok = await markAllNotificationsRead(client);
    return data({ ok });
  }
  return data({ ok: false, reason: "bad_request" }, { status: 400 });
}


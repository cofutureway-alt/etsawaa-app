import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { getViewer } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "~/features/notifications/api";

/** GET /:lang/api/notifications — the signed-in user's rows (RLS-scoped). */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ notifications: null, reason: "db_not_connected" });
  const { viewer } = (await getViewer(client)) ?? { viewer: null };
  if (!viewer) return data({ notifications: null, reason: "unauthenticated" });
  try {
    const notifications = await listNotifications(client, viewer.user.id);
    return data({ notifications, lang });
  } catch {
    return data({ notifications: null, reason: "query_failed" });
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


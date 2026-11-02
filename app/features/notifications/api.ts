import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Notifications (F-17). Rows carry bilingual payloads:
 * payload: { ar: { title, body }, en: { title, body } }
 */

export interface NotificationRow {
  id: string;
  type: string;
  payload: {
    ar?: { title: string; body: string };
    en?: { title: string; body: string };
  };
  read_at: string | null;
  created_at: string;
}

export async function listNotifications(
  client: SupabaseClient,
  userId: string,
  limit = 20,
): Promise<NotificationRow[]> {
  const { data, error } = await client
    .from("notifications")
    .select("id, type, payload, read_at, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as NotificationRow[];
}

/** RLS guarantees a user can only update their own rows. */
export async function markNotificationRead(
  client: SupabaseClient,
  id: string,
): Promise<boolean> {
  const { error } = await client
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .is("read_at", null);
  return !error;
}

export async function markAllNotificationsRead(client: SupabaseClient): Promise<boolean> {
  const { error } = await client
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .is("read_at", null);
  return !error;
}

/** Bilingual payload for the current locale, falling back to the other. */
export function notificationText(
  row: NotificationRow,
  locale: "ar" | "en",
): { title: string; body: string } {
  const primary = row.payload?.[locale];
  const fallback = row.payload?.[locale === "ar" ? "en" : "ar"];
  const chosen = primary ?? fallback ?? { title: "—", body: "" };
  return chosen;
}

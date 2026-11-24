import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Notifications (F-17). Payloads are bilingual { ar, en, link } or, from
 * older flows, plain fields; formatNotification (format.ts) reads both.
 */

export interface NotificationRow {
  id: string;
  type: string;
  /** bilingual { ar, en, link } — or, for older flows, plain fields (see format.ts) */
  payload: Record<string, unknown> | null;
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

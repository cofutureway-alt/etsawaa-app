import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getServiceRoleKey, getSupabaseEnv } from "~/lib/env.server";

let admin: SupabaseClient | null = null;

/**
 * service_role client — SERVER-ONLY (AGENT.md §12: never in the browser).
 * Used exclusively for: reading email templates for sending, writing
 * email_logs, and other operations that bypass RLS by design.
 * Returns null when unconfigured — callers surface a config error.
 */
export function getSupabaseAdminClient(): SupabaseClient | null {
  const env = getSupabaseEnv();
  const serviceKey = getServiceRoleKey();
  if (!env || !serviceKey) return null;
  if (!admin) {
    admin = createClient(env.url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return admin;
}

import { getSupabaseAdminClient } from "~/lib/supabase/admin";

/**
 * Phone → account email, for phone sign-in and password reset.
 *
 * `fn_resolve_email_from_phone` is executable by service_role only
 * (migration 20261104000000): exposing it to anon let anyone turn a phone
 * number into an email address. Callers must rate-limit before calling, and
 * must never send the resolved address back to the browser.
 *
 * Returns null when no account has this phone or the service client is not
 * configured.
 */
export async function resolveEmailFromPhone(phoneE164: string): Promise<string | null> {
  const admin = getSupabaseAdminClient();
  if (!admin) return null;
  const { data, error } = await admin.rpc("fn_resolve_email_from_phone", { p_phone_e164: phoneE164 });
  if (error || !data) return null;
  return String(data);
}

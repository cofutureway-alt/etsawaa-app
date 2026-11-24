import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/**
 * Browser Supabase client (session cookies only).
 *
 * The auth cookie is httpOnly (lib/supabase/server.ts), which stops script
 * token theft — and also means this client never learns who is signed in, so
 * anything it queries directly reaches PostgREST as `anon` and gets 401 on
 * every RLS-protected table. Use it for auth-state reads; take authorized
 * reads and writes through the server (+server modules) instead.
 */
export function getSupabaseBrowserClient(): SupabaseClient | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !anonKey) return null;
  if (!client) client = createBrowserClient(url, anonKey);
  return client;
}

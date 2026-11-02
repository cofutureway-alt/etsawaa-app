import {
  createServerClient,
  parseCookieHeader,
  serializeCookieHeader,
  type CookieOptionsWithName,
} from "@supabase/ssr";
import { getSupabaseEnv } from "~/lib/env.server";

export interface SupabaseServer {
  /** Null when SUPABASE_URL/ANON_KEY are not configured — callers must surface
   * the "database not connected" state, never substitute mock data. */
  client: ReturnType<typeof createServerClient> | null;
  /** Set-Cookie headers produced during the call (session refresh etc.).
   * Forward them with `data(..., { headers })`. */
  headers: Headers;
}

// Boot-time connection warm-up: prime DNS+TCP+TLS to the Supabase REST host so
// the first SSR request's TTFB does not pay connection setup (~300 ms). This
// sends one harmless REST probe; settings are still read fresh on every
// request (F-02: DB edits restyle the very next render).
let warmed = false;
function warmConnection(): void {
  if (warmed) return;
  warmed = true;
  const env = getSupabaseEnv();
  if (!env) return;
  void fetch(`${env.url}/rest/v1/`, { headers: { apikey: env.anonKey } }).catch(() => {
    /* unreachable host — every request surfaces its own error honestly */
  });
}
warmConnection();

/**
 * Request-scoped Supabase client for React Router 7 loaders/actions.
 * Auth cookies are read from the request and written to the returned headers.
 */
export function createSupabaseServerClient(request: Request): SupabaseServer {
  const env = getSupabaseEnv();
  const headers = new Headers();
  if (!env) return { client: null, headers };

  const client = createServerClient(env.url, env.anonKey, {
    // @supabase/ssr defaults to httpOnly:false + no Secure + 400 days.
    // The session cookie is read by our own server client (getAll parses the
    // raw Cookie header), so httpOnly costs us nothing and removes XSS token
    // theft. `secure` stays on in production only — HTTP localhost can't set it.
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    },
    cookies: {
      getAll() {
        return parseCookieHeader(request.headers.get("Cookie") ?? "").filter(
          (cookie): cookie is { name: string; value: string } => typeof cookie.value === "string",
        );
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptionsWithName }>) {
        for (const { name, value, options } of cookiesToSet) {
          headers.append(
            "Set-Cookie",
            serializeCookieHeader(name, value, {
              ...options,
              httpOnly: true,
              sameSite: "lax",
              secure: process.env.NODE_ENV === "production",
              path: "/",
            }),
          );
        }
      },
    },
  });
  return { client, headers };
}

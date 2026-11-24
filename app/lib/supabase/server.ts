import type { AuthChangeEvent } from "@supabase/supabase-js";
import {
  createServerClient,
  parseCookieHeader,
  serializeCookieHeader,
  type CookieOptionsWithName,
} from "@supabase/ssr";
import { getSupabaseEnv } from "~/lib/env.server";
import { supabaseFetch } from "./fetch.server";
import { refreshedCookies, rememberRefreshedCookies } from "./session-cookies.server";
import { forgetScope, forgetSettled, isReadRequest, markClientShared } from "./request-scope";

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
const perRequest = new WeakMap<Request, SupabaseServer>();
export { isSharedClient } from "./request-scope";

/**
 * ONE client per request: root, layout and page loaders of the same request
 * receive the same Request object, so they now share a single client (and,
 * through it, a single session check — see getViewerContext).
 */
export function createSupabaseServerClient(request: Request): SupabaseServer {
  const existing = perRequest.get(request);
  if (existing) return existing;
  const created = buildServerClient(request);
  perRequest.set(request, created);
  if (created.client) {
    markClientShared(created.client, isReadRequest(request));
    // a sign-in / sign-out inside this request invalidates what was resolved before it
    created.client.auth.onAuthStateChange((event: AuthChangeEvent) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        forgetScope(created.client!);
        forgetSettled(created.client!);
      }
    });
  }
  return created;
}

function buildServerClient(request: Request): SupabaseServer {
  const env = getSupabaseEnv();
  const headers = new Headers();
  if (!env) return { client: null, headers };

  const cookieHeader = request.headers.get("Cookie") ?? "";
  const client = createServerClient(env.url, env.anonKey, {
    global: { fetch: supabaseFetch },
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
        const parsed = parseCookieHeader(cookieHeader).filter(
          (cookie): cookie is { name: string; value: string } => typeof cookie.value === "string",
        );
        // another loader of this same request already refreshed the session:
        // read the fresh tokens instead of refreshing again
        const fresh = cookieHeader ? refreshedCookies(cookieHeader) : null;
        if (!fresh) return parsed;
        const merged = new Map(parsed.map((c) => [c.name, c.value]));
        for (const c of fresh.values()) {
          if (c.value) merged.set(c.name, c.value);
          else merged.delete(c.name);
        }
        return [...merged].map(([name, value]) => ({ name, value }));
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptionsWithName }>) {
        const stored = [];
        for (const { name, value, options } of cookiesToSet) {
          const serialized = serializeCookieHeader(name, value, {
            ...options,
            httpOnly: true,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production",
            path: "/",
          });
          headers.append("Set-Cookie", serialized);
          stored.push({ name, value, serialized });
        }
        // entry.server sends these with the response even when the route that
        // refreshed never forwards `headers`
        rememberRefreshedCookies(cookieHeader, stored);
      },
    },
  });
  return { client, headers };
}

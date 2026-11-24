import { getSupabaseEnv } from "~/lib/env.server";

/**
 * fetch() used by every server-side Supabase client (request clients and the
 * service-role client). Three speed fixes, all transparent to callers:
 *
 * 1. Internal hop — when SUPABASE_INTERNAL_URL is set (production:
 *    http://supabase-envoy:8000 on the shared docker network) calls to the
 *    public SUPABASE_URL are sent straight to the gateway instead of out
 *    through DNS + TLS + Caddy and back into the same machine (~8 ms vs ~35 ms
 *    a call). The client keeps the public URL, so cookie names, signed URLs and
 *    OAuth redirects are unchanged.
 * 2. One token refresh per refresh token — the parallel loaders of a single
 *    navigation (root + layout + page) each used to POST /token with the same
 *    refresh token (0.2–1.2 s each). Identical refreshes now share one call;
 *    a successful answer is replayed for 30 s, which also covers the requests
 *    a browser sends before it receives the new session cookie.
 * 3. Short user lookup cache — GET /auth/v1/user (≈150 ms) is answered from a
 *    20 s per-token cache. A token stays valid until it expires anyway; this
 *    only means a revoked session is noticed up to 20 s later.
 */

type Replay = { status: number; headers: Array<[string, string]>; body: string };
const shared = new Map<string, { at: number; ttl: number; p: Promise<Replay> }>();
const MAX_ENTRIES = 2000;

function prune(now: number): void {
  if (shared.size < MAX_ENTRIES) return;
  for (const [k, v] of shared) if (now - v.at > v.ttl) shared.delete(k);
  if (shared.size >= MAX_ENTRIES) shared.clear();
}

function toResponse(r: Replay): Response {
  return new Response(r.body, { status: r.status, headers: r.headers });
}

function sharedCall(key: string, ttl: number, run: () => Promise<Response>): Promise<Response> {
  const now = Date.now();
  const hit = shared.get(key);
  // ttl 0 = share only while the call is in flight
  if (hit && (hit.ttl === 0 || now - hit.at < hit.ttl)) return hit.p.then(toResponse);
  prune(now);
  const p = run().then(async (res) => ({ status: res.status, headers: [...res.headers.entries()], body: await res.text() }));
  const entry = { at: now, ttl, p };
  shared.set(key, entry);
  // only successful answers are replayed; a failure is retried by the next caller
  void p.then((r) => { if ((r.status >= 300 || ttl === 0) && shared.get(key) === entry) shared.delete(key); },
    () => { if (shared.get(key) === entry) shared.delete(key); });
  return p.then(toResponse);
}

let publicOrigin: string | null | undefined;
function rewrite(url: string): string {
  const internal = process.env.SUPABASE_INTERNAL_URL?.replace(/\/$/, "");
  if (!internal) return url;
  if (publicOrigin === undefined) publicOrigin = getSupabaseEnv()?.url.replace(/\/$/, "") ?? null;
  return publicOrigin && url.startsWith(publicOrigin) ? internal + url.slice(publicOrigin.length) : url;
}

function headerOf(init: RequestInit | undefined, name: string): string {
  const h = init?.headers;
  if (!h) return "";
  if (h instanceof Headers) return h.get(name) ?? "";
  if (Array.isArray(h)) return h.find(([k]) => k.toLowerCase() === name)?.[1] ?? "";
  const rec = h as Record<string, string>;
  return Object.entries(rec).find(([k]) => k.toLowerCase() === name)?.[1] ?? "";
}

export const supabaseFetch: typeof fetch = (input, init) => {
  if (input instanceof Request) {
    const url = rewrite(input.url);
    return fetch(url === input.url ? input : new Request(url, input), init);
  }
  const url = rewrite(typeof input === "string" ? input : input.toString());
  const method = (init?.method ?? "GET").toUpperCase();

  if (method === "POST" && url.includes("/auth/v1/token?grant_type=refresh_token") && typeof init?.body === "string") {
    return sharedCall(`refresh:${init.body}`, 30_000, () => fetch(url, init));
  }
  if (method === "GET" && /\/auth\/v1\/user(\?|$)/.test(url)) {
    const auth = headerOf(init, "authorization");
    if (auth) return sharedCall(`user:${auth}`, 20_000, () => fetch(url, init));
  }
  return fetch(url, init);
};

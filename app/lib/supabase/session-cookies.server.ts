/**
 * Refreshed-session cookies, shared by every loader/action of ONE request.
 *
 * A request carries the browser's (possibly expired) session cookie. When any
 * server client refreshes it, the new cookies are remembered here under the
 * request's original Cookie header, so:
 *  - every other client of the same request reads the fresh session instead of
 *    refreshing again (getAll overlay in createSupabaseServerClient), and
 *  - entry.server appends them as Set-Cookie to the response, whatever route
 *    did the refresh. Before this, only 13 of ~200 loaders forwarded the
 *    refreshed cookie, so the browser kept the expired token and EVERY page
 *    load paid one or more token refreshes (0.2–1.2 s each).
 */

interface Stored { name: string; value: string; serialized: string }
const byCookieHeader = new Map<string, { at: number; cookies: Map<string, Stored> }>();
const TTL_MS = 60_000;

function prune(now: number): void {
  if (byCookieHeader.size < 500) return;
  for (const [k, v] of byCookieHeader) if (now - v.at > TTL_MS) byCookieHeader.delete(k);
}

export function rememberRefreshedCookies(cookieHeader: string, cookies: Stored[]): void {
  if (!cookieHeader || cookies.length === 0) return;
  const now = Date.now();
  prune(now);
  const entry = byCookieHeader.get(cookieHeader) ?? { at: now, cookies: new Map<string, Stored>() };
  entry.at = now;
  for (const c of cookies) entry.cookies.set(c.name, c);
  byCookieHeader.set(cookieHeader, entry);
}

/** Cookies refreshed during this request (name → value; "" = deleted). */
export function refreshedCookies(cookieHeader: string): Map<string, Stored> | null {
  const entry = byCookieHeader.get(cookieHeader);
  if (!entry || Date.now() - entry.at > TTL_MS) return null;
  return entry.cookies;
}

/** Add the refreshed session's Set-Cookie headers to a response (entry.server). */
export function applyRefreshedCookies(request: Request, headers: Headers): void {
  const cookieHeader = request.headers.get("Cookie") ?? "";
  const stored = cookieHeader ? refreshedCookies(cookieHeader) : null;
  if (!stored) return;
  const already = headers.getSetCookie?.() ?? [];
  for (const c of stored.values()) {
    if (already.some((line) => line.startsWith(`${c.name}=`))) continue;
    headers.append("Set-Cookie", c.serialized);
  }
}

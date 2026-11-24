/**
 * In-memory fixed-window rate limiter for unauthenticated, abuse-prone
 * endpoints (coupon preview, OTP resend, login). Best-effort per server
 * instance: it caps brute-force/enumeration bursts even though Supabase Auth
 * remains the authoritative throttle for credential endpoints.
 *
 * Fixed window (not sliding) — the accounting cost matters more than the
 * ±1-request edge. The map is hard-capped at MAX_KEYS: expired buckets are
 * swept first, and if a burst of fresh keys still overflows it the oldest
 * buckets are dropped, so a key flood can never grow memory without bound.
 *
 * Keys should name the thing being protected (an account, an email) rather
 * than only the client: per-IP limits alone are spoofable without a trusted
 * proxy and over-block users sharing a carrier-grade NAT.
 *
 * SERVER-ONLY (`.server.ts`) — the counter map must never reach the client.
 */

const MAX_KEYS = 10_000;

const buckets = new Map<string, { count: number; resetAt: number }>();

function liveBucket(key: string, now: number) {
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) return null;
  return bucket;
}

/**
 * Consume one hit for `key`. Returns true when the request is allowed,
 * false when `limit` hits inside `windowMs` have already been seen.
 */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  if (isRateLimited(key, limit)) return false;
  recordHit(key, windowMs);
  return true;
}

/** True when `key` has already used `limit` hits in its current window. */
export function isRateLimited(key: string, limit: number): boolean {
  const bucket = liveBucket(key, Date.now());
  return bucket !== null && bucket.count >= limit;
}

/**
 * Count one hit for `key` without checking the limit — for "count failures
 * only" flows (login), where the check happens before the attempt and the hit
 * is recorded after it fails.
 */
export function recordHit(key: string, windowMs: number): void {
  const now = Date.now();
  const bucket = liveBucket(key, now);
  if (bucket) {
    bucket.count += 1;
    return;
  }
  buckets.delete(key);
  if (buckets.size >= MAX_KEYS) evict(now);
  buckets.set(key, { count: 1, resetAt: now + windowMs });
}

/**
 * Client IP for rate limiting, or null when it cannot be trusted.
 *
 * X-Forwarded-For is client-writable: only the entries appended by our own
 * proxies are trustworthy. TRUSTED_PROXY_HOPS is the number of proxies in
 * front of the app (e.g. 1 behind a single load balancer); the client address
 * is the entry that the outermost trusted proxy appended, counted from the
 * right. Unset/0 → null, and callers skip the per-IP limit instead of putting
 * every visitor into one shared bucket.
 */
export function clientKey(request: Request): string | null {
  const hops = Number(process.env.TRUSTED_PROXY_HOPS ?? 0);
  if (!Number.isInteger(hops) || hops <= 0) return null;
  const chain = (request.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return chain[chain.length - hops] ?? null;
}

function evict(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  // still full of live buckets: drop the oldest (Map iterates in insertion order)
  const excess = buckets.size - MAX_KEYS + 1;
  if (excess <= 0) return;
  let dropped = 0;
  for (const key of buckets.keys()) {
    if (dropped >= excess) break;
    buckets.delete(key);
    dropped += 1;
  }
}

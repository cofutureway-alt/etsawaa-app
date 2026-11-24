/**
 * (Plain module, no server-only imports: the storefront data helpers that use
 * it are shared with browser code.)
 *
 * Request-scoped memoisation — NOT a cache: every entry lives exactly as long
 * as the request object it hangs off and is garbage-collected with it.
 *
 * React Router hands the SAME Request to every loader of one request (root,
 * layout, page run in parallel), so values keyed on it are computed once and
 * shared: one Supabase client, one session check, one viewer context.
 *
 * Mutations (POST/PUT/PATCH/DELETE) never share results: an action may change
 * the very rows it later re-reads, so `scoped` re-runs `fn` for them.
 */
const scopes = new WeakMap<object, Map<string, Promise<unknown>>>();

export function scoped<T>(owner: object, key: string, fn: () => Promise<T>, share = true): Promise<T> {
  if (!share) return fn();
  let map = scopes.get(owner);
  if (!map) { map = new Map(); scopes.set(owner, map); }
  const hit = map.get(key) as Promise<T> | undefined;
  if (hit) return hit;
  const p = fn();
  map.set(key, p);
  // a failed attempt is not remembered: the next caller retries
  p.catch(() => { if (map!.get(key) === p) map!.delete(key); });
  return p;
}

/** Drop everything remembered for `owner` (sign-in / sign-out inside a request). */
export function forgetScope(owner: object): void {
  scopes.delete(owner);
}

/** Synchronous peek at an already-resolved value (undefined while pending/absent). */
const settled = new WeakMap<object, Map<string, unknown>>();
export function markSettled(owner: object, key: string, value: unknown): void {
  let map = settled.get(owner);
  if (!map) { map = new Map(); settled.set(owner, map); }
  map.set(key, value);
}
export function peekSettled<T>(owner: object, key: string): T | undefined {
  return settled.get(owner)?.get(key) as T | undefined;
}
export function forgetSettled(owner: object): void {
  settled.delete(owner);
}

/** Clients whose request is a read (GET/HEAD): their results may be shared across the request's loaders. */
const sharedClients = new WeakMap<object, boolean>();
export function markClientShared(client: object, shared: boolean): void {
  sharedClients.set(client, shared);
}
export function isSharedClient(client: object): boolean {
  return sharedClients.get(client) === true;
}

export function isReadRequest(request: Request): boolean {
  const m = request.method.toUpperCase();
  return m === "GET" || m === "HEAD";
}

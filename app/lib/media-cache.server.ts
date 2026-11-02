import { getSupabaseEnv } from "~/lib/env.server";

/**
 * In-process media cache behind the same-origin proxy (app/routes/api/media.ts).
 * Server-only: loadable ONLY from loaders (RR7 strips .server modules from the
 * client bundle; client call sites no-op via optional chaining).
 */

const MAX_PATH = 300;
/** simple LRU: insertion-ordered Map, evict-oldest beyond the item budget */
const CACHE_ORDER: string[] = [];
const CACHE = new Map<string, { bytes: ArrayBuffer; type: string }>();
const CACHE_MAX_ITEMS = 120;

function cachePut(key: string, value: { bytes: ArrayBuffer; type: string }): void {
  if (CACHE.has(key)) return;
  CACHE.set(key, value);
  CACHE_ORDER.push(key);
  while (CACHE_ORDER.length > CACHE_MAX_ITEMS) {
    const oldest = CACHE_ORDER.shift();
    if (oldest) CACHE.delete(oldest);
  }
}

async function resolveMedia(path: string): Promise<{ bytes: ArrayBuffer; type: string } | null> {
  const hit = CACHE.get(path);
  if (hit) return hit;
  const env = getSupabaseEnv();
  if (!env) return null;
  const res = await fetch(`${env.url}/storage/v1/object/public/media/${path}`);
  if (!res.ok) return null;
  const type = res.headers.get("content-type") ?? "application/octet-stream";
  if (!type.startsWith("image/") && !type.startsWith("video/")) return null;
  const bytes = await res.arrayBuffer();
  const value = { bytes, type };
  cachePut(path, value);
  return value;
}

/** Fire-and-forget cache warm-up for the LCP image during SSR loaders. */
export function warmMedia(path: string): void {
  if (!path || path.length > MAX_PATH || CACHE.has(path)) return;
  void resolveMedia(path).catch(() => undefined);
}

export async function loadMedia(path: string): Promise<{ bytes: ArrayBuffer; type: string } | null> {
  if (!path || path.length > MAX_PATH) return null;
  return resolveMedia(path);
}

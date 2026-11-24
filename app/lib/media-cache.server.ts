import { getSupabaseEnv } from "~/lib/env.server";
import { supabaseFetch } from "~/lib/supabase/fetch.server";

/**
 * In-process media cache behind the same-origin proxy (app/routes/api/media.ts).
 * Server-only: loadable ONLY from loaders (RR7 strips .server modules from the
 * client bundle; client call sites no-op via optional chaining).
 *
 * Memory budgets — the store is bounded so a video-heavy or bursty deployment
 * cannot OOM the server process (video/* used to be admitted with no per-item
 * or total cap, and eviction scanned an order array with O(n) shift()):
 * - per item: objects larger than MAX_ITEM_BYTES are still served to the
 *   caller but never cached;
 * - total bytes: inserts evict least-recently-used entries until the store is
 *   under CACHE_MAX_BYTES (a single item larger than the whole budget is
 *   refused — unreachable while MAX_ITEM_BYTES < CACHE_MAX_BYTES, kept as a
 *   guard in case the constants drift apart);
 * - item count: CACHE_MAX_ITEMS ceiling kept as defense in depth.
 * Recency + eviction are O(1): a Map iterates in insertion order, so a hit
 * re-inserts the entry (delete+set) at the tail and eviction pops the head —
 * no order-array bookkeeping.
 */

const MAX_PATH = 300;
/** per-item cap: larger objects bypass the cache (they are still served) */
const MAX_ITEM_BYTES = 2 * 1024 * 1024;
/** total byte budget across all cached entries */
const CACHE_MAX_BYTES = 64 * 1024 * 1024;
/** entry-count ceiling kept from the previous cache (defense in depth) */
const CACHE_MAX_ITEMS = 120;

interface CacheEntry {
  bytes: ArrayBuffer;
  type: string;
  size: number;
}

const CACHE = new Map<string, CacheEntry>();
let cacheBytes = 0;

/** Map.get, then delete+set to bump the entry to the tail (most recent) in O(1). */
function cacheGet(key: string): CacheEntry | undefined {
  const hit = CACHE.get(key);
  if (!hit) return undefined;
  CACHE.delete(key);
  CACHE.set(key, hit);
  return hit;
}

function cachePut(key: string, value: { bytes: ArrayBuffer; type: string }): void {
  const size = value.bytes.byteLength;
  // refuse oversized items: the caller already served the fetch, just don't keep it
  if (size > MAX_ITEM_BYTES || size > CACHE_MAX_BYTES) return;
  if (CACHE.has(key)) return; // content at a path never changes — keep the resident copy
  CACHE.set(key, { bytes: value.bytes, type: value.type, size });
  cacheBytes += size;
  // evict from the head (least recently used) until the new entry fits; the
  // entry just inserted sits at the tail, so `size > 1` never evicts it
  while (CACHE.size > 1 && (cacheBytes > CACHE_MAX_BYTES || CACHE.size > CACHE_MAX_ITEMS)) {
    const oldest = CACHE.entries().next();
    if (oldest.done) break;
    cacheBytes -= oldest.value[1].size;
    CACHE.delete(oldest.value[0]);
  }
}

async function resolveMedia(path: string): Promise<{ bytes: ArrayBuffer; type: string } | null> {
  const hit = cacheGet(path);
  if (hit) return { bytes: hit.bytes, type: hit.type };
  const env = getSupabaseEnv();
  if (!env) return null;
  const res = await supabaseFetch(`${env.url}/storage/v1/object/public/media/${path}`);
  if (!res.ok) return null;
  const type = res.headers.get("content-type") ?? "application/octet-stream";
  if (!type.startsWith("image/") && !type.startsWith("video/")) return null;
  const bytes = await res.arrayBuffer();
  // oversized objects (mostly video/*) still reach the caller — just uncached
  if (bytes.byteLength <= MAX_ITEM_BYTES) cachePut(path, { bytes, type });
  return { bytes, type };
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
